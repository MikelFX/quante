// POST /api/projects/[id]/store-orders/[orderId]/dhl-shipment
// Creates a DHL Express shipment for the order, returns tracking + label PDF (base64).
// Authenticated via Clerk (merchant Studio session).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createDhlShipment } from '@/lib/dhl'
import { shippingEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('dhl_api_key, dhl_api_secret, dhl_account_number')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!secrets?.dhl_api_key || !secrets?.dhl_api_secret || !secrets?.dhl_account_number) {
    return NextResponse.json({ error: 'DHL API credentials not configured. Add them in Admin → Settings.' }, { status: 422 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.shipping_method !== 'dhl') {
    return NextResponse.json({ error: 'Order shipping method is not DHL' }, { status: 422 })
  }
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', trackingNumber: order.tracking_code }, { status: 409 })
  }

  const shippingAddr = order.shipping_address as {
    ulice?: string; street?: string
    mesto?: string; city?: string
    psc?: string; zip?: string
    zeme?: string
  } | null

  const recipientStreet = shippingAddr?.ulice || shippingAddr?.street || ''
  const recipientCity   = shippingAddr?.mesto || shippingAddr?.city   || ''
  const recipientZip    = shippingAddr?.psc   || shippingAddr?.zip    || ''
  const recipientCountry = (
    (order.shipping_country as string | null) ||
    shippingAddr?.zeme ||
    'CZ'
  ).toUpperCase()

  if (!recipientStreet || !recipientCity || !recipientZip) {
    return NextResponse.json({ error: 'Order is missing a shipping address. Customer must provide street, city and ZIP.' }, { status: 422 })
  }

  // Get manifest for shipper address + branding
  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  const merchant = manifest?.merchant

  if (!merchant) {
    return NextResponse.json({ error: 'Merchant info not configured. Fill in your company details in the store manifest.' }, { status: 422 })
  }

  const body = await request.json().catch(() => ({})) as {
    weight?: number
    length?: number; width?: number; height?: number
    description?: string
    testMode?: boolean
  }

  try {
    const result = await createDhlShipment({
      apiKey: secrets.dhl_api_key as string,
      apiSecret: secrets.dhl_api_secret as string,
      accountNumber: secrets.dhl_account_number as string,
      testMode: body.testMode ?? false,

      shipperName: merchant.zodpovedna_osoba || merchant.obchodni_nazev,
      shipperCompany: merchant.obchodni_nazev,
      shipperEmail: merchant.kontakt.email,
      shipperPhone: merchant.kontakt.telefon,
      shipperStreet: merchant.sidlo.ulice,
      shipperCity: merchant.sidlo.mesto,
      shipperPostalCode: merchant.sidlo.psc,
      shipperCountryCode: merchant.sidlo.zeme || 'CZ',

      recipientName: order.customer_name ?? 'Zákazník',
      recipientEmail: order.customer_email ?? '',
      recipientPhone: order.customer_phone ?? undefined,
      recipientStreet,
      recipientCity,
      recipientPostalCode: recipientZip,
      recipientCountryCode: recipientCountry,

      orderNumber: order.order_number,
      description: body.description || 'E-commerce goods',
      weight: body.weight ?? 1,
      length: body.length,
      width: body.width,
      height: body.height,

      currency: (order.currency as string).toUpperCase(),
      declaredValue: order.total_cents / 100,
    })

    await supabaseAdmin
      .from('store_orders')
      .update({
        status: 'shipped',
        tracking_code: result.trackingNumber,
        tracking_url: result.trackingUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    // Send tracking email to customer
    if (order.customer_email && manifest) {
      const { subject, html } = shippingEmail({
        orderNumber: order.order_number,
        customerName: order.customer_name ?? 'zákazníku',
        storeName: manifest.brand.name,
        accentColor: manifest.design.palette.accent,
        merchantEmail: merchant.kontakt.email,
        merchantName: merchant.obchodni_nazev,
        trackingCode: result.trackingNumber,
        trackingUrl: result.trackingUrl,
        carrier: 'DHL Express',
      })
      await sendEmail(order.customer_email, subject, html)
    }

    return NextResponse.json({
      ok: true,
      trackingNumber: result.trackingNumber,
      trackingUrl: result.trackingUrl,
      labelBase64: result.labelBase64,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'DHL API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
