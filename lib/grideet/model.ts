// Grideet — the account's workspace (CLAUDE.md §13h). Pure model: rows from the existing tables
// (read by lib/grideet/load.ts) → one GridItem shape → grouped by brand (= project / store),
// filtered and paged. No imports and no I/O on purpose: __tests__/grideet.test.mjs loads this
// file through Node's type stripping, so keep it to erasable TS syntax.
//
// Truth from data: nothing here invents a number. A count is the number of rows we read; when a
// source hit its read cap the count is marked `capped` and the UI shows "50+".

import type { BrandKit } from '@/lib/brand-kit/model'
import type { LiveStats, Tip } from '@/lib/grideet/live'

export type ModuleId = 'store' | 'qads' | 'qscan' | 'qgent'
export type KindId = 'product' | 'video' | 'photo' | 'scan' | 'edit' | 'export' | 'build'
/** working = still running, open = waits for the owner, done, failed. */
export type ItemStatus = 'working' | 'open' | 'done' | 'failed'
/** What shoppers see: live, never published (draft), live with a newer unpublished version. */
export type StoreState = 'live' | 'draft' | 'changes' | 'generating'

export interface GridAction {
  label: string
  /** link = a plain link into an existing flow; download = a signed file URL; the rest are client
   *  helpers that call an existing API or hand-off (qadsDraft = the Qads `qads:draft:v1` draft). */
  type: 'link' | 'download' | 'qadsDraft' | 'qadsShare' | 'qgentRevert' | 'assign'
  href?: string
  /** qadsDraft: the draft handed to /qads. qadsShare: { generationId, share }. qgentRevert: { projectId, actionId }.
   *  assign (Unassigned work → a store, phase 2): { source: 'qads' | 'qscan', id, title, note }. */
  payload?: Record<string, unknown>
  /** Changes something: the UI asks first. */
  confirm?: string
}

export interface GridThumb { type: 'image' | 'video'; src: string }

export interface GridItem {
  id: string
  brandId: string | null
  module: ModuleId
  kind: KindId
  title: string
  subtitle?: string
  thumb?: GridThumb
  status: ItemStatus
  statusLabel: string
  updatedAt: string
  href: string
  primaryAction: GridAction
  actions: GridAction[]
}

export interface BrandTheme { bg?: string; surface?: string; text?: string; accent?: string; accentText?: string; image?: string }

export interface BrandRow {
  id: string
  name: string
  /** projects.status (draft / generating / ready). */
  status: string
  updatedAt: string
  createdAt?: string
}

export interface BrandMeta {
  state?: StoreState
  domain?: string | null
  hosting?: boolean
  theme?: BrandTheme | null
  /** The brand kit (lib/brand-kit), read for the current page only; undefined = not set up. */
  kit?: BrandKit
  /** Live numbers (phase 3, lib/grideet/live.ts), current page only. */
  live?: LiveStats
  /** Recommendations (phase 4, brandTips), current page only. */
  tips?: Tip[]
}

export interface BrandGroup {
  /** null = "Unassigned": work without a store (Qads without a project, a scan that built nothing yet). */
  id: string | null
  name: string
  status: string
  meta: BrandMeta
  items: GridItem[]
  /** Items per kind before any filter (the card's numbers). */
  counts: Partial<Record<KindId, number>>
  lastActivity: string
}

export interface GrideetFilters {
  q?: string
  module?: ModuleId | 'all'
  kind?: KindId | 'store' | 'all'
  status?: StoreState | ItemStatus | 'all'
}

export const UNASSIGNED_NAME = 'Unassigned'
export const PAGE_SIZE = 24

export const MODULES: ReadonlyArray<{ id: ModuleId; label: string }> = [
  { id: 'store', label: 'Store' },
  { id: 'qads', label: 'Qads' },
  { id: 'qscan', label: 'Qscan' },
  { id: 'qgent', label: 'Qgent' },
]
export const KINDS: ReadonlyArray<{ id: KindId | 'store'; label: string; plural: string }> = [
  { id: 'store', label: 'Store', plural: 'stores' },
  { id: 'product', label: 'Product', plural: 'products' },
  { id: 'video', label: 'Video', plural: 'videos' },
  { id: 'photo', label: 'Photo', plural: 'photos' },
  { id: 'scan', label: 'Scan', plural: 'scans' },
  { id: 'edit', label: 'Qgent change', plural: 'Qgent changes' },
  { id: 'export', label: 'Export', plural: 'exports' },
  { id: 'build', label: 'Building', plural: 'building' },
]
export const STATUSES: ReadonlyArray<{ id: StoreState | ItemStatus; label: string; level: 'store' | 'item' }> = [
  { id: 'live', label: 'Live', level: 'store' },
  { id: 'changes', label: 'Unpublished changes', level: 'store' },
  { id: 'draft', label: 'Not published', level: 'store' },
  { id: 'working', label: 'In progress', level: 'item' },
  { id: 'open', label: 'Waiting for you', level: 'item' },
  { id: 'failed', label: 'Failed', level: 'item' },
]
const STORE_STATES = new Set<string>(['live', 'changes', 'draft', 'generating'])

// ─── Rows → items ──────────────────────────────────────────────────────────────────────────

export interface QadsGenerationRow { id: string; project_id: string | null; product_name: string; status: string; created_at: string; completed_at?: string | null; share_community?: boolean | null }
export interface QadsItemRow { id: string; generation_id: string; kind: string; format: string; status: string; created_at: string; completed_at?: string | null }
export interface QscanRow { id: string; url: string; status: string; created_at: string; project_id?: string | null; summary?: { brand?: { name?: string | null; logo?: string | null } | null; products?: number | null } | null }
export interface QgentActionRow { id: string; project_id: string; title: string; area?: string | null; status: string; created_at: string; updated_at?: string | null }
export interface ExportRow { id: string; project_id: string; created_at: string; size_bytes?: number | null }
export interface JobRow { id: string; project_id: string | null; project_name?: string | null; status: string; created_at: string; batch_id?: string | null }
export interface ProductRow { id: string; name: string; description?: string; image?: string | null }

const studio = (projectId: string, tab?: 'qgent' | 'publish') => `/project/${projectId}${tab ? `?tab=${tab}` : ''}`
const later = (a?: string | null, b?: string | null) => ((a ?? '') > (b ?? '') ? a ?? '' : b ?? '')

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const QADS_ITEM_STATUS: Record<string, { status: ItemStatus; label: string }> = {
  queued: { status: 'working', label: 'Queued' },
  generating: { status: 'working', label: 'Rendering' },
  completed: { status: 'done', label: 'Ready' },
  failed: { status: 'failed', label: 'Failed' },
  nsfw: { status: 'failed', label: 'Blocked' },
  canceled: { status: 'failed', label: 'Canceled' },
}

/**
 * Qads outputs: one item per photo / video. `urls` holds short-lived signed URLs of finished
 * outputs (private bucket) — an item without one has no thumbnail and no download.
 */
export function qadsItems(gens: QadsGenerationRow[], rows: QadsItemRow[], urls: Map<string, { view: string; download: string }> = new Map()): GridItem[] {
  const byId = new Map(gens.map((g) => [g.id, g]))
  const out: GridItem[] = []
  for (const r of rows) {
    const g = byId.get(r.generation_id)
    if (!g) continue
    const kind: KindId = r.kind === 'video' ? 'video' : 'photo'
    const s = QADS_ITEM_STATUS[r.status] ?? { status: 'working' as ItemStatus, label: r.status }
    const url = urls.get(r.id)
    const history: GridAction = { label: 'Open in Qads history', type: 'link', href: `/qads?g=${g.id}` }
    const actions: GridAction[] = [history]
    if (s.status === 'done' && typeof g.share_community === 'boolean') {
      actions.push(g.share_community
        ? { label: 'Stop sharing in the community', type: 'qadsShare', payload: { generationId: g.id, share: false } }
        : { label: 'Share in the community', type: 'qadsShare', payload: { generationId: g.id, share: true }, confirm: 'Share the finished photos and videos of this generation on the community wall? Your uploaded product photos are never shown. You can take them down anytime.' })
    }
    if (!g.project_id) actions.push(assignAction('qads', g.id, g.product_name || 'Ad', 'Every photo and video of this generation moves with it.'))
    out.push({
      id: `qads:${r.id}`,
      brandId: g.project_id ?? null,
      module: 'qads',
      kind,
      title: g.product_name || 'Ad',
      subtitle: `${kind === 'video' ? 'Video' : 'Photo'} · ${r.format}`,
      thumb: url ? { type: kind === 'video' ? 'video' : 'image', src: url.view } : undefined,
      status: s.status,
      statusLabel: s.label,
      updatedAt: r.completed_at ?? r.created_at,
      href: history.href!,
      primaryAction: url ? { label: 'Download', type: 'download', href: url.download } : history,
      actions: url ? actions : actions.slice(1),
    })
  }
  return out
}

export function qscanItems(rows: QscanRow[]): GridItem[] {
  return rows.map((r) => {
    const host = hostOf(r.url)
    const again: GridAction = { label: 'Scan again', type: 'link', href: `/qscan?url=${encodeURIComponent(r.url)}` }
    const status: ItemStatus = r.status === 'running' ? 'working' : r.status === 'failed' ? 'failed' : 'done'
    const projectId = r.project_id ?? null
    const primary: GridAction = projectId
      ? { label: 'Open the new store', type: 'link', href: studio(projectId) }
      : status === 'done'
        ? { label: 'Build a store', type: 'link', href: again.href }
        : again
    const products = r.summary?.products
    const logo = r.summary?.brand?.logo
    return {
      id: `qscan:${r.id}`,
      brandId: projectId,
      module: 'qscan' as const,
      kind: 'scan' as const,
      title: r.summary?.brand?.name || host,
      subtitle: typeof products === 'number' ? `${host} · ${products} product${products === 1 ? '' : 's'} found` : host,
      thumb: logo ? { type: 'image' as const, src: logo } : undefined,
      status,
      statusLabel: status === 'working' ? 'Scanning' : status === 'failed' ? 'Failed' : projectId ? 'Store built' : 'Scanned',
      updatedAt: r.created_at,
      href: primary.href!,
      primaryAction: primary,
      // project_id is undefined (not null) while migration-grideet.sql hasn't run: nothing to assign to then.
      actions: [...(primary === again ? [] : [again]), ...(r.project_id === null ? [assignAction('qscan', r.id, r.summary?.brand?.name || host, 'The scan stays as it is; only where it is listed changes.')] : [])],
    }
  })
}

function assignAction(source: 'qads' | 'qscan', id: string, title: string, note: string): GridAction {
  return { label: 'Assign to a store…', type: 'assign', payload: { source, id, title, note } }
}

const QGENT_STATUS: Record<string, { status: ItemStatus; label: string }> = {
  proposed: { status: 'open', label: 'Waiting for you' },
  advice: { status: 'done', label: 'Advice' },
  applied: { status: 'done', label: 'Applied' },
  reverted: { status: 'done', label: 'Undone' },
  failed: { status: 'failed', label: 'Not applied' },
}

export function qgentItems(rows: QgentActionRow[]): GridItem[] {
  const out: GridItem[] = []
  for (const r of rows) {
    const s = QGENT_STATUS[r.status]
    if (!s) continue // rejected / stale: dismissed or outdated, nothing to do any more
    const view: GridAction = { label: 'View in the Studio', type: 'link', href: studio(r.project_id, 'qgent') }
    out.push({
      id: `qgent:${r.id}`,
      brandId: r.project_id,
      module: 'qgent',
      kind: 'edit',
      title: r.title,
      subtitle: r.area || undefined,
      status: s.status,
      statusLabel: s.label,
      updatedAt: r.updated_at ?? r.created_at,
      href: view.href!,
      primaryAction: view,
      // Undo exists only for an applied change (the API refuses it when the files changed since).
      actions: r.status === 'applied'
        ? [{ label: 'Undo this change', type: 'qgentRevert', payload: { projectId: r.project_id, actionId: r.id }, confirm: 'Undo this Qgent change? It is saved as a new draft version; shoppers see it after you Publish. Free.' }]
        : [],
    })
  }
  return out
}

export function exportItems(rows: ExportRow[]): GridItem[] {
  return rows.map((r) => {
    const again: GridAction = { label: 'Export again', type: 'link', href: studio(r.project_id, 'publish') }
    const kb = typeof r.size_bytes === 'number' && r.size_bytes > 0 ? Math.max(1, Math.round(r.size_bytes / 1024)) : null
    return {
      id: `export:${r.id}`,
      brandId: r.project_id,
      module: 'store' as const,
      kind: 'export' as const,
      title: 'Code export',
      subtitle: kb ? (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB ZIP` : `${kb} KB ZIP`) : 'ZIP',
      status: 'done' as const,
      statusLabel: 'Downloaded',
      updatedAt: r.created_at,
      href: again.href!,
      primaryAction: again,
      actions: [],
    }
  })
}

/** Generations still running (a batch store, a fresh store) — finished ones are the store itself. */
export function jobItems(rows: JobRow[]): GridItem[] {
  return rows.filter((r) => r.status === 'running' || r.status === 'queued').map((r) => {
    const view: GridAction = r.batch_id
      ? { label: 'View the batch', type: 'link', href: `/new/batch?b=${r.batch_id}` }
      : r.project_id
        ? { label: 'Open in the Studio', type: 'link', href: studio(r.project_id) }
        : { label: 'New store', type: 'link', href: '/new' }
    return {
      id: `job:${r.id}`,
      brandId: r.project_id ?? null,
      module: 'store' as const,
      kind: 'build' as const,
      title: r.project_name || 'New store',
      subtitle: r.status === 'queued' ? 'Waiting in the batch' : 'Generating',
      status: 'working' as const,
      statusLabel: r.status === 'queued' ? 'Queued' : 'Generating',
      updatedAt: r.created_at,
      href: view.href!,
      primaryAction: view,
      actions: [],
    }
  })
}

/** A store's products: "Make an ad" hands the product to Qads through its draft (no credits until Generate there). */
export function productItems(projectId: string, products: ProductRow[], updatedAt: string, language?: string | null): GridItem[] {
  return products.map((p) => ({
    id: `product:${projectId}:${p.id}`,
    brandId: projectId,
    module: 'store' as const,
    kind: 'product' as const,
    title: p.name,
    thumb: p.image ? { type: 'image' as const, src: p.image } : undefined,
    status: 'done' as const,
    statusLabel: 'In the store',
    updatedAt,
    href: studio(projectId),
    primaryAction: {
      label: 'Make an ad',
      type: 'qadsDraft' as const,
      href: '/qads',
      payload: {
        productName: p.name.slice(0, 120),
        productDescription: (p.description ?? '').slice(0, 2000),
        projectId,
        ...(language && ['cs', 'en', 'sk', 'de'].includes(language) ? { language } : {}),
      },
    },
    actions: [{ label: 'Open in the Studio', type: 'link' as const, href: studio(projectId) }],
  }))
}

// ─── Store state ───────────────────────────────────────────────────────────────────────────

/**
 * Live / draft / unpublished changes from the facts we have: the live deployment's code version
 * (lib/hosting/scaffold-rollout-rules.ts pickLiveDeployment) and the newest code version.
 * A manifest store (no code versions) is live or draft only.
 */
export function storeState(projectStatus: string, live: { codeVersionId: string | null } | null, latestCodeVersionId: string | null): StoreState {
  if (projectStatus === 'generating') return 'generating'
  if (!live) return 'draft'
  if (latestCodeVersionId && live.codeVersionId && latestCodeVersionId !== live.codeVersionId) return 'changes'
  return 'live'
}

// ─── Grouping, filters, paging ─────────────────────────────────────────────────────────────

const byUpdatedDesc = (a: GridItem, b: GridItem) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1)

/**
 * Items grouped by brand. Items whose brand is not one of `brands` (no project, or a project that
 * is archived / deleted / someone else's) go to the Unassigned group, which exists only when it
 * has items. Brands sort by their last activity (the newest of the project and its items), items
 * inside by updatedAt — both newest first.
 */
export function groupByBrand(brands: BrandRow[], items: GridItem[], meta: Map<string, BrandMeta> = new Map()): BrandGroup[] {
  const groups = new Map<string | null, BrandGroup>()
  for (const b of brands) {
    groups.set(b.id, { id: b.id, name: b.name || 'Untitled store', status: b.status, meta: meta.get(b.id) ?? {}, items: [], counts: {}, lastActivity: b.updatedAt })
  }
  for (const it of items) {
    let g = groups.get(it.brandId ?? null)
    if (!g) {
      g = groups.get(null)
      if (!g) {
        g = { id: null, name: UNASSIGNED_NAME, status: 'none', meta: {}, items: [], counts: {}, lastActivity: '' }
        groups.set(null, g)
      }
    }
    // An item that lost its brand is shown as unassigned, not under a stranger's name.
    g.items.push(g.id === it.brandId ? it : { ...it, brandId: null })
    g.counts[it.kind] = (g.counts[it.kind] ?? 0) + 1
    g.lastActivity = later(g.lastActivity, it.updatedAt)
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort(byUpdatedDesc)
  return list.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : (a.id ?? '') < (b.id ?? '') ? -1 : 1))
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Applies the filters: a brand stays when it matches and still has something to show.
 * - module / kind: only matching items; kind 'store' keeps real stores (not Unassigned).
 * - status: a store state filters brands, an item status filters items.
 * - q: a brand whose name matches keeps all its items, otherwise only items whose title / subtitle match.
 */
export function applyFilters(groups: BrandGroup[], f: GrideetFilters): BrandGroup[] {
  const mod = f.module && f.module !== 'all' ? f.module : null
  const kind = f.kind && f.kind !== 'all' ? f.kind : null
  const status = f.status && f.status !== 'all' ? f.status : null
  const q = f.q?.trim() ? norm(f.q.trim()) : null
  const itemFilter = !!(mod || (kind && kind !== 'store') || (status && !STORE_STATES.has(status)))
  const out: BrandGroup[] = []
  for (const g of groups) {
    if (kind === 'store' && g.id === null) continue
    if (status && STORE_STATES.has(status) && (g.id === null || g.meta.state !== status)) continue
    let items = g.items.filter((it) =>
      (!mod || it.module === mod) &&
      (!kind || kind === 'store' || it.kind === kind) &&
      (!status || STORE_STATES.has(status) || it.status === status))
    if (q && !norm(g.name).includes(q) && !(g.meta.domain && norm(g.meta.domain).includes(q))) {
      items = items.filter((it) => norm(it.title).includes(q) || (it.subtitle ? norm(it.subtitle).includes(q) : false))
      if (!items.length) continue
    }
    if (itemFilter && !items.length) continue
    // A store with nothing in it yet still shows (it is the brand); an empty Unassigned group never does.
    if (g.id === null && !items.length) continue
    out.push({ ...g, items })
  }
  return out
}

export function paginate<T>(list: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(list.length / size))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length }
}

/** Reads filters from URL search params (unknown values = all). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): GrideetFilters & { page: number } {
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? '' }
  const mod = MODULES.some((m) => m.id === one('module')) ? (one('module') as ModuleId) : 'all'
  const kind = KINDS.some((k) => k.id === one('kind')) ? (one('kind') as KindId | 'store') : 'all'
  const status = STATUSES.some((s) => s.id === one('status')) ? (one('status') as StoreState | ItemStatus) : 'all'
  return { q: one('q').slice(0, 100), module: mod, kind, status, page: Number.parseInt(one('page'), 10) || 1 }
}
