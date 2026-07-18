// Shared "payment succeeded" email pair: payment confirmation to the customer
// + new-order notification to the merchant. Used by Comgate/GoPay/PayPal
// webhook handlers so every provider has the same complete email chain.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { paymentConfirmedEmail, merchantNewOrderEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export interface PaidOrderRow {
  id: string
  project_id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  customer_phone?: string | null
  total_cents: number
  currency: string
  payment_method?: string | null
  shipping_method?: string | null
  shipping_address?: { ulice: string; mesto: string; psc: string; zeme?: string } | null
  items?: Array<{ id: string; name: string; price: number; quantity: number }> | null
}

export async function sendPaymentSuccessEmails(order: PaidOrderRow): Promise<void> {
  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', order.project_id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest) return

  const QUANTE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'
  const from = await getProjectFromEmail(order.project_id)
  const currency = order.currency.toUpperCase()
  const total = order.total_cents / 100
  const sends: Promise<boolean>[] = []

  if (order.customer_email) {
    const { subject, html } = paymentConfirmedEmail({
      orderNumber: order.order_number,
      customerName: order.customer_name ?? 'zákazníku',
      total,
      currency,
      storeName: manifest.brand.name,
      accentColor: manifest.design.palette.accent,
      merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quantecode.com',
      merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
      invoiceUrl: `${QUANTE_URL}/invoice/${order.id}`,
    })
    sends.push(sendEmail(order.customer_email, subject, html, from))
  }

  const merchantEmail = manifest.merchant?.kontakt.email
  if (merchantEmail) {
    const { subject, html } = merchantNewOrderEmail({
      orderNumber: order.order_number,
      customerName: order.customer_name ?? '—',
      customerEmail: order.customer_email ?? '—',
      customerPhone: order.customer_phone ?? undefined,
      items: (order.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency })),
      total,
      currency,
      paymentMethod: order.payment_method ?? '—',
      shippingMethod: order.shipping_method ?? undefined,
      shippingAddress: order.shipping_address ?? undefined,
      storeName: manifest.brand.name,
      accentColor: manifest.design.palette.accent,
    })
    sends.push(sendEmail(merchantEmail, subject, html, from))
  }

  await Promise.all(sends)
}
