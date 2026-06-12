// GoPay payment notification webhook.
// Called by GoPay when a payment state changes.
// Docs: https://doc.gopay.com/#payment-notification

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createGopayProvider } from '@/lib/payments/gopay'
import { paymentConfirmedEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams
  const paymentId = params.get('id')

  if (!paymentId) return new Response('Missing id', { status: 400 })

  const provider = createGopayProvider()
  if (!provider) return new Response('GoPay not configured', { status: 503 })

  const status = await provider.getStatus(paymentId)

  const newPaymentStatus =
    status.status === 'paid' ? 'paid'
    : status.status === 'cancelled' || status.status === 'expired' ? 'cancelled'
    : status.status === 'refunded' ? 'refunded'
    : null

  if (!newPaymentStatus) return new Response('OK', { status: 200 })

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .update({
      payment_status: newPaymentStatus,
      ...(newPaymentStatus === 'paid' ? { status: 'paid' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('payment_ref', paymentId)
    .select('id, project_id, order_number, customer_name, customer_email, total_cents, currency')
    .maybeSingle()

  if (order && newPaymentStatus === 'paid') {
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
