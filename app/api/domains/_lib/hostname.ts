// Server-only. The ONE custom-hostname validator (audit #38), shared by
// /api/domains/connect (user_domains) and /api/hosting/domain (projects.custom_domain).
//
// Every custom domain is attached to a Vercel project inside Quante's shared team, so:
//   - platform hosts must never be attachable: quantecode.com and all its subdomains,
//     *.<HOSTING_ROOT_DOMAIN> (another tenant's store subdomain), the app host, and
//     Vercel's own zones (vercel.app / vercel.com / vercel.sh / now.sh / vercel-dns.com);
//   - IP literals, single-label names, reserved/special-use TLDs and public suffixes
//     (co.uk, github.io, pages.dev, …) are refused;
//   - a name already held by ANOTHER user is refused — but only by a claim that means
//     something, so a squatter can't lock the real owner out:
//       * the exact name: held by a proven claim, or by an unproven live claim for
//         UNVERIFIED_CLAIM_TTL_MS after it was made (then it can be taken over);
//       * a parent or child of the name: held ONLY by a proven claim (DNS-verified, or
//         bought through Quante). Connecting x.bob-shop.com no longer blocks bob-shop.com.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { normalizeHostname } from '@/lib/namecheap'
import {
  type DomainRow,
  UNVERIFIED_CLAIM_TTL_MS,
  detachFromVercel,
  releaseDomainRow,
  rowHoldsExactName,
  rowProvesOwnership,
  selfAndParents,
} from './release'

const BUILTIN_BLOCKED_ZONES = [
  'quantecode.com',
  'vercel.app',
  'vercel.com',
  'vercel.sh',
  'now.sh',
  'vercel-dns.com',
]

// Special-use / non-public TLDs (RFC 6761, RFC 6762, RFC 7686, .internal).
const RESERVED_TLDS = new Set(['localhost', 'local', 'internal', 'test', 'example', 'invalid', 'onion', 'arpa', 'home', 'lan', 'corp'])

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

// Public suffixes: names under which anyone can register, so the suffix itself is
// never one person's domain. A curated subset of the Public Suffix List (ICANN
// second-level zones + common hosting platforms); the heuristic below catches the
// usual <co|com|org|…>.<ccTLD> pattern for ccTLDs not listed here.
const PUBLIC_SUFFIXES = new Set([
  // ICANN second-level zones
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk', 'nhs.uk', 'police.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'kiwi.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ad.jp', 'ed.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in',
  'com.br', 'net.br', 'org.br', 'com.cn', 'net.cn', 'org.cn', 'com.hk', 'org.hk', 'net.hk',
  'com.tw', 'org.tw', 'net.tw', 'com.sg', 'org.sg', 'net.sg', 'com.my', 'co.id', 'co.th', 'in.th',
  'com.ph', 'com.vn', 'com.mx', 'org.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy',
  'co.za', 'org.za', 'web.za', 'com.ng', 'co.ke', 'com.eg', 'co.il', 'org.il',
  'com.tr', 'org.tr', 'net.tr', 'com.ua', 'org.ua', 'net.ua', 'com.pl', 'net.pl', 'org.pl',
  'co.at', 'or.at', 'gv.at', 'co.hu', 'com.gr', 'com.cy', 'com.mt', 'com.pt', 'com.es', 'org.es', 'nom.es',
  'com.ro', 'com.hr', 'co.rs', 'co.me', 'co.ba', 'com.mk',
  // Hosting platforms / shared zones (Public Suffix List "private" section)
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'netlify.com', 'herokuapp.com',
  'herokudns.com', 'web.app', 'firebaseapp.com', 'firebaseio.com', 'appspot.com', 'azurewebsites.net',
  'azurestaticapps.net', 'cloudapp.net', 'cloudfront.net', 'amazonaws.com', 'elasticbeanstalk.com',
  'blogspot.com', 'myshopify.com', 'fly.dev', 'onrender.com', 'railway.app', 'up.railway.app', 'glitch.me',
  'repl.co', 'replit.app', 'replit.dev', 'surge.sh', 'ngrok.io', 'ngrok.app', 'ngrok.dev', 'ngrok-free.app',
  'trycloudflare.com', 'deno.dev', 'supabase.co', 'webflow.io', 'wixsite.com', 'framer.app', 'framer.website',
  'carrd.co', 'bubbleapps.io', 'lovable.app', 'stackblitz.io', 'codesandbox.io', 'csb.app', 'readthedocs.io',
  'gitbook.io', 'notion.site', 'neocities.org', 'duckdns.org', 'ddns.net', 'no-ip.org', 'dyndns.org',
  'hopto.org', 'zapto.org', 'sytes.net', 'myftp.org',
])

// <generic>.<ccTLD> second-level zones (co.xx, com.xx, …) that aren't listed above.
const GENERIC_SLDS = new Set(['co', 'com', 'net', 'org', 'ac', 'edu', 'gov', 'gob', 'go', 'or', 'ne', 'mil', 'ltd', 'plc', 'sch', 'nom'])

/** True when `host` is a public suffix (nobody can own it as a single domain). */
export function isPublicSuffix(host: string): boolean {
  if (PUBLIC_SUFFIXES.has(host)) return true
  const labels = host.split('.')
  return labels.length === 2 && labels[1]!.length === 2 && GENERIC_SLDS.has(labels[0]!)
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host && host !== 'localhost' ? host : null
  } catch {
    return null
  }
}

/** Every zone that belongs to the platform (or to Vercel) — the zone itself and all subdomains are blocked. */
export function blockedZones(): string[] {
  const zones = new Set<string>(BUILTIN_BLOCKED_ZONES)
  if (HOSTING_ROOT_DOMAIN) zones.add(HOSTING_ROOT_DOMAIN.toLowerCase().replace(/^\.+|\.+$/g, ''))
  for (const z of (process.env.PLATFORM_DOMAINS ?? '').split(',')) {
    const t = z.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
    if (t) zones.add(t)
  }
  const appHost = hostOf(process.env.NEXT_PUBLIC_APP_URL)
  if (appHost) zones.add(appHost)
  const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL)
  if (siteHost) zones.add(siteHost)
  return [...zones]
}

export function isPlatformHost(host: string): boolean {
  return blockedZones().some((zone) => host === zone || host.endsWith(`.${zone}`))
}

export type CustomHostnameResult =
  | { ok: true; host: string }
  | { ok: false; reason: 'invalid' | 'platform' }

/**
 * Normalizes user input (scheme / path / port / trailing dot stripped, lowercased) and
 * validates it as a public, non-platform hostname with at least two labels that is
 * not itself a public suffix.
 */
export function validateCustomHostname(input: unknown): CustomHostnameResult {
  const host = normalizeHostname(input)
  if (!host) return { ok: false, reason: 'invalid' }
  if (IPV4_RE.test(host) || host.includes(':')) return { ok: false, reason: 'invalid' }
  const labels = host.split('.')
  if (labels.length < 2) return { ok: false, reason: 'invalid' }
  if (RESERVED_TLDS.has(labels[labels.length - 1]!)) return { ok: false, reason: 'invalid' }
  if (isPlatformHost(host)) return { ok: false, reason: 'platform' }
  if (isPublicSuffix(host)) return { ok: false, reason: 'platform' }
  return { ok: true, host }
}

/** Another user's projects.custom_domain that no longer holds the exact name. */
export interface StaleProjectClaim {
  id: string
  custom_domain: string
  vercel_project_id: string | null
}

export type ForeignClaimCheck =
  | {
      ok: true
      /** Another user holds the name (exact), or proves a parent / child of it. */
      blocked: boolean
      /** user_domains rows (any owner) for the name itself or any of its parents. */
      heldRows: DomainRow[]
      /** Other users' rows / projects on the EXACT name that no longer hold it — release before claiming. */
      staleRows: DomainRow[]
      staleProjects: StaleProjectClaim[]
    }
  | { ok: false; error: string }

interface ProjectClaimRow {
  id: string
  custom_domain: string | null
  custom_domain_verified: boolean | null
  vercel_project_id: string | null
}

// projects.custom_domain_set_at comes from migration-security2-deploy-domains-misc.sql.
// Read separately and tolerantly: before that migration runs every age is unknown,
// and an unknown age keeps holding (fail closed).
async function customDomainSetAt(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data, error } = await supabaseAdmin.from('projects').select('id, custom_domain_set_at').in('id', ids)
  if (error) return out
  for (const r of (data ?? []) as Array<{ id: string; custom_domain_set_at: string | null }>) {
    const t = r.custom_domain_set_at ? Date.parse(r.custom_domain_set_at) : NaN
    if (Number.isFinite(t)) out.set(r.id, t)
  }
  return out
}

/**
 * Looks for claims on `host` by users other than `userId` (user_domains rows and
 * projects.custom_domain on the name, any parent or any child) and decides whether
 * they block. Fails closed: a lookup error returns ok:false and callers must refuse.
 */
export async function checkForeignClaims(host: string, userId: string): Promise<ForeignClaimCheck> {
  // Public suffixes (co.uk, github.io, …) can't be anyone's parent domain.
  const candidates = selfAndParents(host).filter((c) => c === host || !isPublicSuffix(c))
  const projectCols = 'id, custom_domain, custom_domain_verified, vercel_project_id'
  // `host` is a validated hostname ([a-z0-9.-] only), so it is safe inside LIKE.
  const [heldRes, childRes, projectRes, childProjectRes] = await Promise.all([
    supabaseAdmin.from('user_domains').select('*').in('domain', candidates),
    supabaseAdmin.from('user_domains').select('*').like('domain', `%.${host}`).neq('user_id', userId),
    supabaseAdmin.from('projects').select(projectCols).in('custom_domain', candidates).neq('user_id', userId),
    supabaseAdmin.from('projects').select(projectCols).like('custom_domain', `%.${host}`).neq('user_id', userId),
  ])
  const lookupError = heldRes.error ?? childRes.error ?? projectRes.error ?? childProjectRes.error
  if (lookupError) return { ok: false, error: lookupError.message }

  const now = Date.now()
  const heldRows = (heldRes.data ?? []) as DomainRow[]
  const childRows = (childRes.data ?? []) as DomainRow[]
  const foreignHeld = heldRows.filter((r) => r.user_id !== userId)

  const exactRows = foreignHeld.filter((r) => r.domain === host)
  const parentRows = foreignHeld.filter((r) => r.domain !== host)
  const staleRows = exactRows.filter((r) => !rowHoldsExactName(r, now))

  const projects = (projectRes.data ?? []) as ProjectClaimRow[]
  const exactProjects = projects.filter((p) => p.custom_domain === host)
  const parentProjects = projects.filter((p) => p.custom_domain !== host)
  const childProjects = (childProjectRes.data ?? []) as ProjectClaimRow[]

  const setAt = await customDomainSetAt(exactProjects.filter((p) => p.custom_domain_verified !== true).map((p) => p.id))
  const projectHoldsExact = (p: ProjectClaimRow): boolean => {
    if (p.custom_domain_verified === true) return true
    const t = setAt.get(p.id)
    return t === undefined || now - t < UNVERIFIED_CLAIM_TTL_MS
  }
  const staleProjects: StaleProjectClaim[] = exactProjects
    .filter((p) => !projectHoldsExact(p))
    .map((p) => ({ id: p.id, custom_domain: p.custom_domain as string, vercel_project_id: p.vercel_project_id }))

  const blocked =
    exactRows.some((r) => rowHoldsExactName(r, now)) ||
    parentRows.some(rowProvesOwnership) ||
    childRows.some(rowProvesOwnership) ||
    exactProjects.some(projectHoldsExact) ||
    parentProjects.some((p) => p.custom_domain_verified === true) ||
    childProjects.some((p) => p.custom_domain_verified === true)
  return { ok: true, blocked, heldRows, staleRows, staleProjects }
}

/**
 * Releases the stale foreign claims on the exact name found by checkForeignClaims
 * (detach from the other tenant's Vercel project, then drop the DB claim), so the
 * caller's claim + attach can proceed. Throws on any failure; callers must refuse.
 * Only call when `blocked` is false.
 */
export async function releaseStaleForeignClaims(
  check: Extract<ForeignClaimCheck, { ok: true }>,
): Promise<void> {
  for (const p of check.staleProjects) {
    if (p.vercel_project_id) await detachFromVercel(p.vercel_project_id, p.custom_domain)
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ custom_domain: null, custom_domain_verified: false })
      .eq('id', p.id)
      .eq('custom_domain', p.custom_domain)
      .or('custom_domain_verified.is.null,custom_domain_verified.eq.false')
    if (error) throw new Error(`projects.custom_domain clear failed: ${error.message}`)
    console.warn(`[domains] released unverified custom domain ${p.custom_domain} from project ${p.id}`)
  }
  for (const row of check.staleRows) {
    if (!(await releaseDomainRow(row))) throw new Error(`row ${row.id} changed concurrently`)
    console.warn(`[domains] released unverified claim ${row.domain} (row ${row.id})`)
  }
}
