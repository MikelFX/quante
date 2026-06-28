// Called by deployed stores — routes checkout to the correct payment provider.
// Supported methods: stripe (card), comgate (CZ gateways), gopay, paypal, dobirka (COD), prevod (bank transfer).

import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createComgateProvider } from '@/lib/payments/comgate'
import { createGopayProvider } from '@/lib/payments/gopay'
import { createPayPalProvider } from '@/lib/payments/paypal'
import { orderConfirmationEmail, merchantNewOrderEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '5')
const QUANTE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'

interface CartItem {
  id: string
  name: string
  price: number
  currency: string
  quantity: number
}

interface CheckoutBody {
  projectId: string
  items: CartItem[]
  paymentMethod?: 'stripe' | 'comgate' | 'gopay' | 'paypal' | 'dobirka' | 'prevod'
  returnBasePath?: string           // e.g. "/preview/{id}" — used to build success/cancel URLs
  shippingMethod?: string
  shippingCents?: number
  dobirkaCents?: number
  zasilkovnaBranchId?: string
  zasilkovnaBranchName?: string
  zasilkovnaBranchCountry?: string  // ISO 3166-1 alpha-2 lower-case, e.g. "de", "sk"
  shippingCountry?: string          // ISO 3166-1 alpha-2, for DHL and other international couriers
  customerEmail?: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: { ulice: string; mesto: string; psc: string }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || QUANTE_URL

  let body: CheckoutBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { projectId, items, paymentMethod = 'stripe' } = body
  // Build base URL for redirect — use returnBasePath if caller supplies it (storefront pages)
  const storeBase = body.returnBasePath ? `${origin}${body.returnBasePath}` : origin
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!items?.length) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Fetch manifest for branding + merchant data
  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = versionRow?.manifest as ShopManifest | undefined

  const itemsTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const shippingCost = (body.shippingCents ?? 0) / 100
  const dobirkaFee = (body.dobirkaCents ?? 0) / 100
  const totalAmount = itemsTotal + shippingCost + dobirkaFee
  const currency = items[0]?.currency ?? 'CZK'

  // Create order record
  const orderNumber = await generateOrderNumber(projectId)
  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .insert({
      project_id: projectId,
      order_number: orderNumber,
      payment_method: paymentMethod,
      payment_status: 'pending',
      status: 'pending',
      shipping_method: body.shippingMethod,
      zasilkovna_branch_id: body.zasilkovnaBranchId,
      zasilkovna_branch_name: body.zasilkovnaBranchName,
      zasilkovna_branch_country: body.zasilkovnaBranchCountry ?? null,
      shipping_country: body.shippingCountry ?? null,
      customer_email: body.customerEmail,
      customer_name: body.customerName,
      customer_phone: body.customerPhone,
      shipping_address: body.shippingAddress,
      items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
      subtotal_cents: Math.round(itemsTotal * 100),
      shipping_cents: body.shippingCents ?? 0,
      dobirka_cents: body.dobirkaCents ?? 0,
      total_cents: Math.round(totalAmount * 100),
      currency: currency.toLowerCase(),
    })
    .select('id')
    .single()

  if (!order) return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  const orderId = order.id

  // ── Route by payment method ────────────────────────────────────────────────

  if (paymentMethod === 'stripe') {
    const totalCents = Math.round(totalAmount * 100)
    const platformFeeCents = Math.round(totalCents * PLATFORM_FEE_PERCENT / 100)
    try {
      const lineItems = [
        ...items.map((item) => ({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: item.name },
            unit_amount: Math.round(item.price * 100),
          },
          quantity: item.quantity,
        })),
        ...(shippingCost > 0 ? [{
          price_data: { currency: currency.toLowerCase(), product_data: { name: 'Shipping' }, unit_amount: Math.round(shippingCost * 100) },
          quantity: 1,
        }] : []),
        ...(dobirkaFee > 0 ? [{
          price_data: { currency: currency.toLowerCase(), product_data: { name: 'Dobírka' }, unit_amount: Math.round(dobirkaFee * 100) },
          quantity: 1,
        }] : []),
      ]
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${storeBase}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${storeBase}/checkout`,
        customer_email: body.customerEmail,
        metadata: { type: 'store_sale', project_id: projectId, order_id: orderId, platform_fee_cents: String(platformFeeCents) },
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: session.id }).eq('id', orderId)
      return NextResponse.json({ url: session.url })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: 500 })
    }
  }

  if (paymentMethod === 'comgate') {
    const provider = createComgateProvider()
    if (!provider) return NextResponse.json({ error: 'Comgate is not configured' }, { status: 503 })
    try {
      const result = await provider.createPayment({
        orderId,
        amount: Math.round(totalAmount * 100),
        currency,
        label: `Order ${orderNumber}`,
        customerEmail: body.customerEmail ?? '',
        returnUrl: `${storeBase}/success?order=${orderNumber}`,
        cancelUrl: `${storeBase}/checkout`,
        notifyUrl: `${QUANTE_URL}/api/payments/comgate/notify`,
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: result.transactionId }).eq('id', orderId)
      return NextResponse.json({ url: result.redirectUrl })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Comgate error' }, { status: 500 })
    }
  }

  if (paymentMethod === 'dobirka') {
    // No online payment — order is placed, paid on delivery
    await supabaseAdmin.from('store_orders').update({ payment_status: 'pending', status: 'pending' }).eq('id', orderId)
    await sendOrderConfirmationEmail(body, orderNumber, totalAmount, itemsTotal, shippingCost, dobirkaFee, currency, manifest)
    return NextResponse.json({ url: `${storeBase}/success?order=${orderNumber}&method=dobirka` })
  }

  if (paymentMethod === 'prevod') {
    const bankovniUcet = manifest?.merchant?.bankovni_ucet ?? ''
    await supabaseAdmin.from('store_orders').update({ payment_status: 'pending', status: 'pending' }).eq('id', orderId)
    await sendOrderConfirmationEmail(body, orderNumber, totalAmount, itemsTotal, shippingCost, dobirkaFee, currency, manifest, bankovniUcet)
    const qrData = encodeURIComponent(`SPD*1.0*ACC:${bankovniUcet}*AM:${totalAmount.toFixed(2)}*CC:${currency}*MSG:Platba ${orderNumber}*X-VS:${orderNumber.replace(/\D/g, '')}`)
    return NextResponse.json({
      url: `${storeBase}/success?order=${orderNumber}&method=prevod&qr=${qrData}&amount=${totalAmount}&acc=${encodeURIComponent(bankovniUcet)}`,
    })
  }

  if (paymentMethod === 'gopay') {
    const provider = createGopayProvider()
    if (!provider) return NextResponse.json({ error: 'GoPay is not configured' }, { status: 503 })
    try {
      const result = await provider.createPayment({
        orderId,
        amount: Math.round(totalAmount * 100),
        currency,
        label: `Order ${orderNumber}`,
        customerEmail: body.customerEmail ?? '',
        returnUrl: `${storeBase}/success?order=${orderNumber}`,
        cancelUrl: `${storeBase}/checkout`,
        notifyUrl: `${QUANTE_URL}/api/payments/gopay/notify`,
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: result.transactionId }).eq('id', orderId)
      return NextResponse.json({ url: result.redirectUrl })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'GoPay error' }, { status: 500 })
    }
  }

  if (paymentMethod === 'paypal') {
    const provider = createPayPalProvider()
    if (!provider) return NextResponse.json({ error: 'PayPal is not configured' }, { status: 503 })
    try {
      const result = await provider.createPayment({
        orderId,
        amount: Math.round(totalAmount * 100),
        currency,
        label: `Order ${orderNumber}`,
        customerEmail: body.customerEmail ?? '',
        returnUrl: `${storeBase}/success?order=${orderNumber}`,
        cancelUrl: `${storeBase}/checkout`,
        notifyUrl: `${QUANTE_URL}/api/payments/paypal/notify`,
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: result.transactionId }).eq('id', orderId)
      await sendOrderConfirmationEmail(body, orderNumber, totalAmount, itemsTotal, shippingCost, dobirkaFee, currency, manifest)
      return NextResponse.json({ url: result.redirectUrl })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'PayPal error' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown payment method' }, { status: 400 })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateOrderNumber(projectId: string): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await supabaseAdmin
    .from('store_orders')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('created_at', `${year}-01-01`)
  const seq = ((count ?? 0) + 1).toString().padStart(4, '0')
  return `${year}-${seq}`
}

async function sendOrderConfirmationEmail(
  body: CheckoutBody,
  orderNumber: string,
  total: number,
  subtotal: number,
  shippingCost: number,
  dobirkaFee: number,
  currency: string,
  manifest?: ShopManifest,
  bankovniUcet?: string,
) {
  if (!body.customerEmail || !manifest) return
  const { subject, html } = orderConfirmationEmail({
    orderNumber,
    customerName: body.customerName ?? 'zákazníku',
    customerEmail: body.customerEmail,
    items: (body.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency })),
    subtotal,
    shippingCost,
    dobirkaFee,
    total,
    currency,
    paymentMethod: body.paymentMethod ?? 'stripe',
    shippingMethod: body.shippingMethod,
    zasilkovnaBranchName: body.zasilkovnaBranchName,
    shippingAddress: body.shippingAddress,
    storeName: manifest.brand.name,
    accentColor: manifest.design.palette.accent,
    merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quante.io',
    merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
    bankovniUcet,
  })
  const from = await getProjectFromEmail(body.projectId)
  await Promise.all([
    sendEmail(body.customerEmail, subject, html, from),
    sendMerchantOrderEmail(body, orderNumber, total, currency, manifest, from),
  ])
}

async function sendMerchantOrderEmail(
  body: CheckoutBody,
  orderNumber: string,
  total: number,
  currency: string,
  manifest?: ShopManifest,
  from?: string,
) {
  if (!manifest) return
  const merchantEmail = manifest.merchant?.kontakt.email
  if (!merchantEmail) return
  const { subject, html } = merchantNewOrderEmail({
    orderNumber,
    customerName: body.customerName ?? '—',
    customerEmail: body.customerEmail ?? '—',
    customerPhone: body.customerPhone,
    items: (body.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency })),
    total,
    currency,
    paymentMethod: body.paymentMethod ?? 'stripe',
    shippingMethod: body.shippingMethod,
    shippingAddress: body.shippingAddress,
    storeName: manifest.brand.name,
    accentColor: manifest.design.palette.accent,
  })
  await sendEmail(merchantEmail, subject, html, from ?? 'objednavky@quante.io')
}
