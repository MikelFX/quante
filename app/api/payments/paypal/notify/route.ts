// POST /api/payments/paypal/notify
// Handles PayPal order capture after buyer approval.
//
// Security: the payload is never trusted. We call PayPal's capture API with the
// merchant's own credentials and only mark the order paid when PayPal's
// authoritative response says COMPLETED, the captured amount matches our order
// total, and the reference_id matches our order — a forged request cannot mark
// anything paid without a real completed PayPal payment of the right amount.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, paypalForProject } from '@/lib/payments/project-providers'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'

async function captureAndMarkPaid(paypalOrderId: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address, payment_status')
    .eq('payment_ref', paypalOrderId)
    .maybeSingle()
  if (!order) return { ok: false, error: 'Unknown order', status: 404 }
  if (order.payment_status === 'paid') return { ok: true } // idempotent retry

  const creds = await getProjectPaymentCreds(order.project_id)
  const provider = paypalForProject(creds)
  if (!provider) return { ok: false, error: 'PayPal not configured', status: 503 }

  const capture = await provider.captureOrder(paypalOrderId)

  if (capture.status !== 'COMPLETED') {
    return { ok: false, error: `Capture not completed (${capture.status})`, status: 409 }
  }
  const expected = order.total_cents / 100
  if (capture.amountValue === null || Math.abs(capture.amountValue - expected) > 0.01) {
    console.error(`[paypal/notify] amount mismatch: captured ${capture.amountValue}, expected ${expected} (order ${order.id})`)
    return { ok: false, error: 'Amount mismatch', status: 409 }
  }
  if (capture.referenceId && capture.referenceId !== order.id) {
    console.error(`[paypal/notify] reference mismatch: ${capture.referenceId} vs ${order.id}`)
    return { ok: false, error: 'Reference mismatch', status: 409 }
  }

  const { data: updated } = await supabaseAdmin
    .from('store_orders')
    .update({ payment_status: 'paid', status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .neq('payment_status', 'paid')
    .select('id')
    .maybeSingle()

  if (updated) {
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return { ok: true }
}

export async function POST(request: Request) {
  let body: { orderID?: string; token?: string } = {}
  try { body = await request.json() } catch { /* PayPal may send form-encoded */ }

  const orderId = body.orderID ?? body.token
  if (!orderId) return NextResponse.json({ error: 'Missing order ID' }, { status: 400 })

  try {
    const result = await captureAndMarkPaid(orderId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
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

  try {
    const result = await captureAndMarkPaid(token)
    if (!result.ok) return NextResponse.redirect(new URL(`/?paypal_error=1`, request.url))
    return NextResponse.redirect(new URL(`/?paypal_success=1`, request.url))
  } catch (err) {
    console.error('[paypal/notify GET] capture failed:', err)
    return NextResponse.redirect(new URL(`/?paypal_error=1`, request.url))
  }
}
