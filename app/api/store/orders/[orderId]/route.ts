// PATCH /api/store/orders/[orderId] — update order status (auth: QUANTE_API_KEY)
// Used by the exported store's admin panel to mark orders as shipped, cancelled, etc.
// Sending status=shipped with trackingCode/trackingUrl triggers the shipping email.
//
// SECURITY (re-audit R8): status changes are compare-and-set transitions, so every
// customer mail is tied to a real, one-time state change. "Offline" = cash on delivery
// (dobirka) or bank transfer (prevod); "confirmed" = payment_status 'paid', which only
// the payment webhooks / notify handlers set for online methods (sandbox payments are
// 'test_paid' and never count):
//   pending → paid        offline only — the merchant records the money (no mail).
//                         Online orders become paid only through their provider.
//   shipped → paid        offline only — cash collected after shipping: records
//                         payment_status 'paid', the status stays 'shipped' (no mail)
//   paid    → shipped     offline, or online with a confirmed payment (shipping mail)
//   pending → shipped     offline only (shipping mail)
//   paid | shipped → refunded
//                         confirmed payment, or an offline order the merchant marked
//                         paid (refund mail)
//   pending | paid → cancelled   (no mail)
// Nothing moves an order back to pending/paid status, `shipped` can be entered once and
// `refunded` is terminal, so each mail can fire at most once per order. The UPDATE is
// conditioned on the status AND payment_status that were read (a concurrent change makes
// it match no row → 409) and mail is sent only when the UPDATE actually changed a row.
// The tracking URL can only be set together with the transition to shipped (https only,
// via safeHttpUrl); a status-less PATCH may update just the tracking code (no mail).
// Every mail must also win a slot in ../../_lib/order-mail.ts (per order, per project
// and — atomically in the DB — per recipient across all stores).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { shippingEmail, refundEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { isUuid } from '@/lib/auth/project'
import { safeHttpUrl } from '@/lib/html'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { authenticateStoreKey } from '../../_lib/store-auth'
import { reserveOrderMailSlot } from '../../_lib/order-mail'
import { reserveUnpaidMailSlotIfNeeded } from '@/lib/order-emails'

const VALID_STATUSES = ['pending', 'paid', 'shipped', 'cancelled', 'refunded'] as const
type OrderStatus = typeof VALID_STATUSES[number]

// Payment methods whose orders may ship before they are paid (the money arrives on
// delivery / by transfer, confirmed by the merchant).
const OFFLINE_METHODS = new Set(['dobirka', 'prevod'])

interface Context {
  params: Promise<{ orderId: string }>
}

interface CurrentOrder {
  status: string
  payment_status: string | null
  payment_method: string | null
}

type Plan =
  | { ok: true; updates: Record<string, unknown>; resultStatus: string }
  | { ok: false; error: string }

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return s || undefined
}

/** The update a request for status `to` makes on `order`, or why it is refused. */
function planTransition(order: CurrentOrder, to: OrderStatus): Plan {
  const from = order.status
  const offline = OFFLINE_METHODS.has(order.payment_method ?? '')
  const confirmed = order.payment_status === 'paid'
  const refuse = (error: string): Plan => ({ ok: false, error })
  const cannot = () => refuse(from === to ? `Order is already ${to}` : `Order cannot change from ${from} to ${to}`)
  const unconfirmed = () => refuse('The payment for this order has not been confirmed by the payment provider')

  switch (to) {
    case 'paid':
      if (!offline) {
        return from === 'paid' ? cannot() : refuse('Online payments are confirmed by the payment provider, not through this API')
      }
      if (from === 'pending') return { ok: true, updates: { status: 'paid', payment_status: 'paid' }, resultStatus: 'paid' }
      if (from === 'shipped') {
        // Cash on delivery collected after shipping: record the payment, keep the status.
        if (confirmed) return refuse('Order is already paid')
        return { ok: true, updates: { payment_status: 'paid' }, resultStatus: 'shipped' }
      }
      return cannot()
    case 'shipped':
      if (from === 'paid' && (offline || confirmed)) return { ok: true, updates: { status: 'shipped' }, resultStatus: 'shipped' }
      if (from === 'pending' && offline) return { ok: true, updates: { status: 'shipped' }, resultStatus: 'shipped' }
      if (from === 'paid') return unconfirmed()
      return cannot()
    case 'refunded':
      if (from === 'paid' || from === 'shipped') {
        if (confirmed || (offline && from === 'paid')) return { ok: true, updates: { status: 'refunded' }, resultStatus: 'refunded' }
        return unconfirmed()
      }
      return cannot()
    case 'cancelled':
      if (from === 'pending' || from === 'paid') return { ok: true, updates: { status: 'cancelled' }, resultStatus: 'cancelled' }
      return cannot()
    case 'pending':
      return cannot()
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { orderId } = await params

  const rl = rateLimit(`store-order-patch:${getClientIp(request)}`, 60, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const secret = await authenticateStoreKey(request)
  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Order not found or update failed' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as {
    status?: OrderStatus
    trackingCode?: unknown
    trackingUrl?: unknown
    carrier?: unknown
  }

  const { status } = body
  const trackingCode = cleanText(body.trackingCode, 100)
  const carrier = cleanText(body.carrier, 60)
  // Tracking links end up as buttons in customer emails — https only.
  const hasTrackingUrl = !(body.trackingUrl === undefined || body.trackingUrl === null || body.trackingUrl === '')
  const trackingUrl = hasTrackingUrl ? safeHttpUrl(body.trackingUrl) ?? undefined : undefined
  if (hasTrackingUrl && (!trackingUrl || !trackingUrl.startsWith('https://'))) {
    return NextResponse.json({ error: 'trackingUrl must be an https URL' }, { status: 400 })
  }

  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.includes(status))) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }
  if (trackingUrl && status !== 'shipped') {
    return NextResponse.json({ error: 'trackingUrl can only be set when marking the order as shipped' }, { status: 400 })
  }
  if (trackingCode && status !== undefined && status !== 'shipped') {
    return NextResponse.json({ error: 'trackingCode can only be set when marking the order as shipped' }, { status: 400 })
  }
  if (!status && !trackingCode) {
    return NextResponse.json({ error: `status is required. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const { data: current, error: readError } = await supabaseAdmin
    .from('store_orders')
    .select('id, status, payment_status, payment_method')
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
    .maybeSingle()
  if (readError || !current) return NextResponse.json({ error: 'Order not found or update failed' }, { status: 404 })
  const before = current as CurrentOrder

  // Tracking-code-only update (no status change): stored, nothing is mailed.
  if (!status) {
    const { data: updated, error } = await supabaseAdmin
      .from('store_orders')
      .update({ tracking_code: trackingCode, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('project_id', secret.project_id)
      .select('id')
      .maybeSingle()
    if (error || !updated) return NextResponse.json({ error: 'Order not found or update failed' }, { status: 404 })
    return NextResponse.json({ ok: true, orderId, status: before.status })
  }

  const plan = planTransition(before, status)
  if (!plan.ok) return NextResponse.json({ error: plan.error, status: before.status }, { status: 409 })

  const updates: Record<string, unknown> = { ...plan.updates, updated_at: new Date().toISOString() }
  if (status === 'shipped') {
    if (trackingCode) updates.tracking_code = trackingCode
    // The link belongs to this shipment only — never mail a URL stored earlier.
    updates.tracking_url = trackingUrl ?? null
  }

  // Compare-and-set on the status AND payment status just read: a concurrent transition
  // (or a webhook changing the payment) makes this match no row, and nothing is mailed.
  const base = supabaseAdmin
    .from('store_orders')
    .update(updates)
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
    .eq('status', before.status)
  const cas = before.payment_status === null
    ? base.is('payment_status', null)
    : base.eq('payment_status', before.payment_status)
  const { data: order, error } = await cas
    .select('id, order_number, customer_name, customer_email, total_cents, currency, tracking_code, tracking_url')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Order not found or update failed' }, { status: 404 })
  if (!order) return NextResponse.json({ error: 'Order was changed by another request. Reload and try again.' }, { status: 409 })

  // Customer mails go only to the address stored on the order, only for the row this
  // request actually moved into shipped / refunded, and only within the mail caps.
  const mails = plan.resultStatus === status && (status === 'shipped' || status === 'refunded')
  if (mails && order.customer_email) {
    if (!(await reserveOrderMailSlot(secret.project_id, orderId, order.customer_email))
      || !(await reserveUnpaidMailSlotIfNeeded(secret.project_id, before))) {
      console.warn('[store/orders] customer mail rate-limited', { projectId: secret.project_id, orderId, status })
    } else {
      const ctx = await loadStoreEmailContext(secret.project_id)
      if (ctx) {
        const sender = await getProjectFromEmail(secret.project_id, ctx.storeName)
        const { subject, html } = status === 'shipped'
          ? shippingEmail({
              orderNumber: order.order_number,
              customerName: order.customer_name ?? 'zákazníku',
              storeName: ctx.storeName,
              accentColor: ctx.accentColor,
              merchantEmail: ctx.merchantEmail,
              merchantName: ctx.merchantName,
              trackingCode: order.tracking_code ?? trackingCode,
              trackingUrl: trackingUrl,
              carrier,
            })
          : refundEmail({
              orderNumber: order.order_number,
              customerName: order.customer_name ?? 'zákazníku',
              total: order.total_cents / 100,
              currency: order.currency.toUpperCase(),
              storeName: ctx.storeName,
              accentColor: ctx.accentColor,
              merchantEmail: ctx.merchantEmail,
              merchantName: ctx.merchantName,
            })
        await sendEmail(order.customer_email, subject, html, sender)
      }
    }
  }

  return NextResponse.json({ ok: true, orderId, status: plan.resultStatus })
}
