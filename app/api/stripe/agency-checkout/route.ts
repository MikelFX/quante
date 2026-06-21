import { auth } from '@clerk/nextjs/server'
import { stripe, isStripeConfigured, AGENCY_PRICE_ID } from '@/lib/stripe'
import { AGENCY_TRIAL_DAYS } from '@/lib/config'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured on this instance.' }, { status: 503 })
  }

  if (!AGENCY_PRICE_ID) {
    return NextResponse.json({ error: 'Agency plan not yet available.' }, { status: 503 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  }

  if (AGENCY_TRIAL_DAYS > 0) {
    sessionParams.subscription_data = {
      ...sessionParams.subscription_data,
      trial_period_days: AGENCY_TRIAL_DAYS,
    }
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return NextResponse.json({ url: session.url })
}
