import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateRegistrant, type DomainRegistrant } from '@/lib/namecheap'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    domain?: string
    projectId?: string
    price?: number
    includeProtection?: boolean
    registrant?: Partial<DomainRegistrant>
  }
  const { domain, projectId, price, includeProtection } = body

  if (!domain || !price) {
    return Response.json({ error: 'domain and price required' }, { status: 400 })
  }

  // Registrant data is mandatory — this is a legal WHOIS record, not
  // optional metadata, and .eu/.cz-style registrars reject registrations
  // without it. Validate BEFORE creating a Stripe session so nobody gets
  // charged for a purchase that can't actually complete.
  const registrant: DomainRegistrant = {
    firstName: body.registrant?.firstName ?? '',
    lastName: body.registrant?.lastName ?? '',
    address1: body.registrant?.address1 ?? '',
    city: body.registrant?.city ?? '',
    stateProvince: body.registrant?.stateProvince ?? '',
    postalCode: body.registrant?.postalCode ?? '',
    country: body.registrant?.country ?? '',
    phone: body.registrant?.phone ?? '',
    email: body.registrant?.email ?? '',
  }
  const registrantError = validateRegistrant(registrant, domain)
  if (registrantError) {
    return Response.json({ error: registrantError }, { status: 400 })
  }

  const supabase = await createClient()

  // Check user doesn't already own this domain
  const { data: existing } = await supabase
    .from('user_domains')
    .select('id')
    .eq('domain', domain)
    .maybeSingle()

  if (existing) return Response.json({ error: 'Domain already registered' }, { status: 409 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quantecode.com'
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
      project_id: projectId || null,
      domain,
      price,
      currency: 'usd',
      include_protection: !!includeProtection,
      registrant_first_name: registrant.firstName,
      registrant_last_name: registrant.lastName,
      registrant_address1: registrant.address1,
      registrant_city: registrant.city,
      registrant_state_province: registrant.stateProvince,
      registrant_postal_code: registrant.postalCode,
      registrant_country: registrant.country.toUpperCase(),
      registrant_phone: registrant.phone,
      registrant_email: registrant.email,
      status: 'pending',
    })
    .select('id')
    .single()

  if (pendingError || !pending) {
    console.error('[domains/purchase] failed to store pending purchase:', pendingError)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }

  const session = await stripe.checkout.sessions.create({
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
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'domain_purchase',
      userId,
      domain,
      projectId: projectId ?? '',
      includeProtection: includeProtection ? 'true' : 'false',
      pendingPurchaseId: pending.id,
    },
    success_url: `${successBase}?domain_purchased=${encodeURIComponent(domain)}`,
    cancel_url: successBase,
  })

  await supabaseAdmin
    .from('pending_domain_purchases')
    .update({ stripe_session_id: session.id })
    .eq('id', pending.id)

  return Response.json({ url: session.url })
}
