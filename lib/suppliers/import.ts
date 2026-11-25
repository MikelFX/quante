// Supplier catalog (CLAUDE.md §13r): the daily feed import and the sync of linked stores.
// Server-only. The feed is fetched through the Qscan fetcher (lib/qscan/fetch.ts — the only way
// out: public hosts on 80/443, every redirect re-checked, size and time caps).
//
// One import:  fetch → parseFeed → normalizeItem → upsert by (supplier_id, external_id) with a
// fresh seen_at → everything this import did not list becomes unavailable (stock 0). A feed that
// yields no products is an ERROR and changes nothing (a broken feed must not empty the catalog).
// Then every store product linked to this supplier gets the new stock (store_inventory, so the
// store's checkout refuses what the supplier does not have) and a price alert when the wholesale
// price moved more than 5 % since the merchant last saw it. Prices in the stores never change here.

import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scanFetch } from '@/lib/qscan/fetch'
import { isMissingTable } from '@/lib/qbox/store'
import { parseFeed } from './feed'
import { normalizeItem, priceMoved, type CatalogRow, type Supplier } from './model'

export const IMPORT_LIMITS = {
  feedBytes: 60 * 1024 * 1024,
  feedTimeoutMs: 120_000,
  upsertChunk: 500,
  /** Stock shown for an available product whose feed gives no amount. */
  unknownStock: 999,
} as const

export const SUPPLIER_COLUMNS = 'id, slug, name, status, feed_url, feed_format, wholesale_field, wholesale_discount_pct, currency, order_email, dispatch_days, ships_to, note'

export class CatalogNotSetUpError extends Error {
  constructor() { super('Supplier catalog is not set up (run supabase/migration-supplier-catalog.sql).') }
}

function decode(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 300).toString('latin1')
  const label = head.match(/encoding=["']([\w-]+)["']/i)?.[1] ?? contentType.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(label.toLowerCase()).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

export interface ImportResult {
  supplier: string
  ok: boolean
  items?: number
  imported?: number
  skipped?: number
  gone?: number
  linkedUpdated?: number
  error?: string
}

export async function importSupplier(supplier: Supplier): Promise<ImportResult> {
  const startedAt = new Date().toISOString()
  const fail = async (error: string): Promise<ImportResult> => {
    await supabaseAdmin.from('suppliers').update({ last_import_at: startedAt, last_import_error: error.slice(0, 500), updated_at: startedAt }).eq('id', supplier.id)
    return { supplier: supplier.slug, ok: false, error }
  }

  let text: string
  try {
    const res = await scanFetch(supplier.feed_url, {
      maxBytes: IMPORT_LIMITS.feedBytes,
      timeoutMs: IMPORT_LIMITS.feedTimeoutMs,
      accept: 'application/xml,text/xml,text/csv,application/rss+xml,*/*;q=0.5',
    })
    if (res.status !== 200) return fail(`Feed answered ${res.status}.`)
    text = decode(res.body, res.contentType)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Feed could not be downloaded.')
  }

  const items = parseFeed(text, supplier.feed_format, { wholesaleField: supplier.wholesale_field })
  const rows = new Map<string, CatalogRow>()
  for (const item of items) {
    const row = normalizeItem(item, supplier)
    if (row && !rows.has(row.external_id)) rows.set(row.external_id, row)
  }
  if (rows.size === 0) return fail(items.length ? `${items.length} items, none with a name and a wholesale price.` : 'The feed has no products we can read.')

  const list = [...rows.values()]
  for (let i = 0; i < list.length; i += IMPORT_LIMITS.upsertChunk) {
    const chunk = list.slice(i, i + IMPORT_LIMITS.upsertChunk).map((r) => ({ ...r, supplier_id: supplier.id, seen_at: startedAt, updated_at: startedAt }))
    const { error } = await supabaseAdmin.from('supplier_products').upsert(chunk, { onConflict: 'supplier_id,external_id' })
    if (error) return fail(`Saving products failed: ${error.message}`)
  }

  // Not in today's feed = not orderable today. Kept (links may point at it), never deleted.
  const { data: gone } = await supabaseAdmin
    .from('supplier_products')
    .update({ available: false, stock: 0, updated_at: startedAt })
    .eq('supplier_id', supplier.id)
    .lt('seen_at', startedAt)
    .eq('available', true)
    .select('id')

  await supabaseAdmin.from('suppliers').update({
    product_count: list.length, last_import_at: startedAt, last_import_error: null, updated_at: startedAt,
  }).eq('id', supplier.id)

  const linkedUpdated = await syncLinkedStores(supplier.id)
  return { supplier: supplier.slug, ok: true, items: items.length, imported: list.length, skipped: items.length - list.length, gone: gone?.length ?? 0, linkedUpdated }
}

interface LinkRow {
  id: string
  project_id: string
  product_id: string
  wholesale_cents: number
  price_alert: boolean
  supplier_products: { stock: number | null; available: boolean; wholesale_cents: number } | null
}

/** Stock the store may sell for a catalog product (0 when the supplier has none). */
export function storeStock(p: { stock: number | null; available: boolean }): number {
  if (!p.available) return 0
  return Math.max(0, Math.min(p.stock ?? IMPORT_LIMITS.unknownStock, IMPORT_LIMITS.unknownStock))
}

/** Pushes stock + price alerts of one supplier's products into every store that sells them. */
export async function syncLinkedStores(supplierId: string): Promise<number> {
  let updated = 0
  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('store_supplier_links')
      .select('id, project_id, product_id, wholesale_cents, price_alert, supplier_products(stock, available, wholesale_cents)')
      .eq('supplier_id', supplierId)
      .order('id')
      .range(page * 500, page * 500 + 499)
    if (error || !data?.length) break
    for (const link of data as unknown as LinkRow[]) {
      const p = link.supplier_products
      if (!p) continue
      await setInventory(link.project_id, link.product_id, storeStock(p))
      const alert = priceMoved(link.wholesale_cents, p.wholesale_cents)
      if (alert !== link.price_alert) {
        await supabaseAdmin.from('store_supplier_links').update({ price_alert: alert }).eq('id', link.id)
      }
      updated++
    }
    if (data.length < 500) break
  }
  return updated
}

/** store_inventory's uniqueness is an expression index, so select → update / insert (same as the byrd stock cron). */
export async function setInventory(projectId: string, productId: string, qty: number): Promise<void> {
  const { data } = await supabaseAdmin
    .from('store_inventory')
    .select('id, stock_qty')
    .eq('project_id', projectId)
    .eq('product_id', productId)
    .is('variant_id', null)
    .maybeSingle()
  if (data) {
    if (data.stock_qty !== qty) await supabaseAdmin.from('store_inventory').update({ stock_qty: qty, updated_at: new Date().toISOString() }).eq('id', data.id)
  } else {
    await supabaseAdmin.from('store_inventory').insert({ project_id: projectId, product_id: productId, variant_id: null, stock_qty: qty })
  }
}

export async function activeSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabaseAdmin.from('suppliers').select(SUPPLIER_COLUMNS).eq('status', 'active').order('created_at')
  if (isMissingTable(error)) throw new CatalogNotSetUpError()
  if (error) throw new Error(error.message)
  return (data ?? []) as Supplier[]
}
