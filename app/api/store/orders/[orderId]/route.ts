// PATCH /api/store/orders/[orderId] — update order status (auth: QUANTE_API_KEY)
// Used by the exported store's admin panel to mark orders as shipped, cancelled, etc.
// Sending status=shipped with trackingCode/trackingUrl triggers the shipping email.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { shippingEmail, refundEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

const VALID_STATUSES = ['pending', 'paid', 'shipped', 'cancelled', 'refunded'] as const
type OrderStatus = typeof VALID_STATUSES[number]

interface Context {
  params: Promise<{ orderId: string }>
}

export async function PATCH(request: Request, { params }: Context) {
  const { orderId } = await params

  const authHeader = request.headers.get('authorization') ?? ''
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('project_id')
    .eq('quante_api_key', apiKey)
    .maybeSingle()

  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    status?: OrderStatus
    trackingCode?: string
    trackingUrl?: string
    carrier?: string
  }

  const { status, trackingCode, trackingUrl, carrier } = body

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status) updates.status = status
  if (trackingCode) updates.tracking_code = trackingCode
  if (trackingUrl) updates.tracking_url = trackingUrl

  const { data: order, error } = await supabaseAdmin
    .from('store_orders')
    .update(updates)
    .eq('id', orderId)
    .eq('project_id', secret.project_id)
    .select('id, order_number, customer_name, customer_email, total_cents, currency, tracking_code, tracking_url')
    .maybeSingle()

  if (error || !order) return NextResponse.json({ error: 'Order not found or update failed' }, { status: 404 })

  // Send shipping email
  if (status === 'shipped' && order.customer_email) {
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
        trackingCode: order.tracking_code ?? trackingCode,
        trackingUrl: order.tracking_url ?? trackingUrl,
        carrier,
      })
      await sendEmail(order.customer_email, subject, html)
    }
  }

  // Send refund email
  if (status === 'refunded' && order.customer_email) {
    const { data: versionRow } = await supabaseAdmin
      .from('manifest_versions')
      .select('manifest')
      .eq('project_id', secret.project_id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    const manifest = versionRow?.manifest as ShopManifest | undefined
    if (manifest) {
      const { subject, html } = refundEmail({
        orderNumber: order.order_number,
        customerName: order.customer_name ?? 'zákazníku',
        total: order.total_cents / 100,
        currency: order.currency.toUpperCase(),
        storeName: manifest.brand.name,
        accentColor: manifest.design.palette.accent,
        merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quante.io',
        merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
      })
      await sendEmail(order.customer_email, subject, html)
    }
  }

  return NextResponse.json({ ok: true, orderId, status })
}
