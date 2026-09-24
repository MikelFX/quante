// Called by deployed stores — routes checkout to the correct payment provider.
// Supported methods: stripe (card), comgate (CZ gateways), gopay, paypal, dobirka (COD), prevod (bank transfer).
//
// SECURITY (audit #3, #8, #11, #12): this endpoint is public, so the request body is
// treated as a wish list only:
//   - every item price/name, the currency, the shipping cost and the COD fee are
//     recomputed from the merchant's own data (../_lib/pricing.ts) — client prices,
//     names, currency, shippingCents and dobirkaCents are ignored;
//   - quantities must be integers 1..99, at most 50 lines; strings are length-capped;
//   - the project must be live (went through Push to Live and isn't suspended/expired);
//   - success/cancel URLs are built only from the store's own origins (../_lib/store-origin.ts);
//   - requests are rate-limited per shopper IP+project (the shopper IP forwarded by a
//     store proxy is trusted only with the project's store key), and unpaid
//     (dobirka/prevod) orders — which send email immediately — are also capped per
//     recipient (per store and across all stores) and per store; their mails also need
//     a daily per-store slot (the merchant notice also a per-recipient one) and carry
//     only link-free free text (F8);
//   - live catalog only (the production deployment's code version), tracked stock is
//     checked, and the currency must be a supported two-decimal currency;
//   - provider errors are logged, not echoed.
//
// PROJECT IDENTITY (audit #59). The project is taken from the store's
// "Authorization: Bearer <QUANTE_API_KEY>" (project_secrets, hash lookup + constant-
// time compare), which every current store build sends from its server-side
// /api/checkout proxy (lib/store-template/build.ts, lib/platform.ts — the key never
// reaches the browser). A body projectId, if also sent, must equal the key's project.
// An invalid key is rejected outright (it never falls back to the keyless paths).
// Keyless compatibility paths remain, and only because every price, fee, the currency
// and the payment method's availability are recomputed server-side above/below:
//   a) Quante's own /preview/<id> checkout (components/storefront/CheckoutForm.tsx),
//      posted from a platform origin — requires the signed-in project owner;
//   b) stores deployed before their proxy sent the key: the Origin (or Referer) must
//      be one of that project's own store origins (store_slug subdomain, its
//      deployment hosts, verified custom domains). A server-side caller can forge
//      Origin, so this path only guarantees what the priced order already does;
//   c) legacy manifest stores deployed from the previous template, whose proxy sends
//      neither a key nor an Origin: accepted only when the request carries no Origin
//      and no Referer at all (so never from a browser, which always sends Origin on a
//      POST), with redirects built from the project's canonical store origin. Any
//      non-browser caller could forge an Origin for (b) anyway, so (c) adds nothing
//      over (b) — it just keeps those stores taking orders until they are redeployed.
//   A keyless request that has an Origin/Referer matching none of the above is
//   refused. (b) and (c) are logged; STORE_CHECKOUT_REQUIRE_KEY=true switches both off
//   once every hosted store has been redeployed with the key-sending proxy. Before
//   turning it on, note that a keyed store is handled as keyless while its connecting
//   IP is in the store-key failure throttle and its key was never verified on that
//   instance (../_lib/store-auth.ts) — with the switch on that is a 403, so a tenant
//   sharing the egress IP could briefly block such a store's checkout.
//
// NEXT_PUBLIC_APP_URL (audit #48) is required — without it the route refuses to run
// (no hard-coded fallback host for payment notify URLs).

import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getProjectPaymentCreds, comgateForProject, gopayForProject, paypalForProject } from '@/lib/payments/project-providers'
import { orderConfirmationEmail, merchantNewOrderEmail, sendEmail, getProjectFromEmail, isValidEmail, linkFreeText } from '@/lib/email-templates'
import { loadStoreEmailContext, reserveUnpaidMailSlot, reserveMerchantNoticeSlot, type StoreEmailContext } from '@/lib/order-emails'
import { getHostingGate } from '@/lib/hosting/gate'
import { isUuid, getOwnedProject } from '@/lib/auth/project'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { loadStorePricing, findOutOfStock, type ShippingOption } from '../_lib/pricing'
import { getStoreOrigins, originOf } from '../_lib/store-origin'
import { resolveStoreKeyProject, sha256Hex } from '../_lib/store-auth'

const PAYMENT_METHODS = ['stripe', 'comgate', 'gopay', 'paypal', 'dobirka', 'prevod'] as const
type PaymentMethod = typeof PAYMENT_METHODS[number]

const MAX_LINES = 50
const MAX_QTY = 99
// 1,000,000.00 in major units — far above any real basket, blocks absurd sessions.
const MAX_TOTAL_CENTS = 100_000_000

interface RawItem {
  id?: unknown
  productId?: unknown
  variantId?: unknown
  quantity?: unknown
}

interface CheckoutBody {
  projectId?: unknown
  items?: unknown
  paymentMethod?: unknown
  returnBasePath?: unknown
  shippingMethod?: unknown
  zasilkovnaBranchId?: unknown
  zasilkovnaBranchName?: unknown
  zasilkovnaBranchCountry?: unknown
  shippingCountry?: unknown
  customerEmail?: unknown
  customerName?: unknown
  customerPhone?: unknown
  shippingAddress?: unknown
}

interface OrderLine {
  id: string
  variantId?: string
  name: string
  price: number   // unit price, major units (server-side)
  quantity: number
  unitCents: number
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || undefined
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  let body: CheckoutBody
  try {
    body = await request.json()
  } catch {
    return bad('Invalid request body')
  }
  if (!body || typeof body !== 'object') return bad('Invalid request body')

  // Fail closed: payment notify URLs and the platform's own origin come from here.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl || !originOf(appUrl)) {
    console.error('[store/checkout] NEXT_PUBLIC_APP_URL is not set — refusing checkout')
    return bad('Checkout is temporarily unavailable.', 500)
  }
  const quanteUrl = appUrl.replace(/\/$/, '')

  // ── 1. Validate the request shape (nothing is written before this passes) ──
  const bodyProjectId = body.projectId
  if (bodyProjectId !== undefined && bodyProjectId !== null && !isUuid(bodyProjectId)) return bad('projectId required')

  const paymentMethod: PaymentMethod = body.paymentMethod === undefined ? 'stripe' : (body.paymentMethod as PaymentMethod)
  if (!PAYMENT_METHODS.includes(paymentMethod)) return bad('Unknown payment method')

  if (!Array.isArray(body.items) || body.items.length === 0) return bad('Cart is empty')
  if (body.items.length > MAX_LINES) return bad('Too many items in cart')

  const wanted: Array<{ productId: string; variantId?: string; quantity: number }> = []
  for (const raw of body.items as RawItem[]) {
    if (!raw || typeof raw !== 'object') return bad('Invalid cart item')
    const qty = raw.quantity
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return bad(`Quantity must be a whole number between 1 and ${MAX_QTY}`)
    }
    const lineId = cleanText(raw.id, 200)
    let productId = cleanText(raw.productId, 200) ?? lineId
    let variantId = cleanText(raw.variantId, 200)
    // Legacy carts key variant lines as "productId:variantId".
    if (!raw.productId && lineId && lineId.includes(':') && !variantId) {
      const [p, v] = lineId.split(':', 2)
      productId = p
      variantId = v || undefined
    }
    if (!productId) return bad('Invalid cart item')
    wanted.push({ productId, variantId, quantity: qty })
  }

  // Stored lower-cased so the per-recipient abuse caps can't be sidestepped by case.
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
  if (!isValidEmail(customerEmail)) return bad('A valid email address is required')
  const customerName = cleanText(body.customerName, 200)
  const customerPhone = cleanText(body.customerPhone, 40)

  let shippingAddress: { ulice: string; mesto: string; psc: string; zeme?: string } | undefined
  if (body.shippingAddress && typeof body.shippingAddress === 'object') {
    const a = body.shippingAddress as Record<string, unknown>
    shippingAddress = {
      ulice: cleanText(a.ulice, 200) ?? '',
      mesto: cleanText(a.mesto, 120) ?? '',
      psc: cleanText(a.psc, 20) ?? '',
      zeme: cleanText(a.zeme, 60),
    }
  }
  const zasilkovnaBranchId = typeof body.zasilkovnaBranchId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.zasilkovnaBranchId)
    ? body.zasilkovnaBranchId : undefined
  const zasilkovnaBranchName = zasilkovnaBranchId ? cleanText(body.zasilkovnaBranchName, 200) : undefined
  const zasilkovnaBranchCountry = typeof body.zasilkovnaBranchCountry === 'string' && /^[A-Za-z]{2}$/.test(body.zasilkovnaBranchCountry)
    ? body.zasilkovnaBranchCountry.toLowerCase() : null
  const shippingCountry = typeof body.shippingCountry === 'string' && /^[A-Za-z]{2}$/.test(body.shippingCountry)
    ? body.shippingCountry.toUpperCase() : null

  // ── 2. Which project? (store key first — see PROJECT IDENTITY above) ──────
  const connIp = getClientIp(request)
  const keyResult = await resolveStoreKeyProject(request, connIp)
  if (keyResult.status === 'invalid') return bad('Invalid store API key', 401)
  // 'throttled' (too many bad keys from this shared egress IP, and this key not yet
  // known on this instance) is handled like a keyless request: the Origin-checked
  // paths and per-IP limits below still apply.
  if (keyResult.status === 'throttled') console.warn('[store/checkout] store key not checked (failure throttle)', { ip: connIp })
  let projectId: string
  if (keyResult.status === 'ok') {
    if (bodyProjectId && bodyProjectId !== keyResult.projectId) {
      console.warn('[store/checkout] body projectId does not match the store key', { keyProject: keyResult.projectId })
      return bad('projectId does not match this store.', 403)
    }
    projectId = keyResult.projectId
  } else {
    if (!isUuid(bodyProjectId)) return bad('projectId required')
    projectId = bodyProjectId
  }
  const trustedStore = keyResult.status === 'ok'

  // ── 3. Rate limits (in-memory, per instance) ──────────────────────────────
  // A store's own server proxies checkout, so every shopper arrives from the store's
  // (shared) Vercel egress IP. Keying the limit on that IP would let anyone lock a
  // store's checkout — or every store behind the same egress IP — with a few dozen
  // requests. So:
  //   - a proxy that proves itself with the project's QUANTE_API_KEY is trusted to
  //     forward the shopper IP (x-quante-client-ip) and the limit keys on the shopper;
  //     a keyed proxy that doesn't forward one (older build) gets a store-wide bucket
  //     sized for all of its shoppers and no connecting-IP limit;
  //   - everything else keys on the connecting IP.
  // Key verification itself is throttled per connecting IP (failures only) and cached
  // (successes), so junk Bearer tokens can't drive unthrottled DB lookups.
  const forwardedRaw = request.headers.get('x-quante-client-ip')
  const forwarded = forwardedRaw && /^[0-9A-Fa-f:.]{3,45}$/.test(forwardedRaw) ? forwardedRaw : null
  const WINDOW = 10 * 60_000
  const limits = trustedStore
    ? forwarded
      ? [rateLimit(`checkout:${projectId}:${forwarded}`, 30, WINDOW)]
      : [rateLimit(`checkout-store:${projectId}`, 600, WINDOW)]
    : [rateLimit(`checkout:${projectId}:${connIp}`, 30, WINDOW), rateLimit(`checkout-ip:${connIp}`, 300, WINDOW)]
  const blocked = limits.filter((l) => !l.allowed)
  if (blocked.length > 0) {
    return NextResponse.json({ error: 'Too many checkout attempts. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((Math.max(...blocked.map((l) => l.resetAt)) - Date.now()) / 1000)) },
    })
  }

  // ── 4. The store must be live ─────────────────────────────────────────────
  // A never-deployed / suspended / expired project may not take payments (stops
  // anyone creating a throwaway project to run payments through Quante's accounts).
  const gate = await getHostingGate(projectId)
  if (gate.reason === 'project_not_found' || gate.reason === 'invalid_project') return bad('Project not found', 404)
  if (!gate.everLive || !gate.canDeployProduction) {
    return bad('This store is not accepting orders right now.', 403)
  }

  // ── 5. Redirect base: only the store's own origins ────────────────────────
  const origins = await getStoreOrigins(projectId)
  // Platform origins for path (a): the configured app/site URLs plus the host this
  // request actually reached (a Vercel alias / preview domain, www vs apex — the same
  // set proxy.ts accepts). Safe: path (a) still requires the signed-in project owner.
  const quanteOrigins = new Set([
    originOf(quanteUrl), originOf(process.env.NEXT_PUBLIC_SITE_URL), originOf(request.url),
  ].filter(Boolean) as string[])
  const requireKey = process.env.STORE_CHECKOUT_REQUIRE_KEY === 'true'
  // Keyless requests may prove their store with the Referer when a proxy sent no Origin.
  const rawOrigin = request.headers.get('origin')
  const rawReferer = request.headers.get('referer')
  const reqOrigin = originOf(rawOrigin) ?? (trustedStore ? null : originOf(rawReferer))
  const returnPath = typeof body.returnBasePath === 'string' && /^\/[A-Za-z0-9/_-]{0,100}$/.test(body.returnBasePath) && !body.returnBasePath.includes('//')
    ? body.returnBasePath.replace(/\/$/, '') : ''
  let storeBase: string
  if (trustedStore) {
    // Keyed store proxy: its forwarded Origin must still be one of the project's own.
    if (reqOrigin) {
      if (!origins.allowed.has(reqOrigin)) return bad('Checkout is not allowed from this site.', 403)
      storeBase = `${reqOrigin}${returnPath}`
    } else if (origins.canonical) {
      storeBase = origins.canonical
    } else {
      return bad('Checkout is not allowed from this site.', 403)
    }
  } else if (reqOrigin && quanteOrigins.has(reqOrigin)) {
    // (a) Legacy manifest storefront rendered by Quante itself at /preview/<id> —
    // owner-only page, so only the signed-in owner may check out from it.
    const { userId } = await auth()
    if (!userId || !(await getOwnedProject(projectId, userId, 'id'))) {
      return bad('Checkout is not allowed from this site.', 403)
    }
    storeBase = `${reqOrigin}/preview/${projectId}`
  } else if (reqOrigin && origins.allowed.has(reqOrigin) && !requireKey) {
    // (b) Store deployed before its proxy sent QUANTE_API_KEY. Logged so the owner
    // can tell when STORE_CHECKOUT_REQUIRE_KEY can be switched on.
    console.info('[store/checkout] keyless legacy checkout', { projectId, origin: reqOrigin })
    storeBase = `${reqOrigin}${returnPath}`
  } else if (!rawOrigin && !rawReferer && !requireKey && origins.canonical) {
    // (c) Legacy manifest stores built before this change proxy server-to-server with
    // neither a key nor an Origin. Browsers always send Origin on a POST, so this path
    // is reachable only by non-browser callers — who could equally forge an allowed
    // Origin for (b) — so it adds no attack surface over (b): prices are recomputed and
    // the redirect goes to the project's own canonical store origin, never the caller's.
    // Without it every such store's checkout fails until it is redeployed. Logged; off
    // with STORE_CHECKOUT_REQUIRE_KEY=true.
    console.info('[store/checkout] keyless legacy checkout (no Origin)', { projectId })
    storeBase = `${origins.canonical}${returnPath}`
  } else {
    return bad('Checkout is not allowed from this site.', 403)
  }

  // ── 6. Authoritative prices, shipping and fees ────────────────────────────
  const pricing = await loadStorePricing(projectId)
  if (!pricing) return bad('This store is not accepting orders right now.', 503)
  const currency = pricing.currency

  const lines: OrderLine[] = []
  for (const w of wanted) {
    const priced = pricing.price(w.productId, w.variantId)
    if (!priced) return bad('A product in your cart is no longer available. Please refresh the page.', 409)
    const existing = lines.find((l) => l.id === priced.productId && l.variantId === priced.variantId)
    if (existing) {
      existing.quantity += w.quantity
      if (existing.quantity > MAX_QTY) return bad(`Quantity must be a whole number between 1 and ${MAX_QTY}`)
      continue
    }
    lines.push({
      id: priced.productId,
      variantId: priced.variantId,
      name: priced.name,
      price: priced.unitCents / 100,
      quantity: w.quantity,
      unitCents: priced.unitCents,
    })
  }
  const subtotalCents = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0)

  // Tracked stock (store_inventory) — refuse lines that exceed what is on hand.
  if (await findOutOfStock(projectId, lines)) {
    return bad('A product in your cart is out of stock or has fewer pieces left than requested. Please update your cart.', 409)
  }

  // Shipping: matched by method id, or by label (the code-gen cart sends the label).
  let shippingOpt: ShippingOption | undefined
  const wantedShipping = cleanText(body.shippingMethod, 200)
  if (pricing.shippingMethods.length > 0) {
    shippingOpt = wantedShipping
      ? pricing.shippingMethods.find((m) => m.id === wantedShipping) ?? pricing.shippingMethods.find((m) => m.label === wantedShipping)
      : undefined
    if (!shippingOpt) {
      if (wantedShipping || pricing.shippingMethods.length > 1) return bad('Please choose a valid shipping method.')
      shippingOpt = pricing.shippingMethods[0]
    }
  }
  const freeShipping = pricing.freeShippingFromCents > 0 && subtotalCents >= pricing.freeShippingFromCents
  const shippingCents = shippingOpt && !freeShipping ? shippingOpt.cents : 0

  if (paymentMethod === 'dobirka' && !pricing.cod.enabled) return bad('Cash on delivery is not available for this store.')
  if (paymentMethod === 'prevod' && !pricing.bankTransferEnabled) return bad('Bank transfer is not available for this store.')
  // Online methods must be ones the merchant offers — e.g. 'stripe' charges through
  // the platform's Stripe account, so a store that never enabled it must not get it.
  if (paymentMethod !== 'dobirka' && paymentMethod !== 'prevod' && !pricing.onlineMethods.has(paymentMethod)) {
    return bad('This payment method is not available for this store.')
  }
  const dobirkaCents = paymentMethod === 'dobirka' ? pricing.cod.feeCents : 0

  const totalCents = subtotalCents + shippingCents + dobirkaCents
  if (![subtotalCents, shippingCents, dobirkaCents, totalCents].every((n) => Number.isInteger(n) && n >= 0)) {
    return bad('Invalid order total')
  }
  if (totalCents > MAX_TOTAL_CENTS) return bad('Order total is too high for online checkout.')
  const isOnline = paymentMethod !== 'dobirka' && paymentMethod !== 'prevod'
  if (isOnline && totalCents <= 0) return bad('Order total is too low for online payment.')

  // ── 7. Durable abuse limits for unpaid orders (DB-backed) ─────────────────
  // Online orders send nothing until the provider confirms payment, so they are only
  // rate-limited above — a project-wide count of pending card orders would let a
  // handful of IPs lock every shopper out. Unpaid (dobirka / prevod) orders send
  // email immediately, so they are capped per recipient in this store, per recipient
  // across ALL stores (one victim can't be mailed by N stores), and per store.
  // The caps are enforced atomically (re-audit R10): reserve_unpaid_order_slot()
  // counts and reserves under advisory locks on the lower-cased recipient and on the
  // project, so a burst of parallel requests can't all read "0" and all send. A slot is
  // consumed even if the order insert below then fails (errs on the strict side).
  // Online orders reserve no slot here: they mail nothing until a provider confirms a
  // real payment, and the later shipped / refunded mails the store-key order API can
  // trigger are capped per recipient at send time (../_lib/order-mail.ts, re-audit R8).
  if (!isOnline && !(await reserveUnpaidOrderSlot(projectId, customerEmail))) {
    return bad('Too many orders. Please try again later.', 429)
  }

  // ── 8. Create the order (server-computed values only) ─────────────────────
  // Same value the carts used to send (and the Studio / emails expect): legacy
  // manifest stores the method type ('zasilkovna', 'ppl', … — the Studio keys carrier
  // actions on it), code-gen the merchant's label. Both come from server-side config.
  const shippingMethodStored = shippingOpt ? (pricing.mode === 'manifest' ? shippingOpt.id : shippingOpt.label || shippingOpt.id) : null
  const inserted = await insertOrderWithNumber(projectId, {
    payment_method: paymentMethod,
    payment_status: 'pending',
    status: 'pending',
    shipping_method: shippingMethodStored,
    zasilkovna_branch_id: zasilkovnaBranchId ?? null,
    zasilkovna_branch_name: zasilkovnaBranchName ?? null,
    zasilkovna_branch_country: zasilkovnaBranchCountry,
    shipping_country: shippingCountry,
    customer_email: customerEmail,
    customer_name: customerName ?? null,
    customer_phone: customerPhone ?? null,
    shipping_address: shippingAddress ?? null,
    items: lines.map((l) => ({ id: l.id, ...(l.variantId ? { variantId: l.variantId } : {}), name: l.name, price: l.price, quantity: l.quantity })),
    subtotal_cents: subtotalCents,
    shipping_cents: shippingCents,
    dobirka_cents: dobirkaCents,
    total_cents: totalCents,
    currency: currency.toLowerCase(),
  })
  if (!inserted) return bad('Failed to create order', 500)
  const { id: orderId, orderNumber } = inserted

  const totalAmount = totalCents / 100
  const emailInfo: OrderEmailInfo = {
    projectId,
    paidHosting: gate.hasActiveSubscription === true || gate.agency === true,
    orderNumber,
    paymentMethod,
    lines,
    currency,
    subtotal: subtotalCents / 100,
    shippingCost: shippingCents / 100,
    dobirkaFee: dobirkaCents / 100,
    total: totalAmount,
    shippingLabel: shippingOpt?.label,
    customerEmail,
    customerName,
    customerPhone,
    shippingAddress,
    zasilkovnaBranchName,
  }

  // ── 9. Route by payment method ────────────────────────────────────────────

  if (paymentMethod === 'stripe') {
    try {
      const cur = currency.toLowerCase()
      const lineItems = [
        ...lines.map((l) => ({
          price_data: { currency: cur, product_data: { name: l.name }, unit_amount: l.unitCents },
          quantity: l.quantity,
        })),
        ...(shippingCents > 0 ? [{
          price_data: { currency: cur, product_data: { name: shippingOpt?.label || 'Shipping' }, unit_amount: shippingCents },
          quantity: 1,
        }] : []),
      ]
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${storeBase}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${storeBase}/cart`,
        customer_email: customerEmail,
        metadata: { type: 'store_sale', project_id: projectId, order_id: orderId },
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: session.id }).eq('id', orderId)
      return NextResponse.json({ url: session.url })
    } catch (err) {
      console.error('[store/checkout] stripe error:', err instanceof Error ? err.message : err)
      await markFailed(orderId)
      return bad('Payment could not be started. Please try again.', 502)
    }
  }

  if (paymentMethod === 'comgate' || paymentMethod === 'gopay' || paymentMethod === 'paypal') {
    const creds = await getProjectPaymentCreds(projectId)
    const provider = paymentMethod === 'comgate' ? comgateForProject(creds)
      : paymentMethod === 'gopay' ? gopayForProject(creds)
      : paypalForProject(creds)
    const label = paymentMethod === 'comgate' ? 'Comgate' : paymentMethod === 'gopay' ? 'GoPay' : 'PayPal'
    if (!provider) {
      await markFailed(orderId)
      return bad(`${label} is not configured`, 503)
    }
    try {
      const result = await provider.createPayment({
        orderId,
        amount: totalCents,
        currency,
        label: `Order ${orderNumber}`,
        customerEmail,
        returnUrl: `${storeBase}/success?order=${encodeURIComponent(orderNumber)}`,
        cancelUrl: `${storeBase}/cart`,
        notifyUrl: `${quanteUrl}/api/payments/${paymentMethod}/notify`,
      })
      await supabaseAdmin.from('store_orders').update({ payment_ref: result.transactionId }).eq('id', orderId)
      // Confirmation emails are sent from the notify webhook once payment is captured.
      return NextResponse.json({ url: result.redirectUrl })
    } catch (err) {
      console.error(`[store/checkout] ${paymentMethod} error:`, err instanceof Error ? err.message : err)
      await markFailed(orderId)
      return bad('Payment could not be started. Please try again.', 502)
    }
  }

  if (paymentMethod === 'dobirka') {
    // No online payment — order is placed, paid on delivery
    await sendOrderConfirmationEmails(emailInfo).catch(logMailError)
    return NextResponse.json({ url: `${storeBase}/success?order=${encodeURIComponent(orderNumber)}&method=dobirka` })
  }

  // prevod (bank transfer)
  // SECURITY (audit #56): the redirect carries no account, amount or QR payload — the
  // success page used to render whatever the URL said, so a crafted link on the
  // store's own domain could show an attacker's account. It carries the order id and
  // an unguessable per-order token instead; the store's success page exchanges them
  // server-side at GET /api/store/order-status for the verified instructions. Only the
  // token's SHA-256 is stored. If the token can't be stored (migration not run yet)
  // the link simply has no token and the page points the customer to the email.
  const ctx = await loadStoreEmailContext(projectId).catch(() => null)
  const bankovniUcet = ctx?.bankAccount ?? ''
  await sendOrderConfirmationEmails(emailInfo, ctx, bankovniUcet).catch(logMailError)
  const token = await attachPublicToken(orderId)
  const qs = new URLSearchParams({ order: orderNumber, orderId, method: 'prevod' })
  if (token) qs.set('t', token)
  return NextResponse.json({ url: `${storeBase}/success?${qs.toString()}` })
}

// Random per-order token for the bank-transfer success page (see above). Returns the
// plaintext once; only its hash is persisted (store_orders.public_token_hash, from
// supabase/migration-security2-store-checkout.sql).
async function attachPublicToken(orderId: string): Promise<string | null> {
  const token = randomBytes(24).toString('base64url')
  const { error } = await supabaseAdmin
    .from('store_orders')
    .update({ public_token_hash: sha256Hex(token) })
    .eq('id', orderId)
  if (error) {
    console.error('[store/checkout] could not store order status token (run migration-security2-store-checkout.sql):', error.message)
    return null
  }
  return token
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The order already exists when mails go out — a mail failure never fails the checkout.
function logMailError(err: unknown) {
  console.error('[store/checkout] order mail failed:', err instanceof Error ? err.message : err)
}

async function markFailed(orderId: string) {
  await supabaseAdmin.from('store_orders')
    .update({ payment_status: 'failed', status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('payment_status', 'pending')
}

// Sequential per-project order number (YYYY-NNNN). The count-based guess can collide
// under concurrency; the UNIQUE (project_id, order_number) index from
// migration-credits-v2.sql rejects the duplicate and we retry with the next number.
async function insertOrderWithNumber(projectId: string, row: Record<string, unknown>): Promise<{ id: string; orderNumber: string } | null> {
  const year = new Date().getFullYear()
  const { count } = await supabaseAdmin
    .from('store_orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('created_at', `${year}-01-01`)
  let seq = (count ?? 0) + 1

  for (let attempt = 0; attempt < 8; attempt++) {
    const orderNumber = `${year}-${String(seq).padStart(4, '0')}`
    const { data, error } = await supabaseAdmin
      .from('store_orders')
      .insert({ ...row, project_id: projectId, order_number: orderNumber })
      .select('id')
      .single()
    if (!error && data) return { id: data.id as string, orderNumber }
    if ((error as { code?: string } | null)?.code !== '23505') {
      console.error('[store/checkout] order insert failed:', error?.message)
      return null
    }
    seq += 1 + Math.floor(Math.random() * 3)
  }
  return null
}

interface OrderEmailInfo {
  projectId: string
  /** The store has a paid hosting plan (or an Agency owner) — higher daily mail cap. */
  paidHosting: boolean
  orderNumber: string
  paymentMethod: PaymentMethod
  lines: OrderLine[]
  currency: string
  subtotal: number
  shippingCost: number
  dobirkaFee: number
  total: number
  shippingLabel?: string
  customerEmail: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: { ulice: string; mesto: string; psc: string; zeme?: string }
  zasilkovnaBranchName?: string
}

// Atomic unpaid-order caps (5 per recipient per store, 8 per recipient across all
// stores, 100 per store — all per hour) via reserve_unpaid_order_slot() from
// supabase/migration-security3-store-api.sql. Until that migration has run (or if the
// RPC errors) it falls back to the previous count-before-insert check, which is racy
// but keeps checkout working.
async function reserveUnpaidOrderSlot(projectId: string, customerEmail: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('reserve_unpaid_order_slot', {
    p_project_id: projectId,
    p_email: customerEmail,
  })
  if (!error) {
    if (data === 'ok') return true
    console.warn('[store/checkout] unpaid order cap reached', { projectId, cap: data })
    return false
  }
  console.error('[store/checkout] reserve_unpaid_order_slot failed — using non-atomic caps (run migration-security3-store-api.sql):', error.message)

  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
  const [{ count: perRecipient }, { count: perRecipientGlobal }, { count: perProjectUnpaid }] = await Promise.all([
    supabaseAdmin.from('store_orders').select('id', { count: 'exact', head: true })
      .eq('project_id', projectId).eq('customer_email', customerEmail).gte('created_at', hourAgo),
    supabaseAdmin.from('store_orders').select('id', { count: 'exact', head: true })
      .eq('customer_email', customerEmail).in('payment_method', ['dobirka', 'prevod']).gte('created_at', hourAgo),
    supabaseAdmin.from('store_orders').select('id', { count: 'exact', head: true })
      .eq('project_id', projectId).in('payment_method', ['dobirka', 'prevod']).gte('created_at', hourAgo),
  ])
  return !((perRecipient ?? 0) >= 5 || (perRecipientGlobal ?? 0) >= 8 || (perProjectUnpaid ?? 0) >= 100)
}

// Unpaid (dobirka / prevod) orders: confirmation to the order's own (validated) email
// address + new-order notice to the merchant. All values are server-side; the
// templates escape everything; the From is the merchant's verified domain or the
// platform mailbox with the store name as display name only.
// SECURITY (re-audit R10): the recipient is an address typed into a public form and
// never verified, and every path here — keyless legacy callers AND a keyed store's own
// /api/checkout proxy, which relays any visitor's request with the key — is reachable
// by anyone. So the customer mail keeps only the order number, the server-priced items
// and totals, the merchant's own shipping label / bank details and the store name; the
// caller's name, address and pickup-point name are left out, so no POST can put its own
// text in front of an arbitrary recipient. The merchant notice still carries everything
// (it goes to the merchant's own address, who needs it to fulfil the order).
// SECURITY (final audit F8): the merchant-authored text in the customer mail (store and
// merchant name, product names — max 80 chars —, shipping label, bank account) is made
// link-free by the templates (linkFreeText), and the order's mails must win a slot of the
// store's daily unpaid-order mail budget (lib/order-emails.ts reserveUnpaidMailSlot) —
// lower for stores without a paid hosting plan. One slot covers both mails of the order.
// The merchant notice goes to an address the merchant typed in and nobody verified, so
// it is link-free too (templates) and also needs a per-recipient daily slot across all
// stores (reserveMerchantNoticeSlot) — many throwaway stores naming one victim as their
// "merchant" can't flood that address. A refused slot only skips mail: the order stands
// and is listed in the Studio (the bank-transfer success page shows the payment details).
async function sendOrderConfirmationEmails(info: OrderEmailInfo, ctxIn?: StoreEmailContext | null, bankovniUcet?: string) {
  const ctx = ctxIn ?? await loadStoreEmailContext(info.projectId)
  if (!ctx) return
  const items = info.lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.price, currency: info.currency }))
  // One slot of the store's daily unpaid-order mail budget covers both mails below.
  if (!(await reserveUnpaidMailSlot(info.projectId, info.paidHosting))) return
  const from = await getProjectFromEmail(info.projectId, ctx.storeName)

  const customer = orderConfirmationEmail({
    orderNumber: info.orderNumber,
    customerName: 'zákazníku',
    customerEmail: info.customerEmail,
    items,
    subtotal: info.subtotal,
    shippingCost: info.shippingCost,
    dobirkaFee: info.dobirkaFee,
    total: info.total,
    currency: info.currency,
    paymentMethod: info.paymentMethod,
    shippingMethod: linkFreeText(info.shippingLabel, 80) || undefined,
    zasilkovnaBranchName: undefined,
    shippingAddress: undefined,
    storeName: ctx.storeName,
    accentColor: ctx.accentColor,
    merchantEmail: ctx.merchantEmail,
    merchantName: ctx.merchantName,
    bankovniUcet,
  })
  const sends: Promise<boolean>[] = [sendEmail(info.customerEmail, customer.subject, customer.html, from)]

  if (ctx.merchantEmail && await reserveMerchantNoticeSlot(info.projectId, ctx.merchantEmail, info.paidHosting)) {
    const merchant = merchantNewOrderEmail({
      orderNumber: info.orderNumber,
      customerName: info.customerName ?? '—',
      customerEmail: info.customerEmail,
      customerPhone: info.customerPhone,
      items,
      total: info.total,
      currency: info.currency,
      paymentMethod: info.paymentMethod,
      shippingMethod: info.shippingLabel,
      shippingAddress: info.shippingAddress,
      storeName: ctx.storeName,
      accentColor: ctx.accentColor,
    })
    sends.push(sendEmail(ctx.merchantEmail, merchant.subject, merchant.html, from))
  }
  await Promise.all(sends)
}
