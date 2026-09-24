// Shared guards for the Clerk-authenticated Studio carrier routes (zasilkovna / gls / dhl
// shipment, byrd fulfillment). Server-only.
//
// SECURITY (final audit F3): these routes mail order.customer_email from the platform
// sender on the transition to "shipped". An unpaid online order can be created for any
// address through the public checkout, so a merchant must not be able to turn it into an
// "order shipped" mail. The routes therefore apply exactly the rules of the store-key
// order API (app/api/store/orders/[orderId]/route.ts):
//   - shipping is only allowed from `paid` (offline method, or payment_status 'paid' — a
//     provider-confirmed payment; sandbox 'test_paid' never counts) or from `pending`
//     for offline methods (dobirka / prevod);
//   - the order is claimed with a compare-and-set on status AND payment_status, so of two
//     concurrent requests only one creates the parcel and only one mail goes out;
//   - the mail goes only to the address stored on the order (never a body value), only
//     when the claim won, never for carrier test/sandbox shipments, and only if
//     reserveOrderMailSlot() grants a slot (per order, per project, per recipient
//     across all stores);
//   - an offline order whose payment was never confirmed (it may have been created
//     from the public checkout for any address) also needs a slot of the store's daily
//     unpaid-order mail budget (lib/order-emails.ts reserveUnpaidMailSlot), the same
//     budget the checkout's confirmation mails draw from (final audit F8 follow-up);
//   - branding comes from loadStoreEmailContext / getProjectFromEmail (escaped by the
//     templates), and the tracking link must be an https URL (safeHttpUrl) — the
//     shipped-mail template further only links known carrier tracking hosts.
// The pure rules (shipRefusal, safeTrackingUrl) live in ./ship-rules.ts.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { shippingEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import { loadStoreEmailContext, isUnconfirmedOfflineOrder, reserveUnpaidMailSlot } from '@/lib/order-emails'
import { getHostingGate } from '@/lib/hosting/gate'
import { reserveOrderMailSlot } from '@/app/api/store/_lib/order-mail'
import { safeTrackingUrl, type ShippableOrder } from './ship-rules'

export { shipRefusal, safeTrackingUrl, type ShippableOrder } from './ship-rules'

/**
 * Compare-and-set the order to shipped on the status + payment status that were read.
 * Returns true only when this call moved the row. `extra` is merged into the update.
 */
export async function claimShipped(
  projectId: string,
  orderId: string,
  from: ShippableOrder,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const base = supabaseAdmin
    .from('store_orders')
    .update({ ...extra, status: 'shipped', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('project_id', projectId)
    .eq('status', from.status)
  const { data, error } = await (from.payment_status === null
    ? base.is('payment_status', null)
    : base.eq('payment_status', from.payment_status))
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[store-orders/ship] claim failed', { projectId, orderId, error: error.message })
    return false
  }
  return !!data
}

/**
 * Undo a claim when the carrier call failed and no parcel exists. Conditioned on the
 * claimed state (status shipped, tracking code unchanged): if anything else changed the
 * order meanwhile, that change wins.
 */
export async function releaseShipped(
  projectId: string,
  orderId: string,
  fromStatus: string,
  prevTrackingCode: string | null,
): Promise<void> {
  const base = supabaseAdmin
    .from('store_orders')
    .update({ status: fromStatus, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('project_id', projectId)
    .eq('status', 'shipped')
  const { data } = await (prevTrackingCode === null
    ? base.is('tracking_code', null)
    : base.eq('tracking_code', prevTrackingCode))
    .select('id')
    .maybeSingle()
  if (!data) console.error('[store-orders/ship] could not release shipment claim', { projectId, orderId })
}

/**
 * Sends the "order shipped" mail to the address stored on the order — call only after
 * this request won claimShipped(). Returns true when a mail was handed to the provider.
 */
export async function sendGuardedShippingMail(args: {
  projectId: string
  orderId: string
  customerEmail: string | null | undefined
  /** The order as read before the claim — decides whether the unpaid-mail budget applies. */
  order: ShippableOrder
  orderNumber: string
  customerName: string | null | undefined
  trackingCode?: string | null
  trackingUrl?: string | null
  carrier: string
}): Promise<boolean> {
  const to = args.customerEmail
  if (!to) return false
  // The parcel already exists at this point — a mail failure must never fail the request.
  try {
    if (!(await reserveOrderMailSlot(args.projectId, args.orderId, to))) {
      console.warn('[store-orders/ship] customer mail rate-limited', { projectId: args.projectId, orderId: args.orderId })
      return false
    }
    if (isUnconfirmedOfflineOrder(args.order)) {
      const gate = await getHostingGate(args.projectId)
      const paidHosting = gate.hasActiveSubscription === true || gate.agency === true
      if (!(await reserveUnpaidMailSlot(args.projectId, paidHosting))) return false
    }
    const ctx = await loadStoreEmailContext(args.projectId)
    if (!ctx) return false
    const { subject, html } = shippingEmail({
      orderNumber: args.orderNumber,
      customerName: args.customerName ?? 'zákazníku',
      storeName: ctx.storeName,
      accentColor: ctx.accentColor,
      merchantEmail: ctx.merchantEmail,
      merchantName: ctx.merchantName,
      trackingCode: args.trackingCode ?? undefined,
      trackingUrl: safeTrackingUrl(args.trackingUrl),
      carrier: args.carrier,
    })
    return await sendEmail(to, subject, html, await getProjectFromEmail(args.projectId, ctx.storeName))
  } catch (err) {
    console.error('[store-orders/ship] shipping mail failed', { projectId: args.projectId, orderId: args.orderId, error: err instanceof Error ? err.message : err })
    return false
  }
}
