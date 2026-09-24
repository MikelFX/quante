import { auth } from '@clerk/nextjs/server'
import { stripe, isStripeConfigured, AGENCY_PRICE_ID } from '@/lib/stripe'
import { AGENCY_TRIAL_DAYS } from '@/lib/config'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

type BillingRow = {
  tier: string | null
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  subscription_status: string | null
}

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured on this instance.' }, { status: 503 })
  }

  if (!AGENCY_PRICE_ID) {
    return NextResponse.json({ error: 'Agency plan not yet available.' }, { status: 503 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read the billing row directly (not getUserRecord, which turns a DB error into an
  // empty "new user" record): during an outage a returning Agency user must not be
  // offered a fresh trial or slip past the "already active" check.
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('tier, stripe_subscription_id, stripe_customer_id, subscription_status')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[agency-checkout] users lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not load your billing details. Try again.' }, { status: 503 })
  }
  const record: BillingRow = {
    tier: data?.tier ?? null,
    stripe_subscription_id: data?.stripe_subscription_id ?? null,
    stripe_customer_id: data?.stripe_customer_id ?? null,
    subscription_status: data?.subscription_status ?? null,
  }

  if (record.tier === 'agency' && (record.subscription_status === 'active' || record.subscription_status === 'trialing')) {
    return NextResponse.json({ error: 'You already have an active Agency plan.' }, { status: 409 })
  }

  const { origin } = new URL(request.url)

  const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
    payment_method_types: ['card'],
    line_items: [{
      price: AGENCY_PRICE_ID,
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: `${origin}/billing?agency_success=1`,
    cancel_url: `${origin}/pricing?cancelled=1`,
    metadata: { userId, type: 'agency' },
    subscription_data: {
      metadata: { userId, type: 'agency' },
    },
    // Reuse the known Stripe customer so prior subscriptions (and trials) stay visible.
    ...(record.stripe_customer_id ? { customer: record.stripe_customer_id } : {}),
  }

  // The free trial is a one-time offer: never for a user who has had an Agency
  // subscription before (cancel + re-subscribe must not restart the trial).
  if (AGENCY_TRIAL_DAYS > 0 && (await isTrialEligible(record))) {
    sessionParams.subscription_data = {
      ...sessionParams.subscription_data,
      trial_period_days: AGENCY_TRIAL_DAYS,
    }
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return NextResponse.json({ url: session.url })
}

async function isTrialEligible(record: BillingRow): Promise<boolean> {
  if (record.stripe_subscription_id) return false
  if (!record.stripe_customer_id) return true
  try {
    const subs = await stripe.subscriptions.list({ customer: record.stripe_customer_id, status: 'all', limit: 100 })
    return !subs.data.some((s) => s.metadata?.type === 'agency' || s.items.data.some((i) => i.price.id === AGENCY_PRICE_ID))
  } catch (err) {
    // Fail closed: no trial if we can't prove eligibility.
    console.error('[agency-checkout] subscription history lookup failed:', err)
    return false
  }
}
