import { auth } from '@clerk/nextjs/server'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  checkDomainAvailability,
  parseRegistrableDomain,
  validateRegistrant,
  SUPPORTED_TLDS,
  type DomainRegistrant,
} from '@/lib/namecheap'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import {
  type DomainRow,
  detachFromVercel,
  isLiveStatus,
  isQuanteRegistered,
  releaseDomainRow,
  rowHoldsName,
} from '../_lib/release'

// Stripe's minimum Checkout lifetime is 30 minutes. While a session is open the
// domain is "held" for its buyer so two customers can't both pay for it (the
// webhook can only register it once).
const CHECKOUT_TTL_SECONDS = 31 * 60
const CHECKOUT_HOLD_MS = (CHECKOUT_TTL_SECONDS + 5 * 60) * 1000
// Sanity cap on what a single domain may be sold for (USD).
const MAX_DOMAIN_PRICE_USD = 1000

function configuredAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Each attempt hits Namecheap (check + pricing) and Stripe.
  const rl = rateLimit(`domains-purchase:${userId}`, 10, 3_600_000)
  if (!rl.allowed) {
    return Response.json({ error: 'Too many checkout attempts. Please try again later.' }, { status: 429 })
  }

  if (!isStripeConfigured()) {
    console.error('[domains/purchase] Stripe is not configured')
    return Response.json({ error: 'Payments are not available right now.' }, { status: 503 })
  }

  // Stripe redirect base: only the configured app origin (fail closed, no hardcoded
  // fallback host).
  const appUrl = configuredAppOrigin()
  if (!appUrl) {
    console.error('[domains/purchase] NEXT_PUBLIC_APP_URL is missing or invalid')
    return Response.json({ error: 'Payments are not available right now.' }, { status: 503 })
  }

  const body = (await request.json().catch(() => null)) as {
    domain?: unknown
    projectId?: unknown
    price?: unknown // IGNORED — still sent by older clients; never trusted
    includeProtection?: unknown
    registrant?: Partial<DomainRegistrant>
  } | null
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // SECURITY: the domain is normalized and restricted to the TLDs we sell;
  // everything downstream (price, Stripe, webhook) uses this value only.
  const domain = parseRegistrableDomain(body.domain)
  if (!domain) {
    return Response.json(
      { error: `Invalid domain. We currently sell: ${SUPPORTED_TLDS.map((t) => `.${t}`).join(', ')}` },
      { status: 400 },
    )
  }
  const includeProtection = body.includeProtection === true

  // SECURITY: projectId goes into the Stripe metadata and the webhook attaches
  // the domain to that project's Vercel project — only accept the caller's own.
  let projectId: string | null = null
  if (body.projectId !== undefined && body.projectId !== null && body.projectId !== '') {
    const project = await getOwnedProject<{ id: string }>(body.projectId, userId, 'id')
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })
    projectId = project.id
  }

  // Registrant data is mandatory — this is a legal WHOIS record, not
  // optional metadata, and .eu/.cz-style registrars reject registrations
  // without it. Validate BEFORE creating a Stripe session so nobody gets
  // charged for a purchase that can't actually complete.
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const registrant: DomainRegistrant = {
    firstName: str(body.registrant?.firstName),
    lastName: str(body.registrant?.lastName),
    address1: str(body.registrant?.address1),
    city: str(body.registrant?.city),
    stateProvince: str(body.registrant?.stateProvince),
    postalCode: str(body.registrant?.postalCode),
    country: str(body.registrant?.country),
    phone: str(body.registrant?.phone),
    email: str(body.registrant?.email),
  }
  const registrantError = validateRegistrant(registrant, domain)
  if (registrantError) {
    return Response.json({ error: registrantError }, { status: 400 })
  }

  // Existing claims on this name: its own user_domains row (the column is
  // UNIQUE, so the webhook can only ever create one) and anything under it.
  // A live row for a domain bought through Quante is final. Every other row
  // (connect-only, expired, failed) is only released further down, once the
  // registry confirms the name is unregistered — it can't prove ownership then.
  const [exactRes, childRes, projectExactRes, projectChildRes] = await Promise.all([
    supabaseAdmin.from('user_domains').select('*').eq('domain', domain),
    supabaseAdmin.from('user_domains').select('*').like('domain', `%.${domain}`).neq('user_id', userId),
    supabaseAdmin.from('projects').select('id, custom_domain, vercel_project_id').eq('custom_domain', domain).neq('user_id', userId),
    supabaseAdmin.from('projects').select('id, custom_domain, vercel_project_id').like('custom_domain', `%.${domain}`).neq('user_id', userId),
  ])
  const claimsError = exactRes.error ?? childRes.error ?? projectExactRes.error ?? projectChildRes.error
  if (claimsError) {
    console.error('[domains/purchase] claim lookup failed:', claimsError.message)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
  const existing = ((exactRes.data ?? []) as DomainRow[])[0] ?? null
  if (existing && isLiveStatus(existing.status) && isQuanteRegistered(existing)) {
    return Response.json(
      { error: existing.user_id === userId ? 'You already own this domain.' : 'Domain already registered' },
      { status: 409 },
    )
  }

  // Refuse while another checkout for this domain is still open, so two
  // customers can't both pay for the same name. The caller's own earlier
  // open session is expired instead (double-clicking "Buy" must not double-charge).
  // A 'pending' row WITHOUT a session id also holds the name for the whole window: it
  // is either mid-creation, or its session id could not be linked and the session
  // could not be expired either — so a payable session we can't see may exist.
  const holdCutoff = new Date(Date.now() - CHECKOUT_HOLD_MS).toISOString()
  const { data: inFlight, error: inFlightError } = await supabaseAdmin
    .from('pending_domain_purchases')
    .select('id, user_id, stripe_session_id')
    .eq('domain', domain)
    .eq('status', 'pending')
    .gte('created_at', holdCutoff)
  if (inFlightError) {
    console.error('[domains/purchase] pending lookup failed:', inFlightError.message)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
  for (const row of inFlight ?? []) {
    if (row.user_id !== userId) {
      return Response.json(
        { error: 'Someone is already checking out this domain. Please try again in about 30 minutes.' },
        { status: 409 },
      )
    }
    if (!row.stripe_session_id) {
      // Our own attempt whose session we can't look up (still being created, or its
      // link failed): never open a second payable checkout next to it.
      return Response.json(
        { error: 'A previous checkout for this domain is still open. Please try again in about 30 minutes.' },
        { status: 409 },
      )
    }
    try {
      const prev = await stripe.checkout.sessions.retrieve(row.stripe_session_id as string)
      if (prev.status === 'complete') {
        return Response.json(
          { error: 'You already paid for this domain — it is being registered.' },
          { status: 409 },
        )
      }
      // expire() throws if Stripe refuses (e.g. the buyer is completing payment right
      // now) — we then land in the catch below and the row stays 'pending', so the
      // webhook can still register a paid domain. Only a session Stripe confirms is no
      // longer payable is marked expired (CAS on 'pending': never clobber a row the
      // webhook has already claimed).
      if (prev.status === 'open') await stripe.checkout.sessions.expire(prev.id)
      await supabaseAdmin
        .from('pending_domain_purchases')
        .update({ status: 'expired' })
        .eq('id', row.id)
        .eq('status', 'pending')
    } catch (err) {
      console.error('[domains/purchase] could not expire previous checkout', row.stripe_session_id, err)
      return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 409 })
    }
  }

  // SECURITY: price the domain on the server, right before charging. The
  // client-supplied `price` is never used as the amount — it used to be, which
  // let anyone register any domain on Quante's registrar account for $0.50.
  let quote: Awaited<ReturnType<typeof checkDomainAvailability>>
  try {
    quote = await checkDomainAvailability(domain, { freshPricing: true })
  } catch (err) {
    console.error('[domains/purchase] availability/pricing check failed for', domain, err)
    return Response.json(
      { error: 'Could not confirm the domain price right now. Please try again in a moment.' },
      { status: 502 },
    )
  }
  if (!quote.available) {
    return Response.json(
      {
        error: quote.premium
          ? 'This is a premium domain and cannot be purchased here.'
          : existing?.user_id === userId && rowHoldsName(existing)
            ? 'You already own this domain.'
            : 'This domain is no longer available.',
      },
      { status: 409 },
    )
  }
  const serverPrice = quote.price
  if (!Number.isFinite(serverPrice) || serverPrice <= 0 || serverPrice > MAX_DOMAIN_PRICE_USD || serverPrice < quote.rawCost) {
    console.error('[domains/purchase] refusing suspicious price', { domain, serverPrice, rawCost: quote.rawCost })
    return Response.json({ error: 'Could not confirm the domain price. Please try again later.' }, { status: 502 })
  }
  const amountCents = Math.round(serverPrice * 100)
  // body.price (the price shown by an earlier search) is deliberately unused:
  // Stripe Checkout shows the customer this server-computed amount before they pay.

  const successBase = projectId
    ? `${appUrl}/project/${projectId}`
    : `${appUrl}/dashboard`

  // Stash the registrant PII server-side (not in Stripe metadata — no size
  // pressure, no lingering PII in the Stripe dashboard, and it lets us keep
  // a 'pending' record even if the customer abandons checkout). The webhook
  // reads this row back by id once payment succeeds.
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('pending_domain_purchases')
    .insert({
      user_id: userId,
      project_id: projectId,
      domain,
      price: serverPrice,
      currency: 'usd',
      include_protection: includeProtection,
      registrant_first_name: registrant.firstName.trim(),
      registrant_last_name: registrant.lastName.trim(),
      registrant_address1: registrant.address1.trim(),
      registrant_city: registrant.city.trim(),
      registrant_state_province: registrant.stateProvince.trim(),
      registrant_postal_code: registrant.postalCode.trim(),
      registrant_country: registrant.country.trim().toUpperCase(),
      registrant_phone: registrant.phone.trim(),
      registrant_email: registrant.email.trim(),
      status: 'pending',
    })
    .select('id, created_at')
    .single()

  if (pendingError || !pending) {
    console.error('[domains/purchase] failed to store pending purchase:', pendingError)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }

  // Close the check-then-insert race: if another live attempt for this domain
  // was created before ours, back off (the earlier one wins). Every 'pending' row in
  // the hold window counts, linked or not (see the in-flight check above).
  const { data: rivals, error: rivalsError } = await supabaseAdmin
    .from('pending_domain_purchases')
    .select('id, created_at')
    .eq('domain', domain)
    .eq('status', 'pending')
    .neq('id', pending.id)
    .gte('created_at', holdCutoff)
  const lostRace = (rivals ?? []).some(
    (r) => r.created_at < pending.created_at || (r.created_at === pending.created_at && r.id < pending.id),
  )
  if (rivalsError || lostRace) {
    if (rivalsError) console.error('[domains/purchase] rival lookup failed:', rivalsError.message)
    await supabaseAdmin.from('pending_domain_purchases').update({ status: 'expired' }).eq('id', pending.id)
    return Response.json(
      { error: 'Someone is already checking out this domain. Please try again in about 30 minutes.' },
      { status: 409 },
    )
  }

  // The registry just confirmed the name is unregistered, and this checkout now
  // holds it (connect refuses names in someone's open checkout). Any remaining
  // claim on it — a connect-only / expired / failed row, a squatted subdomain,
  // or another tenant's projects.custom_domain — proves nothing: detach it from
  // Vercel and drop it, so the webhook's unique claim and its apex + www attach
  // go to the buyer. Failing to clean up aborts before anyone is charged.
  try {
    const staleRows = [...(existing ? [existing] : []), ...((childRes.data ?? []) as DomainRow[])]
    for (const row of staleRows) {
      if (!(await releaseDomainRow(row, { force: true }))) throw new Error(`row ${row.id} changed concurrently`)
    }
    const staleProjects = [...(projectExactRes.data ?? []), ...(projectChildRes.data ?? [])] as {
      id: string
      custom_domain: string
      vercel_project_id: string | null
    }[]
    for (const p of staleProjects) {
      if (p.vercel_project_id) await detachFromVercel(p.vercel_project_id, p.custom_domain)
      const { error } = await supabaseAdmin
        .from('projects')
        .update({ custom_domain: null, custom_domain_verified: false })
        .eq('id', p.id)
        .eq('custom_domain', p.custom_domain)
      if (error) throw new Error(`projects.custom_domain clear failed: ${error.message}`)
    }
    if (staleRows.length > 0 || staleProjects.length > 0) {
      console.warn(`[domains/purchase] released ${staleRows.length} row(s) / ${staleProjects.length} custom domain(s) on unregistered ${domain}`)
    }
  } catch (err) {
    console.error('[domains/purchase] could not release stale claims on', domain, err)
    await supabaseAdmin.from('pending_domain_purchases').update({ status: 'expired' }).eq('id', pending.id)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  try {
    session = await stripe.checkout.sessions.create({
      // Always use payment mode. When includeProtection is true, the webhook
      // creates a separate protection subscription after payment succeeds.
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Domain: ${domain}`,
              description: '1-year registration',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      metadata: {
        type: 'domain_purchase',
        userId,
        domain,
        projectId: projectId ?? '',
        includeProtection: includeProtection ? 'true' : 'false',
        pendingPurchaseId: pending.id,
        // For the webhook to verify session.amount_total before registering.
        expectedAmountCents: String(amountCents),
        rawCostCents: String(Math.ceil(quote.rawCost * 100)),
      },
      success_url: `${successBase}?domain_purchased=${encodeURIComponent(domain)}`,
      cancel_url: successBase,
    })
  } catch (err) {
    console.error('[domains/purchase] Stripe session create failed:', err)
    await supabaseAdmin.from('pending_domain_purchases').update({ status: 'expired' }).eq('id', pending.id)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  const { error: linkError } = await supabaseAdmin
    .from('pending_domain_purchases')
    .update({ stripe_session_id: session.id })
    .eq('id', pending.id)
  if (linkError) {
    // Without the session id the in-flight hold above can't see this checkout.
    console.error('[domains/purchase] failed to link Stripe session:', linkError.message)
    // SECURITY (audit #32): mark the purchase expired ONLY once Stripe confirms the
    // session can no longer be paid. If expire() fails the session is still payable,
    // so the row must stay 'pending' — otherwise a customer who pays anyway would be
    // charged for a purchase the webhook then refuses to register.
    try {
      await stripe.checkout.sessions.expire(session.id)
      await supabaseAdmin
        .from('pending_domain_purchases')
        .update({ status: 'expired' })
        .eq('id', pending.id)
        .eq('status', 'pending')
    } catch (err) {
      console.error('[domains/purchase] could not expire unlinked session — leaving purchase pending', session.id, err)
    }
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }

  return Response.json({ url: session.url })
}
