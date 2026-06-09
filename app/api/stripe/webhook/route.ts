import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clerkClient } from '@clerk/nextjs/server'
import type Stripe from 'stripe'

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

  // ── Hosting subscription events ──────────────────────────────────────────────
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated'
  ) {
    const sub = event.data.object as Stripe.Subscription
    const { userId, projectId } = sub.metadata ?? {}
    if (!userId || !projectId) return new Response('ok', { status: 200 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAny = sub as any
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

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    await supabaseAdmin
      .from('hosting_subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id)
  }

  return new Response('ok', { status: 200 })
}

// ─── Record store sale + notify owner ────────────────────────────────────────

async function recordStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  const grossCents = session.amount_total ?? 0
  const platformFeeCents = parseInt(session.metadata?.platform_fee_cents ?? '0', 10)
  const netCents = grossCents - platformFeeCents

  // Idempotent insert — unique constraint on stripe_session_id prevents duplicates
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
}

async function notifyStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('user_id')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!secret?.user_id) return

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

  const amount = ((session.amount_total ?? 0) / 100).toFixed(2)
  const currency = (session.currency ?? 'usd').toUpperCase()
  const customerName = session.customer_details?.name ?? '—'
  const customerEmail = session.customer_details?.email ?? '—'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'orders@quante.io',
        to: ownerEmail,
        subject: `New order — ${currency} ${amount}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem;color:#111">
            <h2 style="margin:0 0 1.5rem;font-size:22px;font-weight:700">New order received 🎉</h2>
            <table style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Customer</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;border-bottom:1px solid #e5e7eb">${customerName}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Email</td>
                <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #e5e7eb">${customerEmail}</td>
              </tr>
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Amount</td>
                <td style="padding:12px 16px;font-size:18px;font-weight:700;color:#059669;border-bottom:1px solid #e5e7eb">${currency} ${amount}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:13px;color:#6b7280">Order ID</td>
                <td style="padding:12px 16px;font-size:12px;color:#9ca3af;font-family:monospace">${session.id}</td>
              </tr>
            </table>
            <p style="margin:2rem 0 0;font-size:12px;color:#9ca3af">Sent by <a href="https://quante.io" style="color:#6f78e6;text-decoration:none">Quante</a></p>
          </div>
        `,
      }),
    })
    if (!res.ok) console.error('[webhook] Resend error:', res.status, await res.text())
  } catch (err) {
    console.error('[webhook] email send failed:', err)
  }
}
