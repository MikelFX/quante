// POST /api/store/orders/[orderId]/zasilkovna-shipment
// Creates a Packeta parcel for the order and marks it as shipped.
// Requires: order has shipping_method=zasilkovna and zasilkovna_branch_id set.
// Auth: Bearer QUANTE_API_KEY

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createPacketaParcel } from '@/lib/zasilkovna'
import { shippingEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { isUuid } from '@/lib/auth/project'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { authenticateStoreKey } from '../../../_lib/store-auth'
import { reserveOrderMailSlot } from '../../../_lib/order-mail'
import { reserveUnpaidMailSlotIfNeeded } from '@/lib/order-emails'

interface Context {
  params: Promise<{ orderId: string }>
}

export async function POST(request: Request, { params }: Context) {
  const { orderId } = await params

  const rl = rateLimit(`store-zasilkovna:${getClientIp(request)}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const secret = await authenticateStoreKey<{ zasilkovna_api_key: string | null; zasilkovna_api_password: string | null }>(
    request,
    'zasilkovna_api_key, zasilkovna_api_password',
  )
  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!secret.zasilkovna_api_key || !secret.zasilkovna_api_password) {
    return NextResponse.json({ error: 'Zásilkovna API credentials not configured for this project' }, { status: 422 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.shipping_method !== 'zasilkovna' && order.shipping_method !== 'packeta_international') {
    return NextResponse.json({ error: 'Order shipping method is not Packeta/Zásilkovna' }, { status: 422 })
  }
  if (!order.zasilkovna_branch_id) {
    return NextResponse.json({ error: 'No Zásilkovna branch selected on this order' }, { status: 422 })
  }
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', barcode: order.tracking_code }, { status: 409 })
  }
  // Same transition rule as PATCH /api/store/orders/[orderId]: ship from pending only for
  // cash-on-delivery / bank-transfer orders, and from paid only when the order is offline
  // or its online payment was confirmed by the provider (payment_status 'paid').
  const fromStatus = order.status as string
  const fromPaymentStatus = (order.payment_status as string | null) ?? null
  const offline = order.payment_method === 'dobirka' || order.payment_method === 'prevod'
  if (!((fromStatus === 'paid' && (offline || fromPaymentStatus === 'paid')) || (fromStatus === 'pending' && offline))) {
    return NextResponse.json({
      error: fromStatus === 'paid'
        ? 'The payment for this order has not been confirmed by the payment provider'
        : `Order cannot be shipped from status ${fromStatus}`,
    }, { status: 409 })
  }

  const body = await request.json().catch(() => ({})) as {
    weight?: unknown
    size?: { width?: unknown; height?: unknown; depth?: unknown }
  }
  // Parcel dimensions go to Packeta — accept only sane positive numbers.
  const pos = (v: unknown, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 && n <= max ? n : undefined
  }
  const weight = pos(body.weight, 50)
  const size = body.size && pos(body.size.width, 300) && pos(body.size.height, 300) && pos(body.size.depth, 300)
    ? { width: Number(body.size.width), height: Number(body.size.height), depth: Number(body.size.depth) }
    : undefined

  // Claim the order BEFORE creating the parcel: compare-and-set to shipped on the status
  // and payment status read above. Of two concurrent requests only one gets the row, so
  // only one (paid, possibly COD) Packeta parcel is created and only one mail goes out.
  // If Packeta then fails, the claim is released again (see below).
  const claimBase = supabaseAdmin
    .from('store_orders')
    .update({ status: 'shipped', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
    .eq('status', fromStatus)
  const { data: claimed, error: claimError } = await (fromPaymentStatus === null
    ? claimBase.is('payment_status', null)
    : claimBase.eq('payment_status', fromPaymentStatus))
    .select('id')
    .maybeSingle()
  if (claimError) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!claimed) {
    return NextResponse.json({ error: 'Order was changed by another request. Reload and try again.' }, { status: 409 })
  }
  const prevTrackingCode = (order.tracking_code as string | null) ?? null

  let parcel: Awaited<ReturnType<typeof createPacketaParcel>>
  try {
    // zasilkovna_api_password is AES-256-GCM encrypted at rest (see settings/route.ts);
    // decryptSecret() transparently passes through legacy plaintext rows.
    parcel = await createPacketaParcel({
      apiKey: secret.zasilkovna_api_key,
      apiPassword: decryptSecret(secret.zasilkovna_api_password) as string,
      orderId,
      orderNumber: order.order_number,
      customerName: order.customer_name ?? 'Zákazník',
      customerEmail: order.customer_email ?? '',
      customerPhone: order.customer_phone ?? undefined,
      branchId: order.zasilkovna_branch_id,
      branchCountry: (order.zasilkovna_branch_country as string | null) ?? 'cz',
      currency: (order.currency as string).toUpperCase(),
      value: order.total_cents / 100,
      weight: weight ?? (order.parcel_weight_kg as number | null) ?? 1,
      size: size ?? (order.parcel_size as { width: number; height: number; depth: number } | null) ?? undefined,
      cod: order.payment_method === 'dobirka' ? order.total_cents / 100 : 0,
    })
  } catch (err) {
    // No parcel was created — release the claim so the merchant can retry (or fall back
    // to a manual PATCH). Conditioned on the claimed state: if anything changed the order
    // meanwhile, that change wins and the order is left as it is.
    const releaseBase = supabaseAdmin
      .from('store_orders')
      .update({ status: fromStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('project_id', secret.project_id)
      .eq('status', 'shipped')
    const { data: released } = await (prevTrackingCode === null
      ? releaseBase.is('tracking_code', null)
      : releaseBase.eq('tracking_code', prevTrackingCode))
      .select('id')
      .maybeSingle()
    if (!released) console.error('[store/zasilkovna] could not release shipment claim', { projectId: secret.project_id, orderId })
    // Caller is the authenticated merchant; the Packeta reason is actionable for them.
    const msg = err instanceof Error ? err.message : 'Packeta API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { error: trackErr } = await supabaseAdmin
    .from('store_orders')
    .update({
      tracking_code: parcel.barcode,
      tracking_url: parcel.trackingUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
  if (trackErr) console.error('[store/zasilkovna] parcel created but tracking not saved', { orderId, barcode: parcel.barcode, error: trackErr.message })

  // Send shipping notification email (only to the address stored on the order, only
  // because this request claimed the transition to shipped, within the mail caps).
  if (
    order.customer_email
    && await reserveOrderMailSlot(secret.project_id, orderId, order.customer_email as string)
    && await reserveUnpaidMailSlotIfNeeded(secret.project_id, order as { payment_method?: string | null; payment_status?: string | null })
  ) {
    const ctx = await loadStoreEmailContext(secret.project_id)
    if (ctx) {
      const { subject, html } = shippingEmail({
        orderNumber: order.order_number,
        customerName: order.customer_name ?? 'zákazníku',
        storeName: ctx.storeName,
        accentColor: ctx.accentColor,
        merchantEmail: ctx.merchantEmail,
        merchantName: ctx.merchantName,
        trackingCode: parcel.barcode,
        trackingUrl: parcel.trackingUrl,
        carrier: 'Zásilkovna',
      })
      await sendEmail(order.customer_email, subject, html, await getProjectFromEmail(secret.project_id, ctx.storeName))
    }
  }

  return NextResponse.json({ ok: true, barcode: parcel.barcode, trackingUrl: parcel.trackingUrl })
}
