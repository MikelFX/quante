// Qads Plan — competitor research through Meta's official Ad Library API (ads_archive). The
// API lists every ad shown in the EU (DSA transparency), so it works for any shop selling in the
// EU, without scraping. Needs META_AD_LIBRARY_TOKEN (a token of a Meta app whose owner passed the
// Ad Library identity check); without it the plan is written without competitor ads and says so.
//
// Only ad text, the advertiser's page name, start date and platforms are read. Ad snapshots are
// never fetched or stored (their URL carries our token) — the plan links to the public Ad Library
// page of the ad instead. Competitor text reaches the model quoted as data (model.ts).

export const META_GRAPH_VERSION = 'v23.0'
const ENDPOINT = `https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive`
const FIELDS = 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,publisher_platforms'

export const AD_LIBRARY_LIMITS = { perTerm: 25, perPage: 4, total: 30, timeoutMs: 12_000 } as const

export interface CompetitorAd {
  id: string
  pageName: string
  body: string
  title: string
  daysRunning: number
  platforms: string[]
  /** The ad's public Ad Library page. */
  libraryUrl: string
}

export type ResearchResult = {
  ads: CompetitorAd[]
  /** 'ok' with ads; otherwise why there are none (shown to the owner and told to the model). */
  status: 'ok' | 'no_terms' | 'not_configured' | 'nothing_found' | 'error'
}

const DAY_MS = 86_400_000

function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function libraryUrl(id: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`
}

/** One ads_archive page → our ads. Anything malformed is skipped. */
export function parseAdLibrary(json: unknown, now: Date): CompetitorAd[] {
  const data = (json && typeof json === 'object' ? (json as { data?: unknown }).data : null)
  if (!Array.isArray(data)) return []
  const out: CompetitorAd[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = typeof o.id === 'string' && /^\d{1,30}$/.test(o.id) ? o.id : null
    if (!id) continue
    const first = (v: unknown) => (Array.isArray(v) ? v.find((x) => typeof x === 'string' && x.trim()) : undefined)
    const body = text(first(o.ad_creative_bodies), 600)
    const title = text(first(o.ad_creative_link_titles), 160)
    if (!body && !title) continue
    const start = typeof o.ad_delivery_start_time === 'string' ? Date.parse(o.ad_delivery_start_time) : NaN
    out.push({
      id,
      pageName: text(o.page_name, 80) || 'Unknown advertiser',
      body,
      title,
      daysRunning: Number.isFinite(start) ? Math.max(0, Math.floor((now.getTime() - start) / DAY_MS)) : 0,
      platforms: (Array.isArray(o.publisher_platforms) ? o.publisher_platforms : [])
        .map((p) => text(p, 20).toLowerCase())
        .filter((p) => /^[a-z_]+$/.test(p))
        .slice(0, 4),
      libraryUrl: libraryUrl(id),
    })
  }
  return out
}

/** Longest-running first (long-running ads tend to be the profitable ones), duplicates and
 *  near-copies of the same text dropped, a few ads per advertiser so one brand can't fill it. */
export function rankAds(ads: CompetitorAd[]): CompetitorAd[] {
  const seen = new Set<string>()
  const perPage = new Map<string, number>()
  const out: CompetitorAd[] = []
  for (const a of [...ads].sort((x, y) => y.daysRunning - x.daysRunning || x.id.localeCompare(y.id))) {
    const key = `${a.pageName.toLowerCase()}|${(a.body || a.title).toLowerCase().slice(0, 120)}`
    if (seen.has(a.id) || seen.has(key)) continue
    const n = perPage.get(a.pageName) ?? 0
    if (n >= AD_LIBRARY_LIMITS.perPage) continue
    seen.add(a.id)
    seen.add(key)
    perPage.set(a.pageName, n + 1)
    out.push(a)
    if (out.length >= AD_LIBRARY_LIMITS.total) break
  }
  return out
}

export function adLibraryQuery(term: string, country: string, token: string): string {
  const q = new URLSearchParams({
    search_terms: term,
    search_type: 'KEYWORD_UNORDERED',
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    ad_reached_countries: JSON.stringify([country]),
    fields: FIELDS,
    limit: String(AD_LIBRARY_LIMITS.perTerm),
    access_token: token,
  })
  return `${ENDPOINT}?${q.toString()}`
}

/** Active ads for each competitor name or keyword in one market. Never throws. */
export async function researchCompetitors(
  terms: string[],
  country: string,
  opts: { token?: string | null; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<ResearchResult> {
  const byKey = new Map<string, string>()
  for (const t of terms.map((x) => text(x, 60)).filter((x) => x.length >= 2)) if (!byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t)
  const clean = [...byKey.values()].slice(0, 5)
  if (!clean.length) return { ads: [], status: 'no_terms' }
  const token = opts.token === undefined ? process.env.META_AD_LIBRARY_TOKEN : opts.token
  if (!token) return { ads: [], status: 'not_configured' }
  const doFetch = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()

  let failures = 0
  const pages = await Promise.all(clean.map(async (term) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), AD_LIBRARY_LIMITS.timeoutMs)
    try {
      const res = await doFetch(adLibraryQuery(term, country, token), { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) {
        failures++
        // The body may echo the request; log the status only (the URL carries the token).
        console.error('[qads/plan] ad library answered', res.status)
        return []
      }
      return parseAdLibrary(await res.json(), now)
    } catch {
      failures++
      return []
    } finally {
      clearTimeout(timer)
    }
  }))
  const ads = rankAds(pages.flat())
  if (ads.length) return { ads, status: 'ok' }
  return { ads: [], status: failures === clean.length ? 'error' : 'nothing_found' }
}

export const RESEARCH_NOTE: Record<ResearchResult['status'], string> = {
  ok: '',
  no_terms: 'no competitors were named',
  not_configured: 'competitor research is not connected yet',
  nothing_found: 'no active ads found for the named competitors in this market',
  error: 'the Ad Library could not be reached',
}
