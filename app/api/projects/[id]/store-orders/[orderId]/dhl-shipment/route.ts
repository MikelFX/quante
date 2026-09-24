// POST /api/projects/[id]/store-orders/[orderId]/dhl-shipment
// Creates a DHL Express shipment for the order, returns tracking + label PDF (base64).
// Authenticated via Clerk (merchant Studio session).
//
// SECURITY (final audit F3): same transition + mail guards as the store-key order API —
// see ../../_lib/ship-guard.ts. A test-mode (DHL sandbox) shipment never mails the customer.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createDhlShipment } from '@/lib/dhl'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { shipRefusal, claimShipped, releaseShipped, sendGuardedShippingMail, safeTrackingUrl, type ShippableOrder } from '../../_lib/ship-guard'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, orderId } = await params

  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

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
  // No shipping_method check — the merchant picks the carrier in the unified dropdown.
  if (order.status === 'shipped') {
    return NextResponse.json({ error: 'Order already shipped', trackingNumber: order.tracking_code }, { status: 409 })
  }
  const from = order as ShippableOrder
  const refusal = shipRefusal(from)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })

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

  // Shipper address: the merchant record of the store (manifest or code-gen business info).
  const merchant = (await loadStoreEmailContext(projectId))?.merchant ?? null

  if (!merchant) {
    return NextResponse.json({ error: 'Merchant info not configured. Fill in your company details in the store manifest.' }, { status: 422 })
  }

  const body = await request.json().catch(() => ({})) as {
    weight?: unknown
    length?: unknown; width?: unknown; height?: unknown
    description?: unknown
    testMode?: unknown
  }
  const testMode = body.testMode === true
  // Parcel data goes to DHL — accept only sane positive numbers and short plain text.
  const pos = (v: unknown, max: number) => {
    const n = Number(v)
    return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n > 0 && n <= max ? n : undefined
  }
  const description = typeof body.description === 'string'
    ? body.description.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 70) || undefined
    : undefined

  // Claim before creating the shipment — see ../../_lib/ship-guard.ts.
  if (!(await claimShipped(projectId, orderId, from))) {
    return NextResponse.json({ error: 'Order was changed by another request. Reload and try again.' }, { status: 409 })
  }
  const prevTrackingCode = (order.tracking_code as string | null) ?? null

  let result: Awaited<ReturnType<typeof createDhlShipment>>
  try {
    // dhl_api_key/secret are AES-256-GCM encrypted at rest (see settings/route.ts);
    // decryptSecret() also transparently passes through legacy plaintext rows.
    result = await createDhlShipment({
      apiKey: decryptSecret(secrets.dhl_api_key as string) as string,
      apiSecret: decryptSecret(secrets.dhl_api_secret as string) as string,
      accountNumber: secrets.dhl_account_number as string,
      testMode,

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
      description: description || 'E-commerce goods',
      weight: pos(body.weight, 300) ?? 1,
      length: pos(body.length, 300),
      width: pos(body.width, 300),
      height: pos(body.height, 300),

      currency: (order.currency as string).toUpperCase(),
      declaredValue: order.total_cents / 100,
    })
  } catch (err) {
    await releaseShipped(projectId, orderId, from.status, prevTrackingCode)
    const msg = err instanceof Error ? err.message : 'DHL API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const trackingUrl = safeTrackingUrl(result.trackingUrl) ?? null
  const { error: trackErr } = await supabaseAdmin
    .from('store_orders')
    .update({
      tracking_code: result.trackingNumber,
      tracking_url: trackingUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('project_id', projectId)
  if (trackErr) console.error('[store-orders/dhl] shipment created but tracking not saved', { orderId, trackingNumber: result.trackingNumber, error: trackErr.message })

  // A sandbox shipment is not a real one — never tell the customer it shipped.
  if (!testMode) {
    await sendGuardedShippingMail({
      projectId,
      orderId,
      customerEmail: order.customer_email as string | null,
      order: from,
      orderNumber: order.order_number,
      customerName: order.customer_name as string | null,
      trackingCode: result.trackingNumber,
      trackingUrl,
      carrier: 'DHL Express',
    })
  }

  return NextResponse.json({
    ok: true,
    trackingNumber: result.trackingNumber,
    trackingUrl: result.trackingUrl,
    labelBase64: result.labelBase64,
  })
}
