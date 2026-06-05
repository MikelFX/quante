import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type Stripe from 'stripe'

// Disable body parsing — we need the raw bytes for signature verification
export const config = { api: { bodyParser: false } }

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, credits } = session.metadata ?? {}

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

  return new Response('ok', { status: 200 })
}
