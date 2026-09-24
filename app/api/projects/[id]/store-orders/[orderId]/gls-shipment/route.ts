// POST /api/projects/[id]/store-orders/[orderId]/gls-shipment
// Creates a GLS parcel for the order, returns parcel number + label PDF (base64).
// Authenticated via Clerk (merchant Studio session).
// No shipping_method check — the merchant picks the carrier in the unified dropdown.
//
// SECURITY (final audit F3): same transition + mail guards as the store-key order API —
// see ../../_lib/ship-guard.ts. A test-mode (GLS sandbox) parcel never mails the customer.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createGlsParcel } from '@/lib/gls'
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

  const body = await request.json().catch(() => ({})) as {
    content?: unknown
    testMode?: unknown
  }
  const testMode = body.testMode === true
  const content = typeof body.content === 'string' ? body.content.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || undefined : undefined

  // Claim before creating the parcel — see ../../_lib/ship-guard.ts.
  if (!(await claimShipped(projectId, orderId, from))) {
    return NextResponse.json({ error: 'Order was changed by another request. Reload and try again.' }, { status: 409 })
  }
  const prevTrackingCode = (order.tracking_code as string | null) ?? null

  let result: Awaited<ReturnType<typeof createGlsParcel>>
  try {
    // gls_password is AES-256-GCM encrypted at rest (see settings/route.ts);
    // decryptSecret() also transparently passes through legacy plaintext rows.
    result = await createGlsParcel({
      username: secrets.gls_username as string,
      password: decryptSecret(secrets.gls_password as string) as string,
      clientNumber: secrets.gls_client_number as string,
      accountCountry: (secrets.gls_country as string | null) ?? 'cz',
      testMode,

      recipientName: order.customer_name ?? 'Zákazník',
      recipientStreet,
      recipientCity,
      recipientZip,
      recipientCountryCode: recipientCountry,
      recipientPhone: order.customer_phone ?? undefined,
      recipientEmail: order.customer_email ?? undefined,

      orderNumber: order.order_number,
      content,
      cod: order.payment_method === 'dobirka' ? order.total_cents / 100 : 0,
    })
  } catch (err) {
    await releaseShipped(projectId, orderId, from.status, prevTrackingCode)
    const msg = err instanceof Error ? err.message : 'GLS API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const trackingUrl = safeTrackingUrl(result.trackingUrl) ?? null
  const { error: trackErr } = await supabaseAdmin
    .from('store_orders')
    .update({
      tracking_code: result.parcelNumber,
      tracking_url: trackingUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('project_id', projectId)
  if (trackErr) console.error('[store-orders/gls] parcel created but tracking not saved', { orderId, parcelNumber: result.parcelNumber, error: trackErr.message })

  // A sandbox parcel is not a real shipment — never tell the customer it shipped.
  if (!testMode) {
    await sendGuardedShippingMail({
      projectId,
      orderId,
      customerEmail: order.customer_email as string | null,
      order: from,
      orderNumber: order.order_number,
      customerName: order.customer_name as string | null,
      trackingCode: result.parcelNumber,
      trackingUrl,
      carrier: 'GLS',
    })
  }

  return NextResponse.json({
    ok: true,
    parcelNumber: result.parcelNumber,
    trackingUrl: result.trackingUrl,
    labelBase64: result.labelBase64,
  })
}
