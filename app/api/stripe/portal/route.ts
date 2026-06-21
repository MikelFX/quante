import { auth } from '@clerk/nextjs/server'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { getUserRecord } from '@/lib/tier'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await getUserRecord(userId)
  if (!record.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer found for this account.' }, { status: 404 })
  }

  const { origin } = new URL(request.url)
  const session = await stripe.billingPortal.sessions.create({
    customer: record.stripe_customer_id,
    return_url: `${origin}/billing`,
  })

  return NextResponse.json({ url: session.url })
}
