// POST /api/payments/paypal/notify
// Handles PayPal IPN (webhook) for order completion.
// Called by PayPal when the buyer approves and payment is captured.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createPayPalProvider } from '@/lib/payments/paypal'

export async function POST(request: Request) {
  let body: { orderID?: string; token?: string } = {}
  try { body = await request.json() } catch { /* PayPal may send form-encoded */ }

  const orderId = body.orderID ?? body.token
  if (!orderId) return NextResponse.json({ error: 'Missing order ID' }, { status: 400 })

  const provider = createPayPalProvider()
  if (!provider) return NextResponse.json({ error: 'PayPal not configured' }, { status: 503 })

  try {
    // Capture the payment
    await provider.captureOrder(orderId)

    // Mark the store order as paid
    await supabaseAdmin
      .from('store_orders')
      .update({ payment_status: 'paid', status: 'paid', updated_at: new Date().toISOString() })
      .eq('payment_ref', orderId)
      .eq('payment_status', 'pending')

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[paypal/notify] capture failed:', err)
    return NextResponse.json({ error: 'Capture failed' }, { status: 500 })
  }
}

// PayPal also calls GET on return URL — handle the success redirect
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const provider = createPayPalProvider()
  if (!provider) return NextResponse.json({ error: 'PayPal not configured' }, { status: 503 })

  try {
    await provider.captureOrder(token)
    await supabaseAdmin
      .from('store_orders')
      .update({ payment_status: 'paid', status: 'paid', updated_at: new Date().toISOString() })
      .eq('payment_ref', token)
      .eq('payment_status', 'pending')

    return NextResponse.redirect(new URL(`/?paypal_success=1`, request.url))
  } catch (err) {
    console.error('[paypal/notify GET] capture failed:', err)
    return NextResponse.redirect(new URL(`/?paypal_error=1`, request.url))
  }
}
