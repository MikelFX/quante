// Grideet phase 3 (2026-10-29): live numbers per store — pure. Only what Quante really records:
// orders and money from store_orders, the newest build from deployments. Ad performance is not
// here on purpose: qads_metrics has no writer yet (no channel sync), so there is nothing true to
// show. Rows come from lib/grideet/load.ts for the current page's stores only.

import type { BrandGroup, GridAction } from '@/lib/grideet/model'

export const LIVE_DAYS = 30

export interface OrderRow {
  project_id: string
  status: string | null
  payment_status: string | null
  payment_method?: string | null
  total_cents: number | null
  currency: string | null
  created_at: string
}

export interface BuildRow { project_id: string; status: string | null; created_at: string }

export interface MoneySum { currency: string; cents: number }

export interface LiveStats {
  /** Paid orders created in the last LIVE_DAYS days (sandbox payments never count). */
  paidOrders: number
  /** Their totals, one entry per currency (largest first). */
  revenue: MoneySum[]
  /** Orders waiting to be shipped: paid online, or cash on delivery not yet sent. */
  toShip: number
  lastOrderAt: string | null
  /** The newest build of the store failed / is running. */
  build: 'failed' | 'running' | null
}

/** An order the merchant still has to send (the transitions in app/api/store/orders/[orderId]). */
export function needsShipping(o: Pick<OrderRow, 'status' | 'payment_status' | 'payment_method'>): boolean {
  if (o.status === 'paid') return o.payment_status === 'paid'
  return o.status === 'pending' && o.payment_method === 'dobirka'
}

export function liveStats(projectId: string, orders: OrderRow[], builds: BuildRow[], now = Date.now()): LiveStats {
  const since = now - LIVE_DAYS * 86_400_000
  const mine = orders.filter((o) => o.project_id === projectId)
  const sums = new Map<string, number>()
  let paidOrders = 0
  let toShip = 0
  let lastOrderAt: string | null = null
  for (const o of mine) {
    if (needsShipping(o)) toShip++
    // A real order (not a sandbox test, not cancelled) counts as the store's last activity.
    if (o.payment_status !== 'test_paid' && o.status !== 'cancelled' && (!lastOrderAt || o.created_at > lastOrderAt)) lastOrderAt = o.created_at
    const t = Date.parse(o.created_at)
    if (o.payment_status !== 'paid' || !Number.isFinite(t) || t < since) continue
    paidOrders++
    const cur = (o.currency || 'czk').toUpperCase()
    sums.set(cur, (sums.get(cur) ?? 0) + (Number.isFinite(o.total_cents) ? Number(o.total_cents) : 0))
  }
  const newest = builds.filter((b) => b.project_id === projectId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const build = newest?.status === 'error' ? 'failed' : newest && ['building', 'queued'].includes(newest.status ?? '') ? 'running' : null
  return {
    paidOrders,
    revenue: [...sums].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => b.cents - a.cents),
    toShip,
    lastOrderAt,
    build,
  }
}

export function hasLiveNews(s: LiveStats | undefined): boolean {
  return !!s && (s.paidOrders > 0 || s.toShip > 0 || s.build !== null)
}

// ─── Phase 4: recommendations — rules in code, never a model ───────────────────────────────

export interface Tip {
  id: 'build' | 'ship' | 'publish' | 'qgent' | 'ads'
  /** act = something is waiting on the owner; idea = a suggestion. */
  level: 'act' | 'idea'
  text: string
  action: GridAction
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What a store's owner could do next, from facts already on the card: a failed build, orders to
 * ship, unpublished changes, Qgent findings waiting, products without an ad (no Qads generation
 * for this store with that product name). Every action leads into an existing flow.
 */
export function brandTips(g: BrandGroup, adProductNames: string[]): Tip[] {
  if (!g.id) return []
  const id = g.id
  const studio = (tab: string) => `/project/${id}?tab=${tab}`
  const tips: Tip[] = []
  const live = g.meta.live
  if (live?.build === 'failed') {
    tips.push({ id: 'build', level: 'act', text: 'The last build failed — shoppers still see the previous version.', action: { label: 'Open in Studio', type: 'link', href: studio('publish') } })
  }
  if (live && live.toShip > 0) {
    tips.push({ id: 'ship', level: 'act', text: `${plural(live.toShip, 'order is', 'orders are')} waiting to be shipped.`, action: { label: 'View orders', type: 'link', href: studio('orders') } })
  }
  if (g.meta.state === 'changes') {
    tips.push({ id: 'publish', level: 'act', text: 'You have unpublished changes — shoppers don’t see them yet.', action: { label: 'Review and publish', type: 'link', href: studio('publish') } })
  }
  const waiting = g.items.filter((i) => i.module === 'qgent' && i.status === 'open').length
  if (waiting > 0) {
    tips.push({ id: 'qgent', level: 'act', text: `Qgent found ${plural(waiting, 'thing', 'things')} waiting for your decision.`, action: { label: 'Open Qgent', type: 'link', href: studio('qgent') } })
  }
  const advertised = new Set(adProductNames.map(norm))
  const noAd = g.items.filter((i) => i.kind === 'product' && !advertised.has(norm(i.title)))
  if (noAd.length > 0) {
    const first = noAd[0]
    tips.push({
      id: 'ads',
      level: 'idea',
      text: noAd.length === 1 ? `“${first.title}” has no ad yet.` : `${noAd.length} products have no ad yet, for example “${first.title}”.`,
      action: { ...first.primaryAction, label: 'Make an ad' },
    })
  }
  return tips
}
