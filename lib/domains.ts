// Which host serves what (docs/domain-cutover.md). One deployment answers on both hosts:
//   - the AssetraDigital website (route group app/(site), Czech) on SITE_ORIGIN,
//   - the Quante app on APP_ORIGIN — sign-in (Clerk), the Studio's store previews
//     (FRAME_ANCESTORS), the stores' QUANTE_API_URL and every payment webhook are bound to it.
// next.config.ts sends each host's foreign paths to the other host (301). /api/* answers on both
// hosts and is never redirected: the website calls /api/leads and /api/qgent/public relatively.
// Plain data, no imports: next.config.ts and the tests read this file too.

export const SITE_ORIGIN = 'https://assetradigital.agency'
export const APP_ORIGIN = 'https://quantecode.com'

/** Host patterns for next.config.ts `has: [{ type: 'host' }]` (Next anchors them with ^…$). */
export const SITE_HOST_PATTERN = '(?:www\\.)?assetradigital\\.agency'
export const APP_HOST_PATTERN = '(?:www\\.)?quantecode\\.com'

/** Website paths: on the app host they redirect to SITE_ORIGIN. */
export const SITE_PATHS = [
  '/',
  '/web-eshop',
  '/kapsa',
  '/obchodni-podminky',
  '/ochrana-osobnich-udaju',
  '/vzorova-smlouva',
  '/design',
  '/og',
  '/og/:path*',
] as const

/**
 * Quante's product pages (app/(site)/(quante), Czech, no Clerk) live on the app host: quantecode.com/
 * is the Quante overview (next.config.ts rewrites it to /quante, and /quante there 308s to /), the
 * module pages are quantecode.com/quante/<modul>. assetradigital.agency sends them across
 * (owner 2026-11-04: quantecode.com is the domain of the Quante products only).
 */
export const QUANTE_PATHS = ['/quante', '/quante/:path*', '/en', '/en/:path*'] as const
/** The English Quante pages (owner 2026-11-07): quantecode.com/en and /en/<modul>. */
export const QUANTE_EN_PATHS = ['/en', '/en/:path*'] as const

/** App paths: on the website host they redirect to APP_ORIGIN, so Clerk only ever runs on one host. */
export const APP_PATHS = [
  '/dashboard/:path*',
  '/new/:path*',
  '/project/:path*',
  '/billing/:path*',
  '/settings/:path*',
  '/admin/:path*',
  '/marketplace/:path*',
  '/login/:path*',
  '/signup/:path*',
  '/qads/:path*',
  '/qscan/:path*',
  '/qgent/:path*',
  '/qbox/:path*',
  '/agent-shops',
  '/start/:path*',
  '/changelog/:path*',
  '/terms',
  '/privacy',
  '/cookies',
  '/refund',
  '/invoice/:path*',
  '/preview/:path*',
] as const

const matches = (paths: readonly string[], pathname: string) =>
  paths.some((p) => (p.endsWith('/:path*') ? pathname.startsWith(p.slice(0, -'/:path*'.length) + '/') : pathname === p))

/** True for a website page (SITE_PATHS). */
export function isSitePath(pathname: string): boolean {
  return matches(SITE_PATHS, pathname)
}

/** True for a Quante product page (QUANTE_PATHS). */
export function isQuantePath(pathname: string): boolean {
  return matches(QUANTE_PATHS, pathname)
}

/**
 * The language of a page, from its path alone (both hosts, previews, localhost): the website and the
 * Quante pages are Czech, /en(/…) English, the app (its own English pages) English. The root layout
 * is shared and static, so <html lang> is set from this before the first paint (LANG_SCRIPT) and the
 * same rule sends Content-Language (next.config.ts) for crawlers that do not run scripts.
 */
export function pageLang(pathname: string): 'cs' | 'en' {
  if (matches(QUANTE_EN_PATHS, pathname)) return 'en'
  return pathname === '/' || isSitePath(pathname) || isQuantePath(pathname) ? 'cs' : 'en'
}

/** Pages rendered by app/(site) — the website and the Quante product pages. proxy.ts skips Clerk on
 *  these: no session lookup, no handshake. ('/' is the website's home, or on quantecode.com the
 *  Quante overview: both are app/(site) pages.) */
export function isClerkFreePage(pathname: string): boolean {
  return isSitePath(pathname) || isQuantePath(pathname)
}

/**
 * Production builds link across hosts with absolute URLs (no redirect hop, no cross-origin
 * prefetch). Previews and local dev serve both surfaces on one host, so links stay relative there —
 * and if the Vercel variable were ever missing, a relative link still lands through the redirect.
 */
const crossHost = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'

/** A link from an app page to the website, e.g. siteHref('/web-eshop#kontakt'). */
export function siteHref(path: string): string {
  return crossHost ? SITE_ORIGIN + path : path
}

/** A link from the website into the app, e.g. appHref('/dashboard'). */
export function appHref(path: string): string {
  return crossHost ? APP_ORIGIN + path : path
}

/**
 * A link to a Quante product page from anywhere, written as its path in this repo:
 * quanteHref('/quante'), quanteHref('/quante#cenik'), quanteHref('/quante/qgent'). Production builds
 * point at the app host, where /quante is the root; previews and localhost keep the path as it is
 * (there '/' is the website's homepage).
 */
export function quanteHref(path: string): string {
  return crossHost ? APP_ORIGIN + path.replace(/^\/quante(?=$|[#?])/, '/') : path
}

/** Which surface a request host belongs to: the website, the app, or neither (previews, localhost). */
export function hostKind(host: string | null | undefined): 'site' | 'app' | 'shared' {
  const h = (host ?? '').toLowerCase().replace(/:\d+$/, '')
  if (new RegExp(`^${SITE_HOST_PATTERN}$`).test(h)) return 'site'
  if (new RegExp(`^${APP_HOST_PATTERN}$`).test(h)) return 'app'
  return 'shared'
}
