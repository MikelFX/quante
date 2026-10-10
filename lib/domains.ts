// Which host serves what (docs/domain-cutover.md). One deployment answers on both hosts:
//   - the AssetraDigital website (route group app/(site), Czech) on SITE_ORIGIN,
//   - the Quante app on APP_ORIGIN — Clerk's production instance, the Studio's store previews
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
  '/quante',
  '/quante/:path*',
  '/obchodni-podminky',
  '/ochrana-osobnich-udaju',
  '/vzorova-smlouva',
  '/design',
  '/og',
] as const

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
  '/changelog/:path*',
  '/terms',
  '/privacy',
  '/cookies',
  '/refund',
  '/invoice/:path*',
  '/preview/:path*',
] as const

/** True for a website page (SITE_PATHS). proxy.ts skips Clerk on these: no session lookup, no handshake. */
export function isSitePath(pathname: string): boolean {
  return SITE_PATHS.some((p) =>
    p.endsWith('/:path*') ? pathname.startsWith(p.slice(0, -'/:path*'.length) + '/') : pathname === p,
  )
}

/**
 * Production builds link across hosts with absolute URLs (no redirect hop, no cross-origin
 * prefetch). Previews and local dev serve both surfaces on one host, so links stay relative there —
 * and if the Vercel variable were ever missing, a relative link still lands through the redirect.
 */
const crossHost = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'

/** A link from an app page to the website, e.g. siteHref('/quante#cenik'). */
export function siteHref(path: string): string {
  return crossHost ? SITE_ORIGIN + path : path
}

/** A link from the website into the app, e.g. appHref('/dashboard'). */
export function appHref(path: string): string {
  return crossHost ? APP_ORIGIN + path : path
}

/** Which surface a request host belongs to: the website, the app, or neither (previews, localhost). */
export function hostKind(host: string | null | undefined): 'site' | 'app' | 'shared' {
  const h = (host ?? '').toLowerCase().replace(/:\d+$/, '')
  if (new RegExp(`^${SITE_HOST_PATTERN}$`).test(h)) return 'site'
  if (new RegExp(`^${APP_HOST_PATTERN}$`).test(h)) return 'app'
  return 'shared'
}
