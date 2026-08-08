// POST /api/projects/[id]/store-orders/[orderId]/gls-shipment
// Creates a GLS parcel for the order, returns parcel number + label PDF (base64).
// Authenticated via Clerk (merchant Studio session).
// No shipping_method check — the merchant picks the carrier in the unified dropdown.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createGlsParcel } from '@/lib/gls'
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
    .select('gls_username, gls_password, gls_client_number, gls_country')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!secrets?.gls_username || !secrets?.gls_password || !secrets?.gls_client_number) {
    return NextResponse.json({ error: 'GLS API credentials not configured. Add them in Admin → Settings.' }, { status: 422 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', parcelNumber: order.tracking_code }, { status: 409 })
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

  const body = await request.json().catch(() => ({})) as {
    content?: string
    testMode?: boolean
  }

  try {
    // gls_password is AES-256-GCM encrypted at rest (see settings/route.ts);
    // decryptSecret() also transparently passes through legacy plaintext rows.
    const result = await createGlsParcel({
      username: secrets.gls_username as string,
      password: decryptSecret(secrets.gls_password as string) as string,
      clientNumber: secrets.gls_client_number as string,
      accountCountry: (secrets.gls_country as string | null) ?? 'cz',
      testMode: body.testMode ?? false,

      recipientName: order.customer_name ?? 'Zákazník',
      recipientStreet,
      recipientCity,
      recipientZip,
      recipientCountryCode: recipientCountry,
      recipientPhone: order.customer_phone ?? undefined,
      recipientEmail: order.customer_email ?? undefined,

      orderNumber: order.order_number,
      content: body.content,
      cod: order.payment_method === 'dobirka' ? order.total_cents / 100 : 0,
    })

    await supabaseAdmin
      .from('store_orders')
      .update({
        status: 'shipped',
        tracking_code: result.parcelNumber,
        tracking_url: result.trackingUrl,
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
          merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quantecode.com',
          merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
          trackingCode: result.parcelNumber,
          trackingUrl: result.trackingUrl,
          carrier: 'GLS',
        })
        await sendEmail(order.customer_email, subject, html)
      }
    }

    return NextResponse.json({
      ok: true,
      parcelNumber: result.parcelNumber,
      trackingUrl: result.trackingUrl,
      labelBase64: result.labelBase64,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GLS API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
