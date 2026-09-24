// POST /api/projects/[id]/store-orders/[orderId]/zasilkovna-shipment
// Creates a Packeta parcel for a store_order and marks it as shipped.
// Authenticated via Clerk (merchant's own Studio session).
//
// SECURITY (final audit F3): same transition + mail guards as the store-key route
// (app/api/store/orders/[orderId]/zasilkovna-shipment) — see ../../_lib/ship-guard.ts.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createPacketaParcel } from '@/lib/zasilkovna'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { shipRefusal, claimShipped, releaseShipped, sendGuardedShippingMail, safeTrackingUrl, type ShippableOrder } from '../../_lib/ship-guard'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params

  // Ownership check (service-role client — RLS does not protect us here).
  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Get Zásilkovna credentials
  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('zasilkovna_api_key, zasilkovna_api_password')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!secrets?.zasilkovna_api_key || !secrets?.zasilkovna_api_password) {
    return NextResponse.json({ error: 'Zásilkovna API credentials not configured. Add them in Admin → Settings.' }, { status: 422 })
  }

  // Get order
  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  // No shipping_method check — the merchant picks the carrier in the unified dropdown.
  // A pickup branch is still required, so only Packeta-widget orders qualify.
  if (!order.zasilkovna_branch_id) {
    return NextResponse.json({ error: 'No Zásilkovna branch selected on this order' }, { status: 422 })
  }
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', barcode: order.tracking_code }, { status: 409 })
  }
  const from = order as ShippableOrder
  const refusal = shipRefusal(from)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })

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

  // Claim the order BEFORE creating the parcel (compare-and-set on status + payment
  // status): only one of two concurrent requests creates a parcel and sends a mail.
  if (!(await claimShipped(projectId, orderId, from))) {
    return NextResponse.json({ error: 'Order was changed by another request. Reload and try again.' }, { status: 409 })
  }
  const prevTrackingCode = (order.tracking_code as string | null) ?? null

  let parcel: Awaited<ReturnType<typeof createPacketaParcel>>
  try {
    // zasilkovna_api_password is AES-256-GCM encrypted at rest (see settings/route.ts) —
    // zasilkovna_api_key itself stays plaintext, it's also pushed to the deployed store's
    // public NEXT_PUBLIC_ZASILKOVNA_API_KEY env var. decryptSecret() transparently passes
    // through legacy plaintext rows.
    parcel = await createPacketaParcel({
      apiKey: secrets.zasilkovna_api_key as string,
      apiPassword: decryptSecret(secrets.zasilkovna_api_password as string) as string,
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
    // No parcel was created — release the claim so the merchant can retry.
    await releaseShipped(projectId, orderId, from.status, prevTrackingCode)
    const msg = err instanceof Error ? err.message : 'Packeta API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const trackingUrl = safeTrackingUrl(parcel.trackingUrl) ?? null
  const { error: trackErr } = await supabaseAdmin
    .from('store_orders')
    .update({
      tracking_code: parcel.barcode,
      tracking_url: trackingUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('project_id', projectId)
  if (trackErr) console.error('[store-orders/zasilkovna] parcel created but tracking not saved', { orderId, barcode: parcel.barcode, error: trackErr.message })

  // Shipping mail: only to the address stored on the order, only because this request
  // claimed the transition, within the mail caps.
  await sendGuardedShippingMail({
    projectId,
    orderId,
    customerEmail: order.customer_email as string | null,
    order: from,
    orderNumber: order.order_number,
    customerName: order.customer_name as string | null,
    trackingCode: parcel.barcode,
    trackingUrl,
    carrier: 'Zásilkovna',
  })

  return NextResponse.json({ ok: true, barcode: parcel.barcode, trackingUrl: parcel.trackingUrl })
}
