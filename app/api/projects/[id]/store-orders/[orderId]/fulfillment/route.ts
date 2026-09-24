// /api/projects/[id]/store-orders/[orderId]/fulfillment
// POST — sends the order to the byrd fulfillment warehouse (creates a byrd shipment).
// GET  — polls byrd for the shipment status; once tracking exists, marks the order
//        as shipped and sends the tracking e-mail to the customer.
// Authenticated via Clerk (merchant Studio session) — this route is triggered by a merchant
// clicking a button in the Studio order list, NOT automatically by the Stripe webhook.
//
// 2026-08-07: rewired onto the idempotent lib/fulfillment/auto-ship.ts path (insert-first into
// fulfillment_shipments, unique(order_id) as the DB-level duplicate guard — see
// supabase/migration-fulfillment-v2.sql). Falls back to the old direct single-attempt call
// automatically if that migration hasn't run yet, so this route keeps working exactly as
// before either way — see createShipmentDirectFallback()'s doc comment.
//
// Deliberately NOT wired into the Stripe webhook (checkout.session.completed) yet, even
// though quante-fulfillment-byrd-spec.md's ideal end state is a fully automatic order ->
// shipment flow. Reasoning: creating a fulfillment shipment triggers a real warehouse pick —
// physical goods leaving the building — the first time that becomes fully automatic for a
// merchant's store is a business-behavior decision (do they want every paid order to ship
// itself immediately, with no review step?), not just a bug fix, and out of scope for this
// pass without being asked for explicitly. The idempotent mechanism (auto-ship.ts) is fully
// built and ready — wiring it into the webhook is a small, well-contained follow-up:
// call attemptAutoCreateShipment() from the checkout.session.completed handler in
// app/api/stripe/webhook/route.ts, using the same QuanteOrder-building logic as buildQuanteOrder()
// below, and always return 200 regardless of outcome (per the spec's webhook-handler rule).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createFulfillmentProvider } from '@/lib/fulfillment/registry'
import { attemptAutoCreateShipment, createShipmentDirectFallback } from '@/lib/fulfillment/auto-ship'
import type { QuanteOrder } from '@/lib/fulfillment/types'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { shipRefusal, claimShipped, sendGuardedShippingMail, safeTrackingUrl, type ShippableOrder } from '../../_lib/ship-guard'

async function loadContext(userId: string, projectId: string, orderId: string) {
  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }
  if (!isUuid(orderId)) return { error: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('byrd_api_key, byrd_api_secret')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!secrets?.byrd_api_key || !secrets?.byrd_api_secret) {
    return { error: NextResponse.json({ error: 'byrd API credentials not configured. Add them in Admin → Settings.' }, { status: 422 }) }
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!order) return { error: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }

  // byrd_api_key/secret are AES-256-GCM encrypted at rest (see settings/route.ts);
  // decryptSecret() also transparently passes through legacy plaintext rows.
  const provider = createFulfillmentProvider('byrd', {
    apiKey: decryptSecret(secrets.byrd_api_key as string) as string,
    apiSecret: decryptSecret(secrets.byrd_api_secret as string) as string,
    projectId,
  })

  return { order, provider }
}

// Builds the provider-agnostic QuanteOrder (lib/fulfillment/types.ts) from a store_orders row.
// Exported so the future Stripe-webhook auto-ship wiring (see module header) can reuse it
// instead of re-deriving the same shape.
export function buildQuanteOrder(
  order: Record<string, unknown>,
  opts: { testMode?: boolean } = {},
): { order: QuanteOrder } | { error: string } {
  const shippingAddr = order.shipping_address as {
    ulice?: string; street?: string
    mesto?: string; city?: string
    psc?: string; zip?: string
    zeme?: string
  } | null

  const rawStreet = shippingAddr?.ulice || shippingAddr?.street || ''
  const city = shippingAddr?.mesto || shippingAddr?.city || ''
  const zip = shippingAddr?.psc || shippingAddr?.zip || ''
  const countryCode = (
    (order.shipping_country as string | null) ||
    shippingAddr?.zeme ||
    'CZ'
  ).toUpperCase()

  if (!rawStreet || !city || !zip) {
    return { error: 'Order is missing a shipping address. Customer must provide street, city and ZIP.' }
  }

  const orderItems = (order.items as Array<{ id?: string; sku?: string; name?: string; price?: number; quantity?: number }> | null) ?? []
  if (orderItems.length === 0) {
    return { error: 'Order has no items to fulfill.' }
  }

  const currency = (order.currency as string).toUpperCase()

  return {
    order: {
      id: order.id as string,
      orderNumber: order.order_number as string,
      address: {
        name: (order.customer_name as string | null) ?? 'Zákazník',
        email: (order.customer_email as string | null) ?? undefined,
        phone: (order.customer_phone as string | null) ?? undefined,
        street: rawStreet,
        city,
        postalCode: zip,
        countryCode,
      },
      // byrd matches items by SKU registered at the warehouse — product id is the fallback,
      // same convention as fulfillment_product_links (see migration-fulfillment-v2.sql).
      items: orderItems.map((i) => ({
        sku: i.sku || i.id || '',
        name: i.name ?? 'Item',
        quantity: i.quantity ?? 1,
        unitPriceCents: Math.round((i.price ?? 0) * 100),
      })),
      currency,
      totalCents: order.total_cents as number,
      isCashOnDelivery: order.payment_method === 'dobirka',
      testMode: opts.testMode ?? false,
    },
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params
  const ctx = await loadContext(userId, projectId, orderId)
  if ('error' in ctx) return ctx.error
  const { order, provider } = ctx

  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', trackingNumber: order.tracking_code }, { status: 409 })
  }
  if (order.fulfillment_ref) {
    return NextResponse.json({ error: 'Order already sent to fulfillment', byrdId: order.fulfillment_ref }, { status: 409 })
  }
  // SECURITY (final audit F3): only orders that may ship (see ../../_lib/ship-guard.ts) go
  // to the warehouse — an unpaid online order is never picked, and never mailed as shipped.
  const refusal = shipRefusal(order as ShippableOrder)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })

  const body = await request.json().catch(() => ({})) as { testMode?: unknown }
  const built = buildQuanteOrder(order, { testMode: body.testMode === true })
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 422 })

  try {
    const result = await attemptAutoCreateShipment(supabaseAdmin, { projectId, order: built.order, provider })

    if (result.outcome === 'duplicate') {
      // Another attempt (e.g. a near-simultaneous double click) already owns this order —
      // re-read the current ref rather than treating this as an error.
      const { data: fresh } = await supabaseAdmin.from('store_orders').select('fulfillment_ref, fulfillment_status').eq('id', orderId).maybeSingle()
      return NextResponse.json({ error: 'Order already sent to fulfillment', byrdId: fresh?.fulfillment_ref ?? null }, { status: 409 })
    }

    if (result.outcome === 'migration_missing') {
      // supabase/migration-fulfillment-v2.sql hasn't run yet — fall back to the old,
      // non-idempotent single-attempt path so this route still works. See
      // createShipmentDirectFallback()'s doc comment for exactly what protection is lost.
      const shipment = await createShipmentDirectFallback(supabaseAdmin, { order: built.order, provider })
      return NextResponse.json({
        ok: true,
        byrdId: shipment.externalId,
        status: shipment.status,
        subStatus: shipment.subStatus ?? null,
        warnings: shipment.warnings ?? [],
      })
    }

    if (result.outcome === 'failed') {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      byrdId: result.externalId,
      status: result.status,
      subStatus: result.subStatus ?? null,
      warnings: result.warnings ?? [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'byrd API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params
  const ctx = await loadContext(userId, projectId, orderId)
  if ('error' in ctx) return ctx.error
  const { order, provider } = ctx

  if (!order.fulfillment_ref) {
    return NextResponse.json({ error: 'Order has not been sent to fulfillment yet' }, { status: 404 })
  }

  try {
    const shipment = await provider.getShipment(order.fulfillment_ref as string)

    const trackingUrl = safeTrackingUrl(shipment.trackingUrl) ?? null
    const update: Record<string, unknown> = {
      fulfillment_status: shipment.status,
      updated_at: new Date().toISOString(),
    }

    // SECURITY (final audit F3): the move to shipped follows the same rules as every other
    // ship path (../../_lib/ship-guard.ts) — compare-and-set on status + payment status,
    // and only from a state that may ship. An order that may not (e.g. an unpaid online
    // order sent to byrd before this guard existed) only gets its tracking recorded: no
    // status change and no customer mail.
    let justShipped = false
    let tracking: Record<string, unknown> | null = null
    if (shipment.trackingNumber && order.status !== 'shipped') {
      tracking = { tracking_code: shipment.trackingNumber }
      if (trackingUrl) tracking.tracking_url = trackingUrl
      if (!shipRefusal(order as ShippableOrder)) {
        justShipped = await claimShipped(projectId, orderId, order as ShippableOrder, { ...update, ...tracking })
      }
    }

    if (!justShipped) {
      // Refused, or the claim lost a race (another poll shipped it, or the order changed
      // meanwhile): still record this poll's tracking data — never the status.
      if (tracking) Object.assign(update, tracking)
      await supabaseAdmin.from('store_orders').update(update).eq('id', orderId).eq('project_id', projectId)
    }
    await supabaseAdmin.from('fulfillment_shipments').update({
      status: shipment.status,
      tracking_number: shipment.trackingNumber ?? null,
      tracking_url: trackingUrl,
      carrier: shipment.trackingCarrier ?? null,
      updated_at: new Date().toISOString(),
    }).eq('order_id', orderId).then(() => {}, () => {}) // best-effort — table may not exist pre-migration

    // Mail only for the row this request actually moved to shipped, only to the address
    // stored on the order, and only within the mail caps.
    if (justShipped) {
      const sent = await sendGuardedShippingMail({
        projectId,
        orderId,
        customerEmail: order.customer_email as string | null,
        order: order as ShippableOrder,
        orderNumber: order.order_number as string,
        customerName: order.customer_name as string | null,
        trackingCode: shipment.trackingNumber as string,
        trackingUrl,
        carrier: String(shipment.trackingCarrier || 'byrd fulfillment').slice(0, 60),
      })
      if (sent) {
        // Best-effort — table may not exist pre-migration. customer_notified_at existing only
        // on fulfillment_shipments (not store_orders) is intentional: it's audit/dedup data
        // for the reconciliation cron (spec section 7: "only after a successful send"), not
        // something the order-list UI needs to render.
        await supabaseAdmin.from('fulfillment_shipments').update({
          customer_notified_at: new Date().toISOString(),
        }).eq('order_id', orderId).then(() => {}, () => {})
      }
    }

    return NextResponse.json({
      ok: true,
      byrdId: shipment.externalId,
      status: shipment.status,
      subStatus: shipment.subStatus ?? null,
      trackingCarrier: shipment.trackingCarrier ?? null,
      trackingNumber: shipment.trackingNumber ?? null,
      trackingUrl,
      orderShipped: justShipped || order.status === 'shipped',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'byrd API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
