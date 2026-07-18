// Comgate payment notification webhook.
// Called by Comgate when a payment is completed, cancelled, or refunded.
// Docs: https://help.comgate.cz/docs/notifications
//
// HMAC is verified against the project's own Comgate secret (merchants use
// their own gateway accounts), falling back to the platform COMGATE_SECRET.

import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, comgateSecretForProject } from '@/lib/payments/project-providers'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'

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
    .select('project_id')
    .eq('id', refId)
    .maybeSingle()
  if (!pendingOrder) return new Response('Unknown order', { status: 404 })

  const creds = await getProjectPaymentCreds(pendingOrder.project_id)
  const secret = comgateSecretForProject(creds)
  if (!secret || !verifyComgateHmac(params, secret)) {
    return new Response('Forbidden', { status: 403 })
  }

  const newStatus = status === 'PAID' ? 'paid'
    : status === 'CANCELLED' ? 'cancelled'
    : status === 'REFUNDED' ? 'refunded'
    : 'pending'

  // .neq guard makes repeated notifications idempotent — no duplicate emails.
  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newStatus,
      ...(newStatus === 'paid' ? { status: 'paid' } : {}),
      payment_ref: transId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', refId)
    .neq('payment_status', newStatus)
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address')
    .maybeSingle()

  if (order && status === 'PAID') {
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return new Response('OK', { status: 200 })
}
