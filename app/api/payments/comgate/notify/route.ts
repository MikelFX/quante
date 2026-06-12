// Comgate payment notification webhook.
// Called by Comgate when a payment is completed, cancelled, or refunded.
// Docs: https://help.comgate.cz/docs/notifications

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { paymentConfirmedEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export async function POST(request: Request) {
  const body = await request.text()
  const params = new URLSearchParams(body)

  const transId = params.get('transId')
  const status = params.get('status')       // PAID, CANCELLED, REFUNDED
  const refId = params.get('refId')         // our orderId
  const price = params.get('price')         // in haléře
  const curr = params.get('curr') ?? 'CZK'
  const email = params.get('email')

  if (!transId || !status || !refId) {
    return new Response('Missing params', { status: 400 })
  }

  // Update order status in DB
  const newStatus = status === 'PAID' ? 'paid'
    : status === 'CANCELLED' ? 'cancelled'
    : status === 'REFUNDED' ? 'refunded'
    : 'pending'

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newStatus,
      payment_ref: transId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', refId)
    .select('id, project_id, order_number, customer_name, customer_email, total_cents, currency, items')
    .maybeSingle()

  if (order && status === 'PAID') {
    // Send customer payment confirmation
    const { data: versionRow } = await supabaseAdmin
      .from('manifest_versions')
      .select('manifest')
      .eq('project_id', order.project_id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    const manifest = versionRow?.manifest as ShopManifest | undefined
    if (manifest && order.customer_email) {
      const QUANTE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'
      const { subject, html } = paymentConfirmedEmail({
        orderNumber: order.order_number,
        customerName: order.customer_name ?? 'zákazníku',
        total: order.total_cents / 100,
        currency: order.currency.toUpperCase(),
        storeName: manifest.brand.name,
        accentColor: manifest.design.palette.accent,
        merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quante.io',
        merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
        invoiceUrl: `${QUANTE_URL}/invoice/${order.id}`,
      })
      const from = await getProjectFromEmail(order.project_id)
      await sendEmail(order.customer_email, subject, html, from)
    }
  }

  return new Response('OK', { status: 200 })
}
