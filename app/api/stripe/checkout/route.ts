import { createClient } from '@/lib/supabase/server'
import { stripe, CREDIT_PACKS, isStripeConfigured } from '@/lib/stripe'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured on this instance.' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { packId } = await request.json()
  const pack = CREDIT_PACKS.find((p) => p.id === packId)
  if (!pack) return NextResponse.json({ error: 'Invalid pack ID.' }, { status: 400 })

  const { origin } = new URL(request.url)

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${pack.credits} Quante Credits`,
            description: pack.description,
          },
          unit_amount: pack.priceEurCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${origin}/billing?success=1&credits=${pack.credits}`,
    cancel_url: `${origin}/billing?cancelled=1`,
    metadata: {
      userId: user.id,
      credits: String(pack.credits),
      packId: pack.id,
    },
  })

  return NextResponse.json({ url: session.url })
}
