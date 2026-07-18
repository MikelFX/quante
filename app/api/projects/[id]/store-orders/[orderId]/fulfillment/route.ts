// /api/projects/[id]/store-orders/[orderId]/fulfillment
// POST — sends the order to the byrd fulfillment warehouse (creates a byrd shipment).
// GET  — polls byrd for the shipment status; once tracking exists, marks the order
//        as shipped and sends the tracking e-mail to the customer.
// Authenticated via Clerk (merchant Studio session).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createByrdProvider, splitStreet } from '@/lib/fulfillment/byrd'
import { shippingEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

async function loadContext(userId: string, projectId: string, orderId: string) {
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }

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

  const provider = createByrdProvider({
    apiKey: secrets.byrd_api_key as string,
    apiSecret: secrets.byrd_api_secret as string,
  })

  return { order, provider }
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
    return NextResponse.json({ error: 'Order is missing a shipping address. Customer must provide street, city and ZIP.' }, { status: 422 })
  }

  const orderItems = (order.items as Array<{ id?: string; sku?: string; name?: string; price?: number; quantity?: number }> | null) ?? []
  if (orderItems.length === 0) {
    return NextResponse.json({ error: 'Order has no items to fulfill.' }, { status: 422 })
  }

  const body = await request.json().catch(() => ({})) as {
    service?: 'standard' | 'express' | 'economy'
    testMode?: boolean
  }

  const street = splitStreet(rawStreet)
  const currency = (order.currency as string).toUpperCase()

  try {
    const shipment = await provider.createShipment({
      orderNumber: order.order_number,
      orderId,
      address: {
        name: order.customer_name ?? 'Zákazník',
        email: order.customer_email ?? undefined,
        phone: order.customer_phone ?? undefined,
        streetName: street.name,
        streetNumber: street.number,
        city,
        postalCode: zip,
        countryCode,
      },
      // byrd matches items by SKU registered at the warehouse — product id is the fallback
      items: orderItems.map((i) => ({
        sku: i.sku || i.id || '',
        name: i.name ?? 'Item',
        quantity: i.quantity ?? 1,
        priceValue: i.price ?? 0,
        currency,
      })),
      service: body.service ?? 'standard',
      cod: order.payment_method === 'dobirka' ? { value: order.total_cents / 100, currency } : undefined,
      testMode: body.testMode ?? false,
    })

    await supabaseAdmin
      .from('store_orders')
      .update({
        fulfillment_provider: 'byrd',
        fulfillment_ref: shipment.id,
        fulfillment_status: shipment.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    return NextResponse.json({
      ok: true,
      byrdId: shipment.id,
      status: shipment.status,
      subStatus: shipment.subStatus ?? null,
      warnings: shipment.warnings ?? [],
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

    const update: Record<string, unknown> = {
      fulfillment_status: shipment.status,
      updated_at: new Date().toISOString(),
    }

    const justShipped = !!shipment.trackingNumber && order.status !== 'shipped'
    if (justShipped) {
      update.status = 'shipped'
      update.tracking_code = shipment.trackingNumber
      if (shipment.trackingUrl) update.tracking_url = shipment.trackingUrl
    }

    await supabaseAdmin.from('store_orders').update(update).eq('id', orderId)

    if (justShipped && order.customer_email) {
      const { data: versionRow } = await supabaseAdmin
        .from('manifest_versions')
        .select('manifest')
        .eq('project_id', projectId)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle()

      const manifest = versionRow?.manifest as ShopManifest | undefined
      if (manifest) {
        const { subject, html } = shippingEmail({
          orderNumber: order.order_number,
          customerName: order.customer_name ?? 'zákazníku',
          storeName: manifest.brand.name,
          accentColor: manifest.design.palette.accent,
          merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quantecode.com',
          merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
          trackingCode: shipment.trackingNumber as string,
          trackingUrl: shipment.trackingUrl ?? '',
          carrier: shipment.trackingCarrier || 'byrd fulfillment',
        })
        await sendEmail(order.customer_email, subject, html)
      }
    }

    return NextResponse.json({
      ok: true,
      byrdId: shipment.id,
      status: shipment.status,
      subStatus: shipment.subStatus ?? null,
      trackingCarrier: shipment.trackingCarrier ?? null,
      trackingNumber: shipment.trackingNumber ?? null,
      trackingUrl: shipment.trackingUrl ?? null,
      orderShipped: justShipped || order.status === 'shipped',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'byrd API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
