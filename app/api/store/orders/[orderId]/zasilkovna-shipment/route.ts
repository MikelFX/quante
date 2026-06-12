// POST /api/store/orders/[orderId]/zasilkovna-shipment
// Creates a Packeta parcel for the order and marks it as shipped.
// Requires: order has shipping_method=zasilkovna and zasilkovna_branch_id set.
// Auth: Bearer QUANTE_API_KEY

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createPacketaParcel } from '@/lib/zasilkovna'
import { shippingEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

interface Context {
  params: Promise<{ orderId: string }>
}

export async function POST(request: Request, { params }: Context) {
  const { orderId } = await params

  const authHeader = request.headers.get('authorization') ?? ''
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('project_id, zasilkovna_api_key, zasilkovna_api_password')
    .eq('quante_api_key', apiKey)
    .maybeSingle()

  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
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
  if (order.shipping_method !== 'zasilkovna') {
    return NextResponse.json({ error: 'Order shipping method is not zasilkovna' }, { status: 422 })
  }
  if (!order.zasilkovna_branch_id) {
    return NextResponse.json({ error: 'No Zásilkovna branch selected on this order' }, { status: 422 })
  }
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', barcode: order.tracking_code }, { status: 409 })
  }

  const body = await request.json().catch(() => ({})) as { weight?: number }

  try {
    const parcel = await createPacketaParcel({
      apiKey: secret.zasilkovna_api_key,
      apiPassword: secret.zasilkovna_api_password,
      orderId,
      orderNumber: order.order_number,
      customerName: order.customer_name ?? 'Zákazník',
      customerEmail: order.customer_email ?? '',
      customerPhone: order.customer_phone ?? undefined,
      branchId: order.zasilkovna_branch_id,
      value: order.total_cents / 100,
      weight: body.weight ?? 1,
      cod: order.payment_method === 'dobirka' ? order.total_cents / 100 : 0,
    })

    await supabaseAdmin
      .from('store_orders')
      .update({
        status: 'shipped',
        tracking_code: parcel.barcode,
        tracking_url: parcel.trackingUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    // Send shipping notification email
    if (order.customer_email) {
      const { data: versionRow } = await supabaseAdmin
        .from('manifest_versions')
        .select('manifest')
        .eq('project_id', secret.project_id)
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
          merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quante.io',
          merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
          trackingCode: parcel.barcode,
          trackingUrl: parcel.trackingUrl,
          carrier: 'Zásilkovna',
        })
        await sendEmail(order.customer_email, subject, html)
      }
    }

    return NextResponse.json({ ok: true, barcode: parcel.barcode, trackingUrl: parcel.trackingUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Packeta API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
