// Supplier catalog (CLAUDE.md §13r): a paid order goes to the suppliers whose products it holds.
// Server-only.
//
// EXACTLY ONCE PER ORDER × SUPPLIER: a supplier_orders row ('creating') is INSERTED FIRST; its
// UNIQUE(order_id, supplier_id) makes every later attempt (webhook retry, the cron safety net,
// a double click) a no-op. Only after that insert the e-mail goes out. A failed send becomes
// 'failed' and the cron retries it (new link token, max 3 attempts). A row stuck in 'creating'
// (the process died between insert and send) is NEVER resent automatically — the merchant sees
// it in the Studio and checks with the supplier: a duplicate parcel costs more than a late one.
//
// The supplier confirms the shipment on /supplier-order/<id>?t=<token> (token: 24 random bytes,
// only its sha256 is stored). When the supplier shipments cover the whole order, the order is
// marked shipped with the tracking code and the customer gets the store's usual shipping e-mail.

import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/qbox/store'
import { APP_ORIGIN } from '@/lib/domains'
import { getProjectFromEmail, sendEmail, shippingEmail } from '@/lib/email-templates'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { reserveOrderMailSlot } from '@/app/api/store/_lib/order-mail'
import { escapeHtml as escape } from '@/lib/html'
import { supplierOrderEmail } from './email'
import { coversWholeOrder, shouldDispatch, splitBySupplier, type LinkForOrder, type SupplierLine } from './model'

export const DISPATCH_LIMITS = { attempts: 3, lookbackDays: 3, cronOrders: 300 } as const

const ORDER_COLUMNS = 'id, project_id, order_number, status, payment_status, payment_method, items, customer_name, customer_email, customer_phone, shipping_address, shipping_country, shipping_method, zasilkovna_branch_id, zasilkovna_branch_name, currency, created_at'

interface OrderRow {
  id: string
  project_id: string
  order_number: string
  status: string
  payment_status: string | null
  payment_method: string | null
  items: unknown
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  shipping_address: { ulice?: string; mesto?: string; psc?: string; zeme?: string } | null
  shipping_country: string | null
  shipping_method: string | null
  zasilkovna_branch_id: string | null
  zasilkovna_branch_name: string | null
  currency: string
  created_at: string
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function tokenMatches(token: unknown, hash: string): boolean {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return false
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function linksFor(projectId: string, items: unknown): Promise<LinkForOrder[]> {
  const ids = Array.isArray(items) ? [...new Set((items as Array<{ id?: unknown }>).map((i) => i?.id).filter((x): x is string => typeof x === 'string'))] : []
  if (!ids.length) return []
  const { data, error } = await supabaseAdmin
    .from('store_supplier_links')
    .select('product_id, supplier_id, supplier_product_id, supplier_products(external_id, name, ean, sku, wholesale_cents)')
    .eq('project_id', projectId)
    .in('product_id', ids.slice(0, 200))
  if (error) {
    if (!isMissingTable(error)) console.error('[suppliers] link lookup failed:', error.message)
    return []
  }
  type Row = { product_id: string; supplier_id: string; supplier_product_id: string; supplier_products: { external_id: string; name: string; ean: string; sku: string; wholesale_cents: number } | null }
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.supplier_products)
    .map((r) => ({
      product_id: r.product_id, supplier_id: r.supplier_id, supplier_product_id: r.supplier_product_id,
      external_id: r.supplier_products!.external_id, name: r.supplier_products!.name, ean: r.supplier_products!.ean,
      sku: r.supplier_products!.sku, wholesale_cents: r.supplier_products!.wholesale_cents,
    }))
}

function confirmUrl(id: string, token: string): string {
  return `${APP_ORIGIN}/supplier-order/${id}?t=${token}`
}

async function sendToSupplier(order: OrderRow, supplierId: string, supplierOrderId: string, token: string, lines: SupplierLine[]): Promise<{ ok: boolean; error?: string }> {
  const { data: supplier } = await supabaseAdmin.from('suppliers').select('name, order_email, currency').eq('id', supplierId).maybeSingle()
  if (!supplier) return { ok: false, error: 'Supplier not found.' }
  const ctx = await loadStoreEmailContext(order.project_id)
  const storeName = ctx?.storeName ?? 'E-shop'
  const m = ctx?.merchant
  const a = order.shipping_address ?? {}
  const pickup = order.zasilkovna_branch_id ? `Zásilkovna ${order.zasilkovna_branch_name ?? ''} (ID ${order.zasilkovna_branch_id})`.trim() : null
  const { subject, html } = supplierOrderEmail({
    supplierName: supplier.name as string,
    storeName,
    orderNumber: order.order_number,
    orderDate: new Date(order.created_at).toLocaleDateString('cs-CZ'),
    confirmUrl: confirmUrl(supplierOrderId, token),
    merchant: m ? {
      name: m.obchodni_nazev, ico: m.ico ?? '', dic: m.dic ?? '',
      address: [m.sidlo?.ulice, [m.sidlo?.psc, m.sidlo?.mesto].filter(Boolean).join(' '), m.sidlo?.zeme].filter(Boolean).join(', '),
      email: m.kontakt?.email || ctx?.merchantEmail || '', phone: m.kontakt?.telefon ?? '',
    } : null,
    shipTo: {
      name: order.customer_name ?? '', street: a.ulice ?? '', city: a.mesto ?? '', postalCode: a.psc ?? '',
      country: (a.zeme || order.shipping_country || 'CZ').toUpperCase(), phone: order.customer_phone ?? '', email: order.customer_email ?? '',
      pickupPoint: pickup, shippingMethod: order.shipping_method,
    },
    lines: lines.map((l) => ({ externalId: l.externalId, ean: l.ean, name: l.name, quantity: l.quantity, wholesaleCents: l.wholesaleCents })),
    currency: (supplier.currency as string) || order.currency,
  })
  const from = await getProjectFromEmail(order.project_id, storeName)
  const sent = await sendEmail(supplier.order_email as string, subject, html, from, { replyTo: ctx?.merchantEmail ?? null })
  return sent ? { ok: true } : { ok: false, error: 'The e-mail could not be sent.' }
}

/** Sends a paid order's supplier lines to their suppliers. Safe to call any number of times. */
export async function dispatchSupplierOrders(orderId: string): Promise<{ sent: number; skipped: string | null }> {
  const { data: order } = await supabaseAdmin.from('store_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
  if (!order) return { sent: 0, skipped: 'no order' }
  const o = order as OrderRow
  if (!shouldDispatch(o)) return { sent: 0, skipped: 'not ready' }
  const links = await linksFor(o.project_id, o.items)
  const split = splitBySupplier(o.items, links)
  let sent = 0
  for (const [supplierId, lines] of split) {
    const { token, hash } = newToken()
    const { data: row, error } = await supabaseAdmin
      .from('supplier_orders')
      .insert({ order_id: o.id, project_id: o.project_id, supplier_id: supplierId, status: 'creating', items: lines, token_hash: hash, attempts: 1 })
      .select('id')
      .single()
    if (error) {
      if (error.code !== '23505') console.error('[suppliers] supplier order insert failed:', error.message)
      continue // 23505 = this order already went to this supplier
    }
    const res = await sendToSupplier(o, supplierId, row.id as string, token, lines)
    const now = new Date().toISOString()
    await supabaseAdmin.from('supplier_orders').update(res.ok
      ? { status: 'sent', sent_at: now, error: null, updated_at: now }
      : { status: 'failed', error: res.error ?? 'failed', updated_at: now }).eq('id', row.id)
    if (res.ok) sent++
  }
  return { sent, skipped: null }
}

/** Never throws: for the payment webhooks, which must answer the provider whatever happens here. */
export async function dispatchSupplierOrdersSafe(orderId: string): Promise<void> {
  try {
    await dispatchSupplierOrders(orderId)
  } catch (e) {
    console.error(`[suppliers] dispatch for order ${orderId} failed:`, e)
  }
}

/** Cron safety net: recent paid orders of stores that sell catalog products + failed sends (retry). */
export async function dispatchPending(): Promise<{ checked: number; sent: number; retried: number }> {
  const since = new Date(Date.now() - DISPATCH_LIMITS.lookbackDays * 86_400_000).toISOString()
  const { data: linked, error } = await supabaseAdmin.from('store_supplier_links').select('project_id').limit(5000)
  if (isMissingTable(error)) return { checked: 0, sent: 0, retried: 0 }
  const projects = [...new Set((linked ?? []).map((r) => r.project_id as string))]
  let checked = 0
  let sent = 0
  for (let i = 0; i < projects.length; i += 100) {
    const { data: orders } = await supabaseAdmin
      .from('store_orders')
      .select('id')
      .in('project_id', projects.slice(i, i + 100))
      .eq('payment_status', 'paid')
      .eq('status', 'paid')
      .gte('created_at', since)
      .limit(DISPATCH_LIMITS.cronOrders)
    for (const ord of orders ?? []) {
      checked++
      sent += (await dispatchSupplierOrders(ord.id as string)).sent
    }
  }

  let retried = 0
  const { data: failed } = await supabaseAdmin
    .from('supplier_orders')
    .select('id, order_id, supplier_id, items, attempts')
    .eq('status', 'failed')
    .lt('attempts', DISPATCH_LIMITS.attempts)
    .gte('created_at', since)
    .limit(100)
  for (const f of failed ?? []) {
    const { data: order } = await supabaseAdmin.from('store_orders').select(ORDER_COLUMNS).eq('id', f.order_id).maybeSingle()
    if (!order || !shouldDispatch(order as OrderRow)) continue
    const { token, hash } = newToken()
    // Claim the retry: only the run that moves failed → creating sends.
    const { data: claimed } = await supabaseAdmin.from('supplier_orders')
      .update({ status: 'creating', token_hash: hash, attempts: (f.attempts as number) + 1, updated_at: new Date().toISOString() })
      .eq('id', f.id).eq('status', 'failed').select('id')
    if (!claimed?.length) continue
    const res = await sendToSupplier(order as OrderRow, f.supplier_id as string, f.id as string, token, f.items as SupplierLine[])
    const now = new Date().toISOString()
    await supabaseAdmin.from('supplier_orders').update(res.ok
      ? { status: 'sent', sent_at: now, error: null, updated_at: now }
      : { status: 'failed', error: res.error ?? 'failed', updated_at: now }).eq('id', f.id)
    if (res.ok) retried++
  }
  return { checked, sent, retried }
}

// ── The supplier's side ──────────────────────────────────────────────────────

export interface SupplierOrderView {
  id: string
  status: string
  storeName: string
  orderNumber: string
  supplierName: string
  items: SupplierLine[]
  trackingCode: string | null
  shipTo: { name: string; city: string; country: string }
}

async function loadForSupplier(id: string, token: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await supabaseAdmin
    .from('supplier_orders')
    .select('id, order_id, project_id, supplier_id, status, items, token_hash, tracking_code, suppliers(name)')
    .eq('id', id)
    .maybeSingle()
  if (!data || !tokenMatches(token, data.token_hash as string)) return null
  return data as unknown as { id: string; order_id: string; project_id: string; supplier_id: string; status: string; items: SupplierLine[]; token_hash: string; tracking_code: string | null; suppliers: { name: string } | null }
}

export async function supplierOrderView(id: string, token: unknown): Promise<SupplierOrderView | null> {
  const row = await loadForSupplier(id, token)
  if (!row) return null
  const [{ data: order }, ctx] = await Promise.all([
    supabaseAdmin.from('store_orders').select('order_number, customer_name, shipping_address, shipping_country').eq('id', row.order_id).maybeSingle(),
    loadStoreEmailContext(row.project_id),
  ])
  const a = (order?.shipping_address ?? {}) as { mesto?: string; zeme?: string }
  return {
    id: row.id, status: row.status, storeName: ctx?.storeName ?? 'E-shop', orderNumber: (order?.order_number as string) ?? '',
    supplierName: row.suppliers?.name ?? '', items: row.items, trackingCode: row.tracking_code,
    shipTo: { name: (order?.customer_name as string) ?? '', city: a.mesto ?? '', country: (a.zeme || (order?.shipping_country as string) || 'CZ').toUpperCase() },
  }
}

export type ConfirmResult = { ok: true; status: 'shipped' | 'cannot' } | { ok: false; status: number; error: string }

export async function confirmBySupplier(
  id: string,
  token: unknown,
  input: { action: 'shipped'; trackingCode: string; trackingUrl: string | null; carrier: string | null } | { action: 'cannot'; reason: string },
): Promise<ConfirmResult> {
  const row = await loadForSupplier(id, token)
  if (!row) return { ok: false, status: 404, error: 'Odkaz neplatí.' }
  if (row.status === 'shipped' || row.status === 'cannot') return { ok: false, status: 409, error: 'Tato objednávka už je vyřízená.' }
  const now = new Date().toISOString()
  const update = input.action === 'shipped'
    ? { status: 'shipped', tracking_code: input.trackingCode, tracking_url: input.trackingUrl, carrier: input.carrier, shipped_at: now, updated_at: now }
    : { status: 'cannot', error: input.reason, updated_at: now }
  const { data: moved } = await supabaseAdmin.from('supplier_orders').update(update).eq('id', id).eq('status', row.status).select('id')
  if (!moved?.length) return { ok: false, status: 409, error: 'Objednávka se mezitím změnila, načtěte stránku znovu.' }

  const ctx = await loadStoreEmailContext(row.project_id)
  if (input.action === 'cannot') {
    if (ctx?.merchantEmail) {
      const { data: o } = await supabaseAdmin.from('store_orders').select('order_number').eq('id', row.order_id).maybeSingle()
      await sendEmail(ctx.merchantEmail, `Dodavatel nemůže odeslat objednávku ${o?.order_number ?? ''}`,
        `<p>Dodavatel <b>${escape(row.suppliers?.name ?? '')}</b> nemůže odeslat zboží z objednávky ${escape(String(o?.order_number ?? ''))}.</p><p>Důvod: ${escape(input.reason)}</p><p>Vyřiďte prosím objednávku se zákazníkem (vrácení peněz nebo náhrada) ve Studiu → Objednávky.</p>`)
    }
    return { ok: true, status: 'cannot' }
  }
  await markOrderShippedIfComplete(row.order_id, row.project_id)
  return { ok: true, status: 'shipped' }
}

/** When every line of the order came from suppliers and every supplier shipped: the order is shipped. */
async function markOrderShippedIfComplete(orderId: string, projectId: string): Promise<void> {
  const [{ data: order }, { data: parts }] = await Promise.all([
    supabaseAdmin.from('store_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle(),
    supabaseAdmin.from('supplier_orders').select('status, tracking_code, tracking_url, carrier').eq('order_id', orderId),
  ])
  if (!order || !parts?.length || parts.some((p) => p.status !== 'shipped')) return
  const o = order as OrderRow
  if (o.status !== 'paid') return
  const links = await linksFor(projectId, o.items)
  if (!coversWholeOrder(o.items, links)) return
  const trackingCode = parts.map((p) => p.tracking_code).filter(Boolean).join(', ').slice(0, 100)
  const trackingUrl = parts.length === 1 ? (parts[0].tracking_url as string | null) : null
  const { data: moved } = await supabaseAdmin.from('store_orders')
    .update({ status: 'shipped', tracking_code: trackingCode, tracking_url: trackingUrl, updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('status', 'paid').select('id')
  if (!moved?.length || !o.customer_email) return
  if (!(await reserveOrderMailSlot(projectId, orderId, o.customer_email))) return
  const ctx = await loadStoreEmailContext(projectId)
  if (!ctx) return
  const { subject, html } = shippingEmail({
    orderNumber: o.order_number, customerName: o.customer_name ?? 'zákazníku', storeName: ctx.storeName, accentColor: ctx.accentColor,
    merchantEmail: ctx.merchantEmail, merchantName: ctx.merchantName, trackingCode, trackingUrl: trackingUrl ?? undefined,
    carrier: parts.length === 1 ? (parts[0].carrier as string | null) ?? undefined : undefined,
  })
  await sendEmail(o.customer_email, subject, html, await getProjectFromEmail(projectId, ctx.storeName))
}

export interface StoreSupplierOrder {
  id: string
  orderId: string
  supplier: string
  status: string
  trackingCode: string | null
  trackingUrl: string | null
  error: string | null
  createdAt: string
}

/** For the Studio: what went to which supplier. */
export async function supplierOrdersForProject(projectId: string): Promise<StoreSupplierOrder[]> {
  const { data, error } = await supabaseAdmin
    .from('supplier_orders')
    .select('id, order_id, status, tracking_code, tracking_url, error, created_at, suppliers(name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return []
  type Row = { id: string; order_id: string; status: string; tracking_code: string | null; tracking_url: string | null; error: string | null; created_at: string; suppliers: { name: string } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, orderId: r.order_id, supplier: r.suppliers?.name ?? '', status: r.status,
    trackingCode: r.tracking_code, trackingUrl: r.tracking_url, error: r.error, createdAt: r.created_at,
  }))
}
