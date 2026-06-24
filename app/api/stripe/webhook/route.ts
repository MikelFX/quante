import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { upsertUser } from '@/lib/tier'
import { FREE_PROJECT_LIMIT, AGENCY_PROJECT_LIMIT } from '@/lib/config'
import { clerkClient } from '@clerk/nextjs/server'
import type Stripe from 'stripe'
import { paymentConfirmedEmail, merchantNewOrderEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'
import { registerDomain } from '@/lib/namecheap'
import { attachDomain } from '@/lib/hosting/vercel'

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured.', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return new Response('Signature verification failed.', { status: 400 })
  }

  // ── Stripe Connect: connected account onboarding completed ──────────────────
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account
    await supabaseAdmin
      .from('project_secrets')
      .update({
        stripe_connect_onboarded: account.details_submitted,
        stripe_connect_charges_enabled: account.charges_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_connect_account_id', account.id)
    return new Response('ok', { status: 200 })
  }

  // ── checkout.session.completed ───────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, credits, type, project_id: projectId } = session.metadata ?? {}

    // Store sale — record earning + notify the shop owner
    if (type === 'store_sale' && projectId) {
      await recordStoreSale(projectId, session)
      return new Response('ok', { status: 200 })
    }

    // Hosting subscription checkout — subscription webhook handles credits
    if (type === 'hosting') {
      return new Response('ok', { status: 200 })
    }

    // Domain purchase — register with Namecheap, attach to Vercel, record in DB
    if (type === 'domain_purchase' && userId) {
      await handleDomainPurchase(session, userId)
      return new Response('ok', { status: 200 })
    }

    // Credit pack purchase
    if (!userId || !credits) {
      return new Response('Missing metadata.', { status: 400 })
    }

    const creditAmount = parseInt(credits, 10)

    const { data: existing } = await supabaseAdmin
      .from('purchases')
      .select('id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (existing) return new Response('Already processed.', { status: 200 })

    const { data: lastEntry } = await supabaseAdmin
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const currentBalance = lastEntry?.balance_after ?? 0
    const newBalance = currentBalance + creditAmount

    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from('purchases')
      .insert({
        user_id: userId,
        stripe_session_id: session.id,
        credits: creditAmount,
        amount_cents: session.amount_total ?? 0,
      })
      .select()
      .single()

    if (purchaseError || !purchase) {
      console.error('Failed to record purchase:', purchaseError)
      return new Response('Failed to record purchase.', { status: 500 })
    }

    const { error: ledgerError } = await supabaseAdmin
      .from('credit_ledger')
      .insert({
        user_id: userId,
        delta: creditAmount,
        reason: 'purchase',
        ref_id: purchase.id,
        balance_after: newBalance,
      })

    if (ledgerError) {
      console.error('Failed to update ledger:', ledgerError)
      return new Response('Failed to update credit ledger.', { status: 500 })
    }
  }

  // ── Subscription events (agency + hosting) ───────────────────────────────────
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAny = sub as any
    const meta = sub.metadata ?? {}
    const isDeleted = event.type === 'customer.subscription.deleted'

    // ── Agency subscription ─────────────────────────────────────────────────
    if (meta.type === 'agency' && meta.userId) {
      const userId = meta.userId
      const periodEnd = subAny.current_period_end
        ? new Date(subAny.current_period_end * 1000).toISOString()
        : null

      if (isDeleted) {
        // Downgrade to credit tier; keep credit balance intact; archive excess projects
        await upsertUser(userId, {
          tier: 'credit',
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          subscription_status: 'canceled',
          current_period_end: periodEnd,
          project_limit: FREE_PROJECT_LIMIT,
        })
        await archiveExcessProjects(userId, FREE_PROJECT_LIMIT)
      } else {
        await upsertUser(userId, {
          tier: 'agency',
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          subscription_status: sub.status,
          current_period_end: periodEnd,
          project_limit: AGENCY_PROJECT_LIMIT,
        })
      }

      return new Response('ok', { status: 200 })
    }

    // ── Hosting subscription (per-project) ─────────────────────────────────
    const { userId, projectId } = meta
    if (!userId || !projectId) return new Response('ok', { status: 200 })

    if (isDeleted) {
      await supabaseAdmin
        .from('hosting_subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', sub.id)
    } else {
      const periodEnd = subAny.current_period_end
        ? new Date(subAny.current_period_end * 1000).toISOString()
        : null
      await supabaseAdmin
        .from('hosting_subscriptions')
        .upsert(
          {
            user_id: userId,
            project_id: projectId,
            stripe_subscription_id: sub.id,
            stripe_customer_id: sub.customer as string,
            status: sub.status,
            current_period_end: periodEnd,
            cancel_at_period_end: subAny.cancel_at_period_end ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'stripe_subscription_id' }
        )
    }
  }

  return new Response('ok', { status: 200 })
}

// ─── Agency downgrade: archive projects over the limit ───────────────────────
// Sets projects to 'archived' status so they are hidden but not deleted.
// The user sees a warning banner and can re-activate by upgrading again.
async function archiveExcessProjects(userId: string, limit: number): Promise<void> {
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (!projects || projects.length <= limit) return

  const toArchive = projects.slice(limit).map((p: { id: string }) => p.id)
  await supabaseAdmin
    .from('projects')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .in('id', toArchive)
}

// ─── Customer payment confirmed email ────────────────────────────────────────

async function sendCustomerConfirmation(projectId: string, session: Stripe.Checkout.Session, orderId?: string) {
  const customerEmail = session.customer_details?.email
  if (!customerEmail) return

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest) return

  // Prefer data from store_orders if we have an order ID
  let orderNumber: string
  let total: number
  const currency = (session.currency ?? 'czk').toUpperCase()

  if (orderId) {
    const { data: order } = await supabaseAdmin
      .from('store_orders')
      .select('order_number, total_cents')
      .eq('id', orderId)
      .maybeSingle()
    orderNumber = order?.order_number ?? `ORD-${session.id.slice(-8).toUpperCase()}`
    total = order ? order.total_cents / 100 : (session.amount_total ?? 0) / 100
  } else {
    orderNumber = `ORD-${session.id.slice(-8).toUpperCase()}`
    total = (session.amount_total ?? 0) / 100
  }

  const QUANTE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'
  const invoiceUrl = orderId ? `${QUANTE_URL}/invoice/${orderId}` : undefined

  const { subject, html } = paymentConfirmedEmail({
    orderNumber,
    customerName: session.customer_details?.name ?? 'zákazníku',
    total,
    currency,
    storeName: manifest.brand.name,
    accentColor: manifest.design.palette.accent,
    merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quante.io',
    merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
    invoiceUrl,
  })

  await sendEmail(customerEmail, subject, html)
}

// ─── Record store sale + notify owner ────────────────────────────────────────

async function recordStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  const grossCents = session.amount_total ?? 0
  const platformFeeCents = parseInt(session.metadata?.platform_fee_cents ?? '0', 10)
  const netCents = grossCents - platformFeeCents
  const orderId = session.metadata?.order_id

  // Update store_orders to paid (idempotent)
  if (orderId) {
    await supabaseAdmin
      .from('store_orders')
      .update({
        payment_status: 'paid',
        status: 'paid',
        payment_ref: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('payment_status', 'pending') // only update if still pending (idempotent)
  }

  // Keep store_earnings for backwards compatibility / Stripe-specific reporting
  await supabaseAdmin.from('store_earnings').upsert({
    project_id: projectId,
    stripe_session_id: session.id,
    gross_amount_cents: grossCents,
    platform_fee_cents: platformFeeCents,
    net_amount_cents: netCents,
    currency: (session.currency ?? 'eur').toLowerCase(),
    customer_email: session.customer_details?.email ?? null,
    customer_name: session.customer_details?.name ?? null,
  }, { onConflict: 'stripe_session_id', ignoreDuplicates: true })

  await notifyStoreSale(projectId, session)
  await sendCustomerConfirmation(projectId, session, orderId)
}

async function notifyStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  if (!process.env.RESEND_API_KEY) return

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('user_id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!secret?.user_id) return

  // Get owner's Clerk email (platform user who built the store)
  let ownerEmail: string | null = null
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(secret.user_id as string)
    ownerEmail = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null
  } catch (err) {
    console.error('[webhook] failed to get owner email:', err)
  }
  if (!ownerEmail) return

  // Fetch manifest for branding
  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = versionRow?.manifest as ShopManifest | undefined

  // Fetch order for item details
  const orderId = session.metadata?.order_id
  let orderNumber = `ORD-${session.id.slice(-8).toUpperCase()}`
  let orderItems: Array<{ name: string; quantity: number; price: number; currency: string }> = []
  const currency = (session.currency ?? 'czk').toUpperCase()
  const total = (session.amount_total ?? 0) / 100

  if (orderId) {
    const { data: order } = await supabaseAdmin
      .from('store_orders')
      .select('order_number, items')
      .eq('id', orderId)
      .maybeSingle()
    if (order) {
      orderNumber = order.order_number
      orderItems = ((order.items as Array<{ id: string; name: string; price: number; quantity: number }>) ?? [])
        .map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency }))
    }
  }

  const { subject, html } = merchantNewOrderEmail({
    orderNumber,
    customerName: session.customer_details?.name ?? '—',
    customerEmail: session.customer_details?.email ?? '—',
    items: orderItems,
    total,
    currency,
    paymentMethod: 'Platební karta (Stripe)',
    storeName: manifest?.brand.name ?? 'Váš obchod',
    accentColor: manifest?.design.palette.accent ?? '#6f78e6',
  })

  await sendEmail(ownerEmail, subject, html, 'orders@quante.io')
}

// ─── Domain purchase: register + attach to Vercel + save row ─────────────────

async function handleDomainPurchase(session: Stripe.Checkout.Session, userId: string) {
  const { domain, projectId, includeProtection } = session.metadata ?? {}
  if (!domain) return

  // Check idempotency
  const { data: existing } = await supabaseAdmin
    .from('user_domains').select('id').eq('domain', domain).maybeSingle()
  if (existing) return

  let namecheapOrderId: string | null = null
  let status = 'active'

  try {
    const result = await registerDomain(domain, 1)
    namecheapOrderId = result.orderId
  } catch (err) {
    console.error('[webhook] Namecheap registration failed:', err)
    status = 'failed'
  }

  // Attach to Vercel if project linked
  let vercelProjectId: string | null = null
  if (projectId && status === 'active') {
    try {
      const { data: project } = await supabaseAdmin
        .from('projects').select('vercel_project_id').eq('id', projectId).maybeSingle()
      if (project?.vercel_project_id) {
        await attachDomain(project.vercel_project_id, domain)
        vercelProjectId = project.vercel_project_id
      }
    } catch (err) {
      console.error('[webhook] Vercel attach failed:', err)
    }
  }

  const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()

  await supabaseAdmin.from('user_domains').insert({
    user_id: userId,
    project_id: projectId || null,
    domain,
    status,
    registered_at: new Date().toISOString(),
    expires_at: expiresAt,
    namecheap_order_id: namecheapOrderId,
    vercel_project_id: vercelProjectId,
    protection_enabled: includeProtection === 'true',
    dns_verified: false,
  })

  // If protection requested, create a recurring Stripe subscription
  if (includeProtection === 'true' && session.customer && status === 'active') {
    try {
      const protectionPriceId = process.env.DOMAIN_PROTECTION_STRIPE_PRICE_ID
      if (protectionPriceId) {
        const sub = await stripe.subscriptions.create({
          customer: session.customer as string,
          items: [{ price: protectionPriceId }],
          metadata: { type: 'domain_protection', userId, domain },
        })
        await supabaseAdmin.from('user_domains')
          .update({ stripe_subscription_id: sub.id })
          .eq('domain', domain)
      }
    } catch (err) {
      console.error('[webhook] protection subscription creation failed:', err)
    }
  }
}
