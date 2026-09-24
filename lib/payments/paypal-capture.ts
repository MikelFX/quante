// PayPal: capture an approved order and mark the store order paid. Server-only.
//
// Shared by the buyer's return (GET /api/payments/paypal/notify) and the reconcile
// cron (/api/payments/paypal/reconcile), which re-runs it for orders that are still
// 'pending' — a capture that was PENDING (eCheck, risk review) and has since completed,
// or a buyer who approved but never came back to the return URL.
//
// Security: nothing in a request is trusted. The capture runs against PayPal's API with
// the merchant's own credentials, and the order is only marked paid when PayPal's
// authoritative response says the capture is COMPLETED, the captured amount + currency
// equal the order total, and the reference_id is our order. Sandbox captures (project
// in test mode) are recorded as 'test_paid', never 'paid', and send no emails.
//
// Idempotent: capturing twice is answered with ORDER_ALREADY_CAPTURED (the provider then
// reads the order), and every status change is a conditional update from 'pending', so
// emails and the stock decrement happen exactly once.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, paypalForProject } from '@/lib/payments/project-providers'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'
import { decrementStockForOrder } from '@/lib/payments/stock'

export type PayPalCaptureResult = {
  ok: boolean
  error?: string
  status?: number
  // Capture exists but PayPal hasn't released the money yet — the order stays 'pending'
  // and the reconcile cron picks it up later.
  pending?: boolean
}

// Capture statuses after which no money will ever arrive for this capture.
const FAILED_CAPTURE_STATUSES = new Set(['DECLINED', 'FAILED'])

async function markPayPalOrderFailed(orderId: string): Promise<void> {
  await supabaseAdmin
    .from('store_orders')
    .update({ payment_status: 'failed', status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('payment_status', 'pending')
}

export async function findPayPalOrder(paypalOrderId: string) {
  const { data } = await supabaseAdmin
    .from('store_orders')
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address, payment_status')
    .eq('payment_ref', paypalOrderId)
    .eq('payment_method', 'paypal')
    .limit(1)
    .maybeSingle()
  return data
}

export async function captureAndMarkPaid(paypalOrderId: string): Promise<PayPalCaptureResult> {
  const order = await findPayPalOrder(paypalOrderId)
  if (!order) return { ok: false, error: 'Unknown order', status: 404 }
  if (order.payment_status === 'paid' || order.payment_status === 'test_paid') return { ok: true } // idempotent retry
  // Never capture money for an order that is no longer awaiting payment
  // (cancelled / failed / refunded) — it could not be marked paid afterwards.
  if (order.payment_status !== 'pending') {
    return { ok: false, error: `Order is ${order.payment_status}`, status: 409 }
  }

  const creds = await getProjectPaymentCreds(order.project_id)
  const provider = paypalForProject(creds)
  if (!provider) return { ok: false, error: 'PayPal not configured', status: 503 }

  const capture = await provider.captureOrder(paypalOrderId)

  if (capture.captureStatus && FAILED_CAPTURE_STATUSES.has(capture.captureStatus)) {
    console.warn(`[paypal] order ${order.id}: capture ${capture.captureStatus} — marked failed`)
    await markPayPalOrderFailed(order.id)
    return { ok: false, error: `Capture ${capture.captureStatus}`, status: 409 }
  }
  // Both the order AND its capture must be COMPLETED — a PENDING capture (eCheck, risk
  // review) means the money has not arrived yet. Left 'pending' for the reconcile cron.
  if (capture.status !== 'COMPLETED' || capture.captureStatus !== 'COMPLETED') {
    console.warn(`[paypal] order ${order.id}: order ${capture.status}, capture ${capture.captureStatus} — not marked paid yet`)
    return { ok: false, pending: true, error: `Capture not completed (${capture.captureStatus ?? capture.status})`, status: 409 }
  }
  // Compare in minor units, exactly (PayPal zero-decimal currencies are refused at
  // payment creation, so every amount here has two decimals).
  const capturedCents = capture.amountValue === null ? null : Math.round(capture.amountValue * 100)
  if (capturedCents === null || capturedCents !== order.total_cents) {
    console.error(`[paypal] amount mismatch: captured ${capture.amountValue}, expected ${order.total_cents / 100} (order ${order.id})`)
    return { ok: false, error: 'Amount mismatch', status: 409 }
  }
  if (!capture.currency || capture.currency.toLowerCase() !== String(order.currency).toLowerCase()) {
    console.error(`[paypal] currency mismatch: captured ${capture.currency}, expected ${order.currency} (order ${order.id})`)
    return { ok: false, error: 'Currency mismatch', status: 409 }
  }
  // We always create PayPal orders with reference_id = our order id.
  if (capture.referenceId !== order.id) {
    console.error(`[paypal] reference mismatch: ${capture.referenceId} vs ${order.id}`)
    return { ok: false, error: 'Reference mismatch', status: 409 }
  }

  // Sandbox base URL was used (creds.testMode) — not real money.
  const paidStatus = creds.testMode ? 'test_paid' : 'paid'
  // Atomic pending → paid transition: exactly one delivery wins, so emails and the
  // stock decrement happen once however often PayPal / the buyer's browser / the cron
  // retries.
  const { data: updated } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: paidStatus,
      ...(paidStatus === 'paid' ? { status: 'paid' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()

  if (updated && paidStatus === 'paid') {
    await decrementStockForOrder(order)
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return { ok: true }
}

// Reconcile one still-pending PayPal order (cron). Only APPROVED / COMPLETED orders are
// captured — an order the buyer never approved is left alone (or cancelled once PayPal
// reports it VOIDED).
export async function reconcilePayPalOrder(paypalOrderId: string): Promise<'paid' | 'pending' | 'cancelled' | 'skipped' | 'error'> {
  const order = await findPayPalOrder(paypalOrderId)
  if (!order || order.payment_status !== 'pending') return 'skipped'

  const creds = await getProjectPaymentCreds(order.project_id)
  const provider = paypalForProject(creds)
  if (!provider) return 'skipped'

  const state = await provider.getOrderState(paypalOrderId)
  if (state === 'VOIDED') {
    await supabaseAdmin
      .from('store_orders')
      .update({ payment_status: 'cancelled', status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('payment_status', 'pending')
    return 'cancelled'
  }
  if (state !== 'APPROVED' && state !== 'COMPLETED') return 'skipped'

  const result = await captureAndMarkPaid(paypalOrderId)
  if (result.ok) return 'paid'
  return result.pending ? 'pending' : 'error'
}
