// GoPay payment notification webhook.
// Called by GoPay when a payment state changes.
// Docs: https://doc.gopay.com/#payment-notification
//
// Security: GoPay does not sign webhook calls with HMAC. Instead, the webhook
// only carries a payment ID; we call GoPay's own API to fetch the authoritative
// status. A forged webhook with a fake ID either fails our API call or returns
// the real status for that ID — neither lets an attacker mark an unrelated order
// as paid. This pull-based verification is the pattern GoPay recommends.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, gopayForProject } from '@/lib/payments/project-providers'
import { sendPaymentSuccessEmails, type PaidOrderRow } from '@/lib/order-emails'

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams
  const paymentId = params.get('id')

  if (!paymentId) return new Response('Missing id', { status: 400 })

  // Look up the order first so we can use the merchant's own GoPay credentials.
  const { data: pendingOrder } = await supabaseAdmin
    .from('store_orders')
    .select('project_id')
    .eq('payment_ref', paymentId)
    .maybeSingle()
  if (!pendingOrder) return new Response('Unknown payment', { status: 404 })

  const creds = await getProjectPaymentCreds(pendingOrder.project_id)
  const provider = gopayForProject(creds)
  if (!provider) return new Response('GoPay not configured', { status: 503 })

  const status = await provider.getStatus(paymentId)

  const newPaymentStatus =
    status.status === 'paid' ? 'paid'
    : status.status === 'cancelled' || status.status === 'expired' ? 'cancelled'
    : status.status === 'refunded' ? 'refunded'
    : null

  if (!newPaymentStatus) return new Response('OK', { status: 200 })

  // .neq guard makes repeated notifications idempotent — no duplicate emails.
  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newPaymentStatus,
      ...(newPaymentStatus === 'paid' ? { status: 'paid' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('payment_ref', paymentId)
    .neq('payment_status', newPaymentStatus)
    .select('id, project_id, order_number, customer_name, customer_email, customer_phone, total_cents, currency, items, payment_method, shipping_method, shipping_address')
    .maybeSingle()

  if (order && newPaymentStatus === 'paid') {
    await sendPaymentSuccessEmails(order as PaidOrderRow)
  }

  return new Response('OK', { status: 200 })
}
