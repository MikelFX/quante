import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
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

  // ── Credit pack purchase ────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, credits, type } = session.metadata ?? {}

    // Hosting subscription checkout — subscription webhook handles the rest
    if (type === 'hosting') {
      return new Response('ok', { status: 200 })
    }

    if (!userId || !credits) {
      return new Response('Missing metadata.', { status: 400 })
    }

    const creditAmount = parseInt(credits, 10)

    // Idempotency — check if this session was already processed
    const { data: existing } = await supabaseAdmin
      .from('purchases')
      .select('id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (existing) {
      return new Response('Already processed.', { status: 200 })
    }

    // Get current balance
    const { data: lastEntry } = await supabaseAdmin
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const currentBalance = lastEntry?.balance_after ?? 0
    const newBalance = currentBalance + creditAmount

    // Record purchase
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

    // Credit the ledger
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
