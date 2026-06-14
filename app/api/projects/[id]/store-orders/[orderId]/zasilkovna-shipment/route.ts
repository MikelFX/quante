// POST /api/projects/[id]/store-orders/[orderId]/zasilkovna-shipment
// Creates a Packeta parcel for a store_order and marks it as shipped.
// Authenticated via Clerk (merchant's own Studio session).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createPacketaParcel } from '@/lib/zasilkovna'
import { shippingEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params

  // Ownership check
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

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
  if (order.shipping_method !== 'zasilkovna' && order.shipping_method !== 'packeta_international') {
    return NextResponse.json({ error: 'Order shipping method is not Packeta/Zásilkovna' }, { status: 422 })
  }
  if (!order.zasilkovna_branch_id) {
    return NextResponse.json({ error: 'No Zásilkovna branch selected on this order' }, { status: 422 })
  }
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', barcode: order.tracking_code }, { status: 409 })
  }

  const body = await request.json().catch(() => ({})) as {
    weight?: number
    size?: { width: number; height: number; depth: number }
  }

  try {
    const parcel = await createPacketaParcel({
      apiKey: secrets.zasilkovna_api_key as string,
      apiPassword: secrets.zasilkovna_api_password as string,
      orderId,
      orderNumber: order.order_number,
      customerName: order.customer_name ?? 'Zákazník',
      customerEmail: order.customer_email ?? '',
      customerPhone: order.customer_phone ?? undefined,
      branchId: order.zasilkovna_branch_id,
      branchCountry: (order.zasilkovna_branch_country as string | null) ?? 'cz',
      currency: (order.currency as string).toUpperCase(),
      value: order.total_cents / 100,
      weight: body.weight ?? (order.parcel_weight_kg as number | null) ?? 1,
      size: body.size ?? (order.parcel_size as { width: number; height: number; depth: number } | null) ?? undefined,
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

    if (order.customer_email) {
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
