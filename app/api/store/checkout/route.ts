// Called by deployed stores — creates a Stripe checkout session using Quante's keys.
// The deployed store never has direct Stripe credentials.

import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '5')

interface CartItem {
  id: string
  name: string
  price: number
  currency: string
  quantity: number
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || ''

  let projectId: string
  let items: CartItem[]
  try {
    const body = await request.json()
    projectId = body.projectId
    items = body.items
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!items?.length) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })

  // Verify project exists
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const totalCents = items.reduce(
    (sum, item) => sum + Math.round(item.price * 100) * item.quantity,
    0,
  )
  const platformFeeCents = Math.round(totalCents * PLATFORM_FEE_PERCENT / 100)

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map((item) => ({
        price_data: {
          currency: item.currency.toLowerCase(),
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
      metadata: {
        type: 'store_sale',
        project_id: projectId,
        platform_fee_cents: String(platformFeeCents),
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
