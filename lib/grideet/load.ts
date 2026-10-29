// Grideet loader (CLAUDE.md §13h). Server-only. Reads everything the signed-in user owns from the
// existing tables — every query filtered by user_id (or by project ids that already passed that
// filter) because the service-role client bypasses RLS — and hands the rows to the pure model
// (lib/grideet/model.ts). Nothing is written and nothing is computed that the tables don't say.
//
// Scale (Agency accounts with hundreds of stores): the light columns of every source are read once
// with caps, grouped, filtered and paged; the heavy parts (store preview = theme + products from the
// latest code version, signed media URLs) are read only for the brands on the current page.
// A table that doesn't exist yet (migration not run) is skipped — the rest still loads.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { pickLiveDeployment, type RolloutDeploymentRow } from '@/lib/hosting/scaffold-rollout-rules'
import { parseConfigFile } from '@/lib/store-config'
import { readTheme } from '@/lib/store-theme'
import { parseProductsFile } from '@/lib/store-products'
import { THEME_COLOR_RE } from '@/lib/store-theme-shared'
import { EMPTY_KIT } from '@/lib/brand-kit/model'
import { getBrandKits } from '@/lib/brand-kit/store'
import { LIVE_DAYS, brandTips, liveStats, type BuildRow, type OrderRow } from '@/lib/grideet/live'
import {
  applyFilters, exportItems, groupByBrand, jobItems, paginate, productItems, qadsItems, qgentItems, qscanItems, storeState,
  type BrandGroup, type BrandMeta, type BrandRow, type BrandTheme, type ExportRow, type GrideetFilters, type GridItem, type JobRow,
  type ProductRow, type QadsGenerationRow, type QadsItemRow, type QgentActionRow, type QscanRow,
} from '@/lib/grideet/model'

/** Read caps per source (newest first). A source that hits its cap is reported in `capped`. */
export const CAPS = {
  projects: 2000,
  deployments: 4000,
  codeVersions: 4000,
  qadsGenerations: 300,
  qadsItems: 600,
  qscan: 200,
  qgent: 400,
  exports: 300,
  jobs: 50,
  domains: 500,
  productsPerStore: 24,
} as const

/** Signed URLs of private media live this long (seconds). */
export const MEDIA_URL_TTL_S = 3600

export interface GrideetData {
  groups: BrandGroup[]
  page: number
  pages: number
  /** Brands after filtering (all pages). */
  total: number
  /** Groups before filtering (stores + Unassigned) — 0 = a new account (the empty state). */
  brandCount: number
  /** Active (not archived) stores. */
  storeCount: number
  itemCount: number
  /** Sources that hit their read cap (their counts are lower bounds). */
  capped: string[]
  /** Sources that could not be read (missing table / column, lookup error). */
  skipped: string[]
  /** Every active store (id + name): where Unassigned work can be assigned. */
  stores: Array<{ id: string; name: string }>
  /** brand_kits exists (supabase/migration-brand-kit.sql has run). */
  brandKitReady: boolean
}

type Rows<T> = { rows: T[]; ok: boolean; capped: boolean }
interface PgError { code?: string; message?: string }

/** Runs one query; a failure (e.g. a table from a migration that hasn't run) yields no rows. */
async function read<T>(name: string, cap: number, q: PromiseLike<{ data: unknown; error: PgError | null }>, skipped: string[]): Promise<Rows<T>> {
  try {
    const { data, error } = await q
    if (error) {
      console.warn(`[grideet] ${name} skipped:`, error.message)
      skipped.push(name)
      return { rows: [], ok: false, capped: false }
    }
    const rows = (data as T[] | null) ?? []
    return { rows, ok: true, capped: rows.length >= cap }
  } catch (err) {
    console.warn(`[grideet] ${name} failed:`, err instanceof Error ? err.message : err)
    skipped.push(name)
    return { rows: [], ok: false, capped: false }
  }
}

const isMissingColumn = (e: PgError | null | undefined, col: string) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || new RegExp(col).test(e.message ?? ''))

const httpUrl = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\//i.test(u) && u.length <= 2048 ? u : null)
const color = (c: unknown): string | undefined => (typeof c === 'string' && THEME_COLOR_RE.test(c.trim()) ? c.trim() : undefined)

interface DeploymentRow extends RolloutDeploymentRow { project_id: string }
interface ProjectRow { id: string; name: string; status: string; updated_at: string; created_at: string; store_slug?: string | null; custom_domain?: string | null; custom_domain_verified?: boolean | null }

export async function loadGrideet(userId: string, filters: GrideetFilters & { page?: number }): Promise<GrideetData> {
  const skipped: string[] = []
  const capped: string[] = []
  const db = supabaseAdmin

  // ── 1. Light rows of every source, in parallel ──────────────────────────────────────────
  const qadsGens = async (): Promise<Rows<QadsGenerationRow>> => {
    const cols = 'id, project_id, product_name, status, created_at, completed_at'
    const q = (c: string) => db.from('qads_generations').select(c).eq('user_id', userId).order('created_at', { ascending: false }).limit(CAPS.qadsGenerations)
    const first = await q(cols + ', share_community')
    if (first.error && isMissingColumn(first.error, 'share_community')) return read('qads_generations', CAPS.qadsGenerations, q(cols), skipped)
    return read('qads_generations', CAPS.qadsGenerations, Promise.resolve(first), skipped)
  }
  const scans = async (): Promise<Rows<QscanRow>> => {
    const cols = 'id, url, status, created_at, summary'
    const q = (c: string) => db.from('qscan_scans').select(c).eq('user_id', userId).order('created_at', { ascending: false }).limit(CAPS.qscan)
    const first = await q(cols + ', project_id')
    // Without migration-grideet.sql there is no project_id: every scan is unassigned.
    if (first.error && isMissingColumn(first.error, 'project_id')) return read('qscan_scans', CAPS.qscan, q(cols), skipped)
    return read('qscan_scans', CAPS.qscan, Promise.resolve(first), skipped)
  }

  const [projects, deployments, versions, gens, qItems, qscan, qgent, exportsRes, jobs, domains, hosting] = await Promise.all([
    read<ProjectRow>('projects', CAPS.projects,
      db.from('projects').select('id, name, status, updated_at, created_at, store_slug, custom_domain, custom_domain_verified')
        .eq('user_id', userId).neq('status', 'archived').order('updated_at', { ascending: false }).limit(CAPS.projects), skipped),
    read<DeploymentRow>('deployments', CAPS.deployments,
      db.from('deployments').select('id, project_id, status, created_at, code_version_id, domain, url, target, promoted_at')
        .eq('user_id', userId).eq('status', 'ready').order('created_at', { ascending: false }).limit(CAPS.deployments), skipped),
    read<{ id: string; project_id: string; created_at: string }>('code_versions', CAPS.codeVersions,
      db.from('code_versions').select('id, project_id, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(CAPS.codeVersions), skipped),
    qadsGens(),
    read<QadsItemRow>('qads_items', CAPS.qadsItems,
      db.from('qads_items').select('id, generation_id, kind, format, status, created_at, completed_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(CAPS.qadsItems), skipped),
    scans(),
    read<QgentActionRow>('qgent_actions', CAPS.qgent,
      db.from('qgent_actions').select('id, project_id, title, area, status, created_at, updated_at')
        .eq('user_id', userId).in('status', ['proposed', 'advice', 'applied', 'reverted', 'failed'])
        .order('updated_at', { ascending: false }).limit(CAPS.qgent), skipped),
    // exports has no user_id: only rows of this user's projects (inner join on projects.user_id).
    read<ExportRow & { projects?: unknown }>('exports', CAPS.exports,
      db.from('exports').select('id, project_id, created_at, size_bytes, projects!inner(user_id)')
        .eq('projects.user_id', userId).order('created_at', { ascending: false }).limit(CAPS.exports), skipped),
    read<JobRow>('generation_jobs', CAPS.jobs,
      db.from('generation_jobs').select('id, project_id, project_name, status, created_at, batch_id')
        .eq('user_id', userId).in('status', ['running', 'queued']).order('created_at', { ascending: false }).limit(CAPS.jobs), skipped),
    read<{ project_id: string | null; domain: string }>('user_domains', CAPS.domains,
      db.from('user_domains').select('project_id, domain').eq('user_id', userId).eq('status', 'active').limit(CAPS.domains), skipped),
    read<{ project_id: string }>('hosting_subscriptions', CAPS.projects,
      db.from('hosting_subscriptions').select('project_id').eq('user_id', userId).in('status', ['active', 'trialing']).limit(CAPS.projects), skipped),
  ])
  for (const [name, r] of [['projects', projects], ['qads', qItems], ['qads', gens], ['qscan', qscan], ['qgent', qgent], ['exports', exportsRes]] as const) {
    if (r.capped && !capped.includes(name)) capped.push(name)
  }

  // ── 2. Brand state for every store (cheap: from the light rows) ──────────────────────────
  const owned = new Set(projects.rows.map((p) => p.id))
  const depsBy = new Map<string, DeploymentRow[]>()
  for (const d of deployments.rows) if (owned.has(d.project_id)) depsBy.set(d.project_id, [...(depsBy.get(d.project_id) ?? []), d])
  const latestVersion = new Map<string, string>()
  for (const v of versions.rows) if (!latestVersion.has(v.project_id)) latestVersion.set(v.project_id, v.id)
  const domainBy = new Map<string, string>()
  for (const d of domains.rows) if (d.project_id && !domainBy.has(d.project_id)) domainBy.set(d.project_id, d.domain)
  const hosted = new Set(hosting.rows.map((h) => h.project_id))

  const meta = new Map<string, BrandMeta>()
  for (const p of projects.rows) {
    const live = pickLiveDeployment(depsBy.get(p.id) ?? [])
    const state = storeState(p.status, live ? { codeVersionId: live.code_version_id } : null, latestVersion.get(p.id) ?? null)
    const domain = domainBy.get(p.id)
      ?? (p.custom_domain && p.custom_domain_verified ? p.custom_domain : null)
      ?? (live && p.store_slug ? `${p.store_slug}.${HOSTING_ROOT_DOMAIN}` : null)
    meta.set(p.id, { state, domain, hosting: hosted.has(p.id) })
  }

  // ── 3. Items without media, grouped, filtered, paged ────────────────────────────────────
  const brands: BrandRow[] = projects.rows.map((p) => ({ id: p.id, name: p.name, status: p.status, updatedAt: p.updated_at, createdAt: p.created_at }))
  const items: GridItem[] = [
    ...qadsItems(gens.rows, qItems.rows),
    ...qscanItems(qscan.rows),
    ...qgentItems(qgent.rows.filter((r) => owned.has(r.project_id))),
    ...exportItems(exportsRes.rows.filter((r) => owned.has(r.project_id))),
    ...jobItems(jobs.rows),
  ]

  // ── 4. The current page: store previews + products, then signed media URLs ──────────────
  const pageBrandIds = (groups: BrandGroup[]) => groups.map((g) => g.id).filter((id): id is string => !!id)
  // Products exist only for the page's stores, so "products" picks the page from all stores first.
  const firstFilters: GrideetFilters = filters.kind === 'product' ? { ...filters, kind: 'store' } : filters
  const allGroups = groupByBrand(brands, items, meta)
  const firstPass = paginate(applyFilters(allGroups, firstFilters), filters.page ?? 1)
  const [previews, kitRead] = await Promise.all([
    loadPreviews(pageBrandIds(firstPass.items), latestVersion, skipped),
    getBrandKits(pageBrandIds(firstPass.items), userId),
  ])
  if (kitRead.ready) for (const id of pageBrandIds(firstPass.items)) meta.set(id, { ...meta.get(id), kit: kitRead.kits.get(id) ?? EMPTY_KIT })
  // Live numbers for the page's stores (phase 3): orders + money, the newest build.
  const live = await loadLive(pageBrandIds(firstPass.items), userId, skipped)
  for (const id of pageBrandIds(firstPass.items)) meta.set(id, { ...meta.get(id), live: liveStats(id, live.orders, live.builds) })
  const pageProducts: GridItem[] = []
  for (const [id, pv] of previews) {
    meta.set(id, { ...meta.get(id), theme: pv.theme })
    const brand = projects.rows.find((p) => p.id === id)
    pageProducts.push(...productItems(id, pv.products, brand?.updated_at ?? '', pv.language))
  }

  const mediaRows = new Set(firstPass.items.flatMap((g) => g.items).filter((it) => it.module === 'qads').map((it) => it.id.slice('qads:'.length)))
  const urls = await signQadsMedia(qItems.rows.filter((r) => mediaRows.has(r.id)), userId)
  const finalItems = [...qadsItems(gens.rows, qItems.rows, urls), ...items.filter((it) => it.module !== 'qads'), ...pageProducts]

  // The page's brands again, now with their products and media. Paging stays as decided above.
  const pageIds = new Set(firstPass.items.map((g) => g.id))
  const adNames = new Map<string, string[]>()
  for (const g of gens.rows) if (g.project_id) adNames.set(g.project_id, [...(adNames.get(g.project_id) ?? []), g.product_name])
  // Recommendations (phase 4) see the brand's full item list, before the filters narrow it.
  const tipsBy = new Map(groupByBrand(brands, finalItems, meta).filter((g) => g.id && pageIds.has(g.id)).map((g) => [g.id as string, brandTips(g, adNames.get(g.id as string) ?? [])]))
  const groups = applyFilters(groupByBrand(brands, finalItems, meta), filters).filter((g) => pageIds.has(g.id))
    .map((g) => (g.id && tipsBy.has(g.id) ? { ...g, meta: { ...g.meta, tips: tipsBy.get(g.id) } } : g))
  return {
    groups,
    page: firstPass.page,
    pages: firstPass.pages,
    total: firstPass.total,
    brandCount: allGroups.length,
    storeCount: projects.rows.length,
    itemCount: items.length,
    capped,
    skipped: [...new Set(skipped)],
    stores: projects.rows.map((p) => ({ id: p.id, name: p.name || 'Untitled store' })),
    brandKitReady: kitRead.ready,
  }
}

const ORDER_CAP = 5000

/** Orders of the last LIVE_DAYS days plus every order still waiting to ship, and recent builds —
 *  for owned projects only (the ids come from the user's own projects query). */
async function loadLive(ids: string[], userId: string, skipped: string[]): Promise<{ orders: OrderRow[]; builds: BuildRow[] }> {
  if (ids.length === 0) return { orders: [], builds: [] }
  const since = new Date(Date.now() - LIVE_DAYS * 86_400_000).toISOString()
  const cols = 'id, project_id, status, payment_status, payment_method, total_cents, currency, created_at'
  const [recent, open, builds] = await Promise.all([
    read<OrderRow & { id: string }>('store_orders', ORDER_CAP,
      supabaseAdmin.from('store_orders').select(cols).in('project_id', ids).gte('created_at', since).limit(ORDER_CAP), skipped),
    read<OrderRow & { id: string }>('store_orders', ORDER_CAP,
      supabaseAdmin.from('store_orders').select(cols).in('project_id', ids).in('status', ['paid', 'pending']).limit(ORDER_CAP), skipped),
    read<BuildRow>('deployments', ids.length * 10,
      supabaseAdmin.from('deployments').select('project_id, status, created_at').eq('user_id', userId).in('project_id', ids)
        .order('created_at', { ascending: false }).limit(ids.length * 10), skipped),
  ])
  const byId = new Map<string, OrderRow>()
  for (const o of [...recent.rows, ...open.rows]) byId.set(o.id, o)
  return { orders: [...byId.values()], builds: builds.rows }
}

interface Preview { theme: BrandTheme | null; products: ProductRow[]; language: string | null }

/**
 * The store's look and catalog for the card: config.design colors + logo and data/products.ts of
 * the latest code version — only those two files (JSON path select, never the whole `files`
 * column) — or the latest manifest's palette and catalog for an older manifest store.
 */
async function loadPreviews(ids: string[], latestVersion: Map<string, string>, skipped: string[]): Promise<Map<string, Preview>> {
  const out = new Map<string, Preview>()
  if (!ids.length) return out
  const codeIds = ids.filter((id) => latestVersion.has(id))
  const manifestIds = ids.filter((id) => !latestVersion.has(id))

  await Promise.all(codeIds.map(async (projectId) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('code_versions')
        .select('config:files->>"data/config.ts", products:files->>"data/products.ts"')
        .eq('id', latestVersion.get(projectId)!)
        .eq('project_id', projectId)
        .maybeSingle()
      if (error || !data) return
      const row = data as unknown as { config: string | null; products: string | null }
      const cfg = row.config ? parseConfigFile(row.config) : null
      const theme = cfg?.design?.colors
        ? cfg.design.colors
        : row.config ? readTheme(row.config)?.colors ?? null : null
      const products = row.products ? parseProductsFile(row.products) ?? [] : []
      out.set(projectId, {
        theme: theme || cfg?.brand?.logoUrl || products.length ? {
          bg: color(theme?.bg), surface: color(theme?.surface), text: color(theme?.text), accent: color(theme?.accent), accentText: color(theme?.accentText),
          image: httpUrl(cfg?.brand?.logoUrl) ?? undefined,
        } : null,
        products: products.slice(0, CAPS.productsPerStore).map((p) => ({ id: String(p.id), name: p.name, description: p.description, image: httpUrl(p.images?.[0]) })),
        language: cfg?.brand?.language ?? null,
      })
    } catch (err) {
      console.warn('[grideet] store preview failed:', err instanceof Error ? err.message : err)
    }
  }))

  if (manifestIds.length) {
    const { data, error } = await supabaseAdmin
      .from('manifest_versions')
      .select('project_id, version_no, palette:manifest->design->palette, products:manifest->catalog->products')
      .in('project_id', manifestIds)
      .order('version_no', { ascending: false })
      .limit(manifestIds.length * 20)
    if (error) skipped.push('manifest_versions')
    for (const row of (data ?? []) as Array<{ project_id: string; palette: Record<string, string> | null; products: Array<{ id: string; name: string; description?: string; images?: string[] }> | null }>) {
      if (out.has(row.project_id)) continue
      const pal = row.palette ?? {}
      const products = Array.isArray(row.products) ? row.products : []
      out.set(row.project_id, {
        theme: { bg: color(pal.bg), surface: color(pal.surface), text: color(pal.text), accent: color(pal.accent), accentText: color(pal.accentText) },
        products: products.slice(0, CAPS.productsPerStore).map((p) => ({ id: String(p.id), name: p.name, description: p.description, image: httpUrl(p.images?.[0]) })),
        language: null,
      })
    }
  }
  return out
}

/**
 * Short-lived signed URLs (private qads-outputs bucket) for finished outputs on the current page:
 * one to view, one that downloads. Rows are this user's (queried by user_id); the uploaded product
 * photos (qads_generations.input_photo_urls) are never read here.
 */
async function signQadsMedia(rows: QadsItemRow[], userId: string): Promise<Map<string, { view: string; download: string }>> {
  const out = new Map<string, { view: string; download: string }>()
  const done = rows.filter((r) => r.status === 'completed')
  if (!done.length) return out
  const { data, error } = await supabaseAdmin
    .from('qads_items')
    .select('id, storage_bucket, storage_path')
    .eq('user_id', userId)
    .in('id', done.map((r) => r.id))
    .not('storage_path', 'is', null)
  if (error || !data?.length) return out
  const byBucket = new Map<string, Array<{ id: string; path: string }>>()
  for (const r of data as Array<{ id: string; storage_bucket: string | null; storage_path: string }>) {
    const b = r.storage_bucket ?? 'qads-outputs'
    byBucket.set(b, [...(byBucket.get(b) ?? []), { id: r.id, path: r.storage_path }])
  }
  await Promise.all([...byBucket].map(async ([bucket, list]) => {
    const paths = list.map((l) => l.path)
    const [view, dl] = await Promise.all([
      supabaseAdmin.storage.from(bucket).createSignedUrls(paths, MEDIA_URL_TTL_S),
      supabaseAdmin.storage.from(bucket).createSignedUrls(paths, MEDIA_URL_TTL_S, { download: true }),
    ])
    const v = new Map((view.data ?? []).map((s) => [s.path, s.signedUrl]))
    const d = new Map((dl.data ?? []).map((s) => [s.path, s.signedUrl]))
    for (const l of list) {
      const a = v.get(l.path)
      const b = d.get(l.path)
      if (a && b) out.set(l.id, { view: a, download: b })
    }
  }))
  return out
}
