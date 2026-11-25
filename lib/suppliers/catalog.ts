// Supplier catalog (CLAUDE.md §13r): searching the catalog and adding a catalog product to a
// store. Server-only.
//
// Adding = (1) the price is checked (never below wholesale), (2) the supplier's photos are copied
// into our public store-assets bucket under the merchant's own folder (type from the bytes; the
// store never hotlinks the supplier), (3) the product is written into data/products.ts as a NEW
// CODE VERSION — exactly like the Studio's manual product edit, so nothing reaches shoppers before
// Publish — and (4) the link + the stock row are saved. A product already in the store is refused.

import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scanFetch } from '@/lib/qscan/fetch'
import { detectImage } from '@/app/api/upload/_lib/detect-image'
import { isMissingTable } from '@/lib/qbox/store'
import { parseProductsFile, serializeProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import type { CodeVersionFiles, StoreProduct } from '@/types/store-code'
import { CatalogNotSetUpError, setInventory, storeStock } from './import'
import {
  CATALOG_LIMITS, catalogProductId, checkRetailPrice, margin, sameCurrency, searchWords, suggestedPrice, toStoreProduct,
} from './model'

const BUCKET = 'store-assets'
const IMAGE_BYTES = 8 * 1024 * 1024

export interface CatalogCard {
  id: string
  name: string
  brand: string
  category: string
  image: string | null
  wholesale: number
  suggested: number
  margin: number
  currency: string
  stock: number | null
  available: boolean
  dispatchDays: number | null
  supplier: { id: string; name: string; shipsTo: string[] }
}

interface ProductRow {
  id: string
  name: string
  description: string
  brand: string
  category: string
  images: string[]
  wholesale_cents: number
  retail_cents: number | null
  currency: string
  ean: string
  sku: string
  stock: number | null
  available: boolean
  dispatch_days: number | null
  external_id: string
  supplier_id: string
  suppliers: { id: string; name: string; status: string; ships_to: string[]; dispatch_days: number } | null
}

const PRODUCT_COLUMNS = 'id, name, description, brand, category, images, wholesale_cents, retail_cents, currency, ean, sku, stock, available, dispatch_days, external_id, supplier_id, suppliers!inner(id, name, status, ships_to, dispatch_days)'

function card(r: ProductRow): CatalogCard {
  const suggested = suggestedPrice(r)
  return {
    id: r.id, name: r.name, brand: r.brand, category: r.category, image: r.images[0] ?? null,
    wholesale: r.wholesale_cents / 100, suggested, margin: Math.round(margin(suggested, r.wholesale_cents).share * 100),
    currency: r.currency, stock: r.stock, available: r.available, dispatchDays: r.dispatch_days ?? r.suppliers?.dispatch_days ?? null,
    supplier: { id: r.supplier_id, name: r.suppliers?.name ?? '', shipsTo: r.suppliers?.ships_to ?? [] },
  }
}

export interface CatalogQuery {
  q?: string | null
  supplier?: string | null
  brand?: string | null
  inStock?: boolean
  currency?: string | null
  page?: number
}

export async function searchCatalog(query: CatalogQuery): Promise<{ items: CatalogCard[]; total: number; page: number; suppliers: Array<{ id: string; name: string; products: number }> }> {
  const page = Math.max(0, Math.min(CATALOG_LIMITS.maxPage, Math.floor(query.page ?? 0)))
  let req = supabaseAdmin
    .from('supplier_products')
    .select(PRODUCT_COLUMNS, { count: 'estimated' })
    .eq('suppliers.status', 'active')
  for (const w of searchWords(query.q)) req = req.ilike('search_text', `%${w}%`)
  if (query.supplier && /^[0-9a-f-]{36}$/i.test(query.supplier)) req = req.eq('supplier_id', query.supplier)
  if (query.brand) req = req.eq('brand', query.brand.slice(0, 120))
  if (query.inStock) req = req.eq('available', true)
  if (query.currency && /^[A-Za-z]{3}$/.test(query.currency)) req = req.eq('currency', query.currency.toUpperCase())
  const [{ data, error, count }, sup] = await Promise.all([
    req.order('available', { ascending: false }).order('name').range(page * CATALOG_LIMITS.pageSize, page * CATALOG_LIMITS.pageSize + CATALOG_LIMITS.pageSize - 1),
    supabaseAdmin.from('suppliers').select('id, name, product_count').eq('status', 'active').order('name'),
  ])
  if (isMissingTable(error) || isMissingTable(sup.error)) throw new CatalogNotSetUpError()
  if (error) throw new Error(error.message)
  return {
    items: ((data ?? []) as unknown as ProductRow[]).map(card),
    total: count ?? 0,
    page,
    suppliers: (sup.data ?? []).map((s) => ({ id: s.id as string, name: s.name as string, products: (s.product_count as number) ?? 0 })),
  }
}

export async function catalogProduct(id: string): Promise<(CatalogCard & { description: string; images: string[] }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await supabaseAdmin.from('supplier_products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle()
  if (isMissingTable(error)) throw new CatalogNotSetUpError()
  if (!data) return null
  const r = data as unknown as ProductRow
  return { ...card(r), description: r.description, images: r.images }
}

/** Copies up to 5 of the supplier's photos into <userId>/<projectId>/catalog-… ; what can't be copied is skipped. */
async function copyImages(userId: string, projectId: string, productId: string, urls: string[]): Promise<string[]> {
  const out: string[] = []
  for (const [n, src] of urls.slice(0, 5).entries()) {
    try {
      const res = await scanFetch(src, { maxBytes: IMAGE_BYTES, timeoutMs: 12_000, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' })
      if (res.status !== 200) continue
      const type = detectImage(res.body)
      if (!type) continue
      const path = `${userId}/${projectId}/catalog-${productId}-${n + 1}.${type.ext}`
      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, res.body, { contentType: type.contentType, upsert: true })
      if (error) continue
      out.push(supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch {
      // unreachable / too large / not an image — skipped
    }
  }
  return out
}

export type AddResult =
  | { ok: true; product: StoreProduct; versionId: string; versionNo: number }
  | { ok: false; status: number; error: string }

export async function addToStore(userId: string, projectId: string, supplierProductId: string, priceInput: unknown): Promise<AddResult> {
  const { data: raw, error: readErr } = await supabaseAdmin.from('supplier_products').select(PRODUCT_COLUMNS).eq('id', supplierProductId).maybeSingle()
  if (isMissingTable(readErr)) throw new CatalogNotSetUpError()
  const row = raw as unknown as ProductRow | null
  if (!row || row.suppliers?.status !== 'active') return { ok: false, status: 404, error: 'This product is no longer in the catalog.' }
  if (!row.available) return { ok: false, status: 409, error: 'The supplier has this product out of stock.' }

  const price = checkRetailPrice(priceInput, row.wholesale_cents)
  if (!price.ok) return { ok: false, status: 400, error: price.error }

  const { data: version } = await supabaseAdmin
    .from('code_versions')
    .select('id, version_no, files')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version) return { ok: false, status: 404, error: 'Generate the store first.' }
  const files = { ...(version.files as CodeVersionFiles) }
  const products = files[PRODUCTS_FILE] ? parseProductsFile(files[PRODUCTS_FILE]) : []
  if (!products) return { ok: false, status: 409, error: "This store's product file can't be edited directly." }
  if (products.length >= 200) return { ok: false, status: 409, error: 'The store already has 200 products.' }

  const currency = (files['data/config.ts'] ?? '').match(/currency:\s*['"]([A-Za-z]{3})['"]/)?.[1] ?? null
  if (!sameCurrency(currency, row.currency)) {
    return { ok: false, status: 409, error: `This supplier sells in ${row.currency}; your store uses ${currency ?? 'another currency'}.` }
  }

  const productId = catalogProductId(row.id)
  if (products.some((p) => p.id === productId)) return { ok: false, status: 409, error: 'This product is already in your store.' }

  const images = await copyImages(userId, projectId, productId, row.images)
  const product = toStoreProduct(row, price.price, images, products) as StoreProduct
  files[PRODUCTS_FILE] = serializeProductsFile([...products, product])

  const { data: newVersion, error } = await supabaseAdmin
    .from('code_versions')
    .insert({ project_id: projectId, user_id: userId, version_no: (version.version_no ?? 0) + 1, files, prompt: `Catalog: added ${row.name.slice(0, 80)}` })
    .select('id, version_no')
    .single()
  if (error || !newVersion) return { ok: false, status: 500, error: 'Could not save the product.' }

  const { error: linkErr } = await supabaseAdmin.from('store_supplier_links').upsert({
    project_id: projectId, user_id: userId, product_id: productId, supplier_id: row.supplier_id,
    supplier_product_id: row.id, wholesale_cents: row.wholesale_cents, price_alert: false,
  }, { onConflict: 'project_id,product_id' })
  if (linkErr) console.error('[catalog] link save failed:', linkErr.message)
  await setInventory(projectId, productId, storeStock(row))
  await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

  return { ok: true, product, versionId: newVersion.id as string, versionNo: newVersion.version_no as number }
}

export interface StoreLink {
  productId: string
  supplierProductId: string
  supplier: string
  wholesale: number
  wholesaleNow: number
  priceAlert: boolean
  available: boolean
  stock: number | null
}

/** The store's catalog products (for the Studio: which product comes from which supplier, price alerts). */
export async function storeLinks(projectId: string): Promise<StoreLink[]> {
  const { data, error } = await supabaseAdmin
    .from('store_supplier_links')
    .select('product_id, supplier_product_id, wholesale_cents, price_alert, suppliers(name), supplier_products(wholesale_cents, available, stock)')
    .eq('project_id', projectId)
    .limit(500)
  if (isMissingTable(error)) throw new CatalogNotSetUpError()
  if (error) throw new Error(error.message)
  type Row = { product_id: string; supplier_product_id: string; wholesale_cents: number; price_alert: boolean; suppliers: { name: string } | null; supplier_products: { wholesale_cents: number; available: boolean; stock: number | null } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    productId: r.product_id, supplierProductId: r.supplier_product_id, supplier: r.suppliers?.name ?? '',
    wholesale: r.wholesale_cents / 100, wholesaleNow: (r.supplier_products?.wholesale_cents ?? r.wholesale_cents) / 100,
    priceAlert: r.price_alert, available: r.supplier_products?.available ?? false, stock: r.supplier_products?.stock ?? null,
  }))
}

/** The merchant has seen the new wholesale price: it becomes the reference, the alert goes away. */
export async function acknowledgePrice(projectId: string, productId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('store_supplier_links')
    .select('id, supplier_products(wholesale_cents)')
    .eq('project_id', projectId).eq('product_id', productId).maybeSingle()
  const now = (data as unknown as { id: string; supplier_products: { wholesale_cents: number } | null } | null)
  if (!now?.supplier_products) return false
  await supabaseAdmin.from('store_supplier_links').update({ wholesale_cents: now.supplier_products.wholesale_cents, price_alert: false }).eq('id', now.id)
  return true
}
