// GoPay payment notification webhook.
// Called by GoPay when a payment state changes.
// Docs: https://doc.gopay.com/#payment-notification
//
// Security: GoPay does not sign webhook calls with HMAC. Instead, the webhook
// only carries a payment ID; we call GoPay's own API to fetch the authoritative
// status. A forged webhook with a fake ID either fails our API call or returns
// the real status for that ID — neither lets an attacker mark an unrelated order
// as paid. This pull-based verification is the pattern GoPay recommends.
//
// A payment only marks the order paid when the amount + currency GoPay reports match
// the order, and never when it came from the sandbox (project in test mode) — those
// are recorded as 'test_paid' with no "payment received" emails.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, gopayForProject, type ProjectPaymentCreds } from '@/lib/payments/project-providers'
import type { PaymentStatusResult } from '@/lib/payments/types'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'
import { decrementStockForOrder } from '@/lib/payments/stock'

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams
  const paymentId = params.get('id')

  if (!paymentId || !/^\d{1,20}$/.test(paymentId)) return new Response('Missing id', { status: 400 })

  // Look up the order first so we can use the merchant's own GoPay credentials. GoPay
  // payment ids are plain integers per environment, so a sandbox and a live payment can
  // share one: take every GoPay order with this id and keep the one whose merchant
  // credentials confirm it (order_number = our order id, on the project's own GoID).
  const { data: candidates } = await supabaseAdmin
    .from('store_orders')
    .select('id, project_id, total_cents, currency')
    .eq('payment_ref', paymentId)
    .eq('payment_method', 'gopay')
    .limit(5)
  if (!candidates || candidates.length === 0) return new Response('Unknown payment', { status: 404 })

  let pendingOrder: { id: string; project_id: string; total_cents: number; currency: string } | null = null
  let creds: ProjectPaymentCreds | null = null
  let status: PaymentStatusResult | null = null
  let lastFailure: Response = new Response('Forbidden', { status: 403 })
  for (const candidate of candidates as Array<{ id: string; project_id: string; total_cents: number; currency: string }>) {
    const candidateCreds = await getProjectPaymentCreds(candidate.project_id)
    const provider = gopayForProject(candidateCreds)
    if (!provider) { lastFailure = new Response('GoPay not configured', { status: 503 }); continue }

    let candidateStatus
    try {
      candidateStatus = await provider.getStatus(paymentId)
    } catch (err) {
      console.error('[gopay/notify] status check failed:', err)
      lastFailure = new Response('Status check failed', { status: 502 })
      continue
    }

    // The payment must be the one we created for THIS order (order_number = our order
    // id) on the merchant's own GoID.
    if (candidateStatus.refId !== String(candidate.id).slice(0, 64)) {
      console.error(`[gopay/notify] payment ${paymentId} has order_number ${candidateStatus.refId}, expected order ${candidate.id}`)
      continue
    }
    if (candidateStatus.merchantRef && candidateCreds.gopayGoId && candidateStatus.merchantRef !== String(candidateCreds.gopayGoId)) {
      console.error(`[gopay/notify] payment ${paymentId} belongs to GoID ${candidateStatus.merchantRef}, not the project's`)
      continue
    }
    pendingOrder = candidate
    creds = candidateCreds
    status = candidateStatus
    break
  }
  if (!pendingOrder || !creds || !status) return lastFailure

  let newPaymentStatus: 'paid' | 'test_paid' | 'cancelled' | 'refunded'
  // Which current payment_status each transition may start from. The conditional
  // update below makes every transition happen at most once (idempotent retries).
  let from: string[]
  if (status.status === 'paid') {
    const currencyOk = !!status.currency && status.currency.toLowerCase() === String(pendingOrder.currency).toLowerCase()
    if (status.paidAmount !== pendingOrder.total_cents || !currencyOk) {
      console.error(`[gopay/notify] amount mismatch for payment ${paymentId}: paid ${status.paidAmount} ${status.currency}, expected ${pendingOrder.total_cents} ${pendingOrder.currency}`)
      return new Response('Amount mismatch', { status: 409 })
    }
    // Sandbox gateway (creds.testMode) — not real money.
    newPaymentStatus = creds.testMode ? 'test_paid' : 'paid'
    from = ['pending']
  } else if (status.status === 'cancelled' || status.status === 'expired') {
    newPaymentStatus = 'cancelled'
    from = ['pending']
  } else if (status.status === 'refunded') {
    newPaymentStatus = 'refunded'
    from = ['paid', 'test_paid']
  } else if (status.status === 'partially_refunded') {
    // The order stays paid (part of the money was kept) — never flipped to 'refunded'.
    console.warn(`[gopay/notify] payment ${paymentId} partially refunded (order ${pendingOrder.id}) — payment_status unchanged`)
    return new Response('OK', { status: 200 })
  } else {
    // Still CREATED / PAYMENT_METHOD_CHOSEN / AUTHORIZED. GoPay notifies on every state
    // change (incl. these intermediate ones) and carries no state in the push, so a
    // pending read is normal — acknowledge; the notification for the final state follows.
    return new Response('OK', { status: 200 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newPaymentStatus,
      ...(newPaymentStatus === 'paid' ? { status: 'paid' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingOrder.id)
    .eq('payment_ref', paymentId)
    .in('payment_status', from)
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address')
    .maybeSingle()

  // Emails + stock only on the one delivery that actually moved pending → paid.
  if (order && newPaymentStatus === 'paid') {
    await decrementStockForOrder(order)
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return new Response('OK', { status: 200 })
}
