// Comgate payment notification webhook.
// Called by Comgate when a payment is completed, cancelled, or refunded.
// Docs: https://help.comgate.cz/docs/notifications
//
// Security:
//   - The notification is authenticated against the PROJECT's own Comgate secret only
//     (no platform fallback — see lib/payments/project-providers.ts).
//   - No notification is trusted on its own: we pull the authoritative status from
//     Comgate's /status API with the merchant's credentials, require the transaction's
//     refId to be this order, and require the paid amount + currency to match the
//     order before marking it paid.
//   - Idempotent: each transition is a conditional update (paid only from 'pending'),
//     so emails and the stock decrement happen exactly once per order.
//   - Test/sandbox payments (Comgate `test=true`, or the project in test mode) never
//     mark an order 'paid' — they are recorded as 'test_paid' and send no customer
//     "payment received" emails, so a merchant can't be tricked into shipping goods
//     for a simulated payment.

import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, comgateSecretForProject, comgateForProject } from '@/lib/payments/project-providers'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'
import { decrementStockForOrder } from '@/lib/payments/stock'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function verifyComgateHmac(params: URLSearchParams, secret: string): boolean {
  const received = params.get('hmac')
  if (!received) return false

  // Sort all params alphabetically (excluding 'hmac'), reconstruct as query string
  const sorted = [...params.entries()]
    .filter(([k]) => k !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))

  const message = new URLSearchParams(sorted).toString()
  const expected = createHmac('sha256', secret).update(message).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}

// Comgate's documented push notification carries the merchant `secret`; some setups
// sign with an hmac instead. Either must match the project's own secret.
function verifyComgateNotification(params: URLSearchParams, secret: string): boolean {
  if (params.get('hmac')) return verifyComgateHmac(params, secret)
  const sent = params.get('secret')
  return !!sent && safeEqual(sent, secret)
}

export async function POST(request: Request) {
  const body = await request.text()
  const params = new URLSearchParams(body)

  const transId = params.get('transId')
  const status = params.get('status')       // PAID, CANCELLED, REFUNDED
  const refId = params.get('refId')         // our orderId

  if (!transId || !status || !refId) {
    return new Response('Missing params', { status: 400 })
  }

  // Resolve the project's Comgate secret BEFORE trusting anything in the payload.
  const { data: pendingOrder } = await supabaseAdmin
    .from('store_orders')
    .select('project_id, payment_ref, total_cents, currency')
    .eq('id', refId)
    .maybeSingle()
  if (!pendingOrder) return new Response('Unknown order', { status: 404 })

  const creds = await getProjectPaymentCreds(pendingOrder.project_id)
  const secret = comgateSecretForProject(creds)
  if (!secret || !verifyComgateNotification(params, secret)) {
    return new Response('Forbidden', { status: 403 })
  }

  // The notification must be for the transaction we created for this order, on the
  // merchant's own Comgate account.
  const merchant = params.get('merchant')
  if (merchant && creds.comgateMerchantId && merchant !== creds.comgateMerchantId) {
    return new Response('Forbidden', { status: 403 })
  }
  if (pendingOrder.payment_ref && pendingOrder.payment_ref !== transId) {
    console.error(`[comgate/notify] transId ${transId} does not match order ${refId} payment_ref`)
    return new Response('Forbidden', { status: 403 })
  }

  const isTest = params.get('test') === 'true' || creds.testMode
  if (params.get('test') === 'true' && !creds.testMode) {
    // A sandbox notification for a store that is in live mode — never a real payment.
    console.error(`[comgate/notify] test notification for live-mode project ${pendingOrder.project_id} (order ${refId}) — ignored`)
    return new Response('OK', { status: 200 })
  }

  if (!['PAID', 'CANCELLED', 'REFUNDED'].includes(status)) return new Response('OK', { status: 200 })

  // Pull the authoritative state from Comgate (merchant's own credentials) instead of
  // trusting the push payload — for every state change, not just PAID.
  const provider = comgateForProject(creds)
  if (!provider) return new Response('Comgate not configured', { status: 503 })
  let verified
  try {
    verified = await provider.getStatus(transId)
  } catch (err) {
    console.error('[comgate/notify] status check failed:', err)
    return new Response('Status check failed', { status: 502 })
  }

  // The transaction must be the one Comgate created for THIS order on the merchant's
  // own account.
  if (verified.refId !== refId) {
    console.error(`[comgate/notify] transId ${transId} belongs to refId ${verified.refId}, not order ${refId}`)
    return new Response('Forbidden', { status: 403 })
  }
  if (verified.merchantRef && creds.comgateMerchantId && verified.merchantRef !== creds.comgateMerchantId) {
    return new Response('Forbidden', { status: 403 })
  }
  if (verified.test && !creds.testMode) {
    console.error(`[comgate/notify] sandbox transaction ${transId} for live-mode project ${pendingOrder.project_id} (order ${refId}) — ignored`)
    return new Response('OK', { status: 200 })
  }

  let newStatus: 'paid' | 'test_paid' | 'cancelled' | 'refunded'
  // Which current payment_status each transition may start from. The conditional
  // update below makes every transition happen at most once (idempotent retries).
  let from: string[]
  if (verified.status === 'paid') {
    const currencyOk = !!verified.currency && verified.currency.toLowerCase() === String(pendingOrder.currency).toLowerCase()
    if (verified.paidAmount !== pendingOrder.total_cents || !currencyOk) {
      console.error(`[comgate/notify] amount mismatch for order ${refId}: paid ${verified.paidAmount} ${verified.currency}, expected ${pendingOrder.total_cents} ${pendingOrder.currency}`)
      return new Response('Amount mismatch', { status: 409 })
    }
    newStatus = isTest || verified.test ? 'test_paid' : 'paid'
    from = ['pending']
  } else if (verified.status === 'cancelled') {
    newStatus = 'cancelled'
    from = ['pending']
  } else if (verified.status === 'refunded') {
    newStatus = 'refunded'
    from = ['paid', 'test_paid']
  } else {
    // The push reported a final state (PAID / CANCELLED / REFUNDED) but /status still
    // says pending/authorized — a replication race on Comgate's side. Non-2xx so Comgate
    // re-sends the notification instead of the order staying 'pending' forever.
    console.warn(`[comgate/notify] push ${status} for ${transId} but /status is still ${verified.status} — asking Comgate to retry`)
    return new Response('Status not settled yet', { status: 503 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newStatus,
      ...(newStatus === 'paid' ? { status: 'paid' } : {}),
      payment_ref: transId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', refId)
    .in('payment_status', from)
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address')
    .maybeSingle()

  // Emails + stock only on the one delivery that actually moved pending → paid.
  if (order && newStatus === 'paid') {
    await decrementStockForOrder(order)
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return new Response('OK', { status: 200 })
}
