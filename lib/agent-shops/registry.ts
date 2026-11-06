// Registry of agent-ready stores (server only): reads a store's /.well-known/agent-shop.json and
// product list through Qscan's SSRF-safe fetcher, keeps them in agent_shops / agent_shop_products
// (supabase/migration-agent-shops.sql) and searches them. Pure rules: ./model.ts.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ScanFetchError, scanFetch } from '@/lib/qscan/fetch'
import {
  WELL_KNOWN_PATH, nextStatus, parseProducts, parseShopDoc, shopCard,
  searchHit, type RegistryProduct, type SearchFilters, type SearchRow, type ShopDoc, type ShopRow,
} from './model'

export class RegistryUnavailable extends Error {}

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|could not find/i.test(e.message ?? ''))

async function readJson(url: string, maxBytes: number): Promise<unknown> {
  let res
  try {
    res = await scanFetch(url, { timeoutMs: 12_000, maxBytes, accept: 'application/json' })
  } catch (e) {
    throw new Error(e instanceof ScanFetchError ? e.message : 'Could not reach the store.')
  }
  if (res.status !== 200) throw new Error(`${new URL(url).pathname} answered HTTP ${res.status}.`)
  try {
    return JSON.parse(res.body.toString('utf8'))
  } catch {
    throw new Error(`${new URL(url).pathname} is not JSON.`)
  }
}

export type ReadResult = { ok: true; doc: ShopDoc; products: RegistryProduct[] } | { ok: false; error: string }

/** Reads a store the way any agent would: its description, then its product list. */
export async function readShop(origin: string): Promise<ReadResult> {
  try {
    const parsed = parseShopDoc(await readJson(origin + WELL_KNOWN_PATH, 512 * 1024), origin)
    if (!parsed.ok) return parsed
    const products = parseProducts(await readJson(parsed.value.productsUrl, 8 * 1024 * 1024), parsed.value)
    return { ok: true, doc: parsed.value, products }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the store.' }
  }
}

export interface ListedShop {
  id: string; origin: string; project_id: string | null; user_id: string; status: string; name: string
  products_count: number; in_stock_count: number; ordering: boolean; listed_at: string; checked_at: string | null
  last_ok_at: string | null; fail_count: number; last_error: string | null
}

const SHOP_COLS = 'id, origin, project_id, user_id, status, name, products_count, in_stock_count, ordering, listed_at, checked_at, last_ok_at, fail_count, last_error'

/** The registry row of a project's store, null when never listed. Throws RegistryUnavailable without the migration. */
export async function shopForProject(projectId: string): Promise<ListedShop | null> {
  const { data, error } = await supabaseAdmin.from('agent_shops').select(SHOP_COLS).eq('project_id', projectId).maybeSingle()
  if (missingTable(error)) throw new RegistryUnavailable()
  if (error) throw new Error(error.message)
  return (data as ListedShop | null) ?? null
}

async function replaceProducts(shopId: string, products: RegistryProduct[]) {
  const del = await supabaseAdmin.from('agent_shop_products').delete().eq('shop_id', shopId)
  if (del.error) throw new Error(del.error.message)
  for (let i = 0; i < products.length; i += 500) {
    const rows = products.slice(i, i + 500).map((p) => ({
      shop_id: shopId, product_id: p.productId, name: p.name, description: p.description, url: p.url, image: p.image,
      price: p.price, compare_at: p.compareAt, currency: p.currency, available: p.available, stock: p.stock, tags: p.tags, search_text: p.searchText,
    }))
    const ins = await supabaseAdmin.from('agent_shop_products').insert(rows)
    if (ins.error) throw new Error(ins.error.message)
  }
}

function shopFields(doc: ShopDoc, products: RegistryProduct[], now: string) {
  return {
    name: doc.name, description: doc.description, country: doc.country, language: doc.language, currency: doc.currency,
    ordering: doc.ordering, products_count: products.length, in_stock_count: products.filter((p) => p.available).length,
    doc, checked_at: now, last_ok_at: now, fail_count: 0, last_error: null,
  }
}

/** Lists (or re-lists) a project's store from a successful read. */
export async function saveListing(p: { projectId: string; userId: string; origin: string; read: Extract<ReadResult, { ok: true }> }): Promise<ListedShop> {
  const now = new Date().toISOString()
  const fields = { ...shopFields(p.read.doc, p.read.products, now), status: 'listed', origin: p.origin, user_id: p.userId, project_id: p.projectId }
  const existing = await shopForProject(p.projectId)
  let row: ListedShop
  if (existing) {
    const { data, error } = await supabaseAdmin.from('agent_shops').update({ ...fields, listed_at: existing.status === 'removed' ? now : existing.listed_at }).eq('id', existing.id).select(SHOP_COLS).single()
    if (error) throw new Error(error.message)
    row = data as ListedShop
  } else {
    const { data, error } = await supabaseAdmin.from('agent_shops').insert({ ...fields, listed_at: now }).select(SHOP_COLS).single()
    if (error) throw new Error(error.code === '23505' ? 'This store address is already listed.' : error.message)
    row = data as ListedShop
  }
  await replaceProducts(row.id, p.read.products)
  return row
}

/** Takes a store out of the registry (the row stays, so listing it again is free). */
export async function removeListing(shopId: string) {
  await supabaseAdmin.from('agent_shop_products').delete().eq('shop_id', shopId)
  const { error } = await supabaseAdmin.from('agent_shops').update({ status: 'removed', products_count: 0, in_stock_count: 0 }).eq('id', shopId)
  if (error) throw new Error(error.message)
}

/** Daily re-read of one store (cron): fresh products, or one more failure toward 'unreachable'. */
export async function refreshShop(s: Pick<ListedShop, 'id' | 'origin' | 'status' | 'fail_count'>) {
  const now = new Date().toISOString()
  const r = await readShop(s.origin)
  if (r.ok) {
    await replaceProducts(s.id, r.products)
    await supabaseAdmin.from('agent_shops').update({ ...shopFields(r.doc, r.products, now), status: nextStatus(s.status, true, 0) }).eq('id', s.id)
    return { origin: s.origin, ok: true, products: r.products.length }
  }
  const fails = s.fail_count + 1
  await supabaseAdmin.from('agent_shops').update({ checked_at: now, fail_count: fails, last_error: r.error.slice(0, 300), status: nextStatus(s.status, false, fails) }).eq('id', s.id)
  return { origin: s.origin, ok: false, error: r.error }
}

/** Stores to re-read, oldest check first. */
export async function shopsToRefresh(limit: number): Promise<ListedShop[]> {
  const { data, error } = await supabaseAdmin.from('agent_shops').select(SHOP_COLS).in('status', ['listed', 'unreachable'])
    .order('checked_at', { ascending: true, nullsFirst: true }).limit(limit)
  if (missingTable(error)) return []
  if (error) throw new Error(error.message)
  return (data ?? []) as ListedShop[]
}

/** The free directory: every listed store, newest first. */
export async function listDirectory(p: { country: string | null; limit: number; offset: number }) {
  let q = supabaseAdmin.from('agent_shops')
    .select('origin, name, description, country, language, currency, ordering, products_count, in_stock_count, listed_at, last_ok_at', { count: 'exact' })
    .eq('status', 'listed').order('listed_at', { ascending: false }).range(p.offset, p.offset + p.limit - 1)
  if (p.country) q = q.eq('country', p.country)
  const { data, error, count } = await q
  if (missingTable(error)) throw new RegistryUnavailable()
  if (error) throw new Error(error.message)
  return { total: count ?? 0, shops: ((data ?? []) as ShopRow[]).map(shopCard) }
}

/** Product search across listed stores. */
export async function searchRegistry(f: SearchFilters & { tsquery: string }) {
  const { data, error } = await supabaseAdmin.rpc('agent_shop_search', {
    p_query: f.tsquery, p_country: f.country, p_currency: f.currency, p_max_price: f.maxPrice, p_in_stock: f.inStock, p_limit: f.limit,
  })
  if (missingTable(error)) throw new RegistryUnavailable()
  if (error) throw new Error(error.message)
  return ((data ?? []) as SearchRow[]).map(searchHit)
}
