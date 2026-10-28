// Where a visitor goes after signing in or up — and where a signed-in visitor who lands on /login
// or /signup is sent (proxy.ts). Right after signing in, Clerk refreshes the sign-in page before it
// navigates on, and that refresh reaches the proxy first — so the proxy must honour the redirect
// the visitor came with (e.g. /qads after "Generate"), not always send them to the dashboard. The
// sign-in / sign-up pages pass the same target to Clerk as forceRedirectUrl. Only paths inside the
// app are accepted: a foreign origin, a protocol-relative URL or another auth page falls back to
// the dashboard (no open redirect, no loop). Pure — tested in __tests__/after-sign-in.test.mjs.

const AUTH_PAGE = /^\/(login|signup)(\/|$)/
const FALLBACK = '/dashboard'
// Clerk carries the target as redirect_url, or under these names when it moves between the
// sign-in and sign-up forms.
const PARAMS = ['redirect_url', 'sign_in_force_redirect_url', 'sign_up_force_redirect_url', 'sign_in_fallback_redirect_url', 'sign_up_fallback_redirect_url']
// Stand-in origin for relative targets when the request origin isn't known (server pages).
const LOCAL = 'https://app.invalid'

/** The redirect target in a query string (URLSearchParams or a Next searchParams object). */
export function redirectParam(params: URLSearchParams | Record<string, string | string[] | undefined>): string | null {
  for (const key of PARAMS) {
    const v = params instanceof URLSearchParams ? params.get(key) : params[key]
    const s = Array.isArray(v) ? v[0] : v
    if (s) return s
  }
  return null
}

/** Path (+ query + hash) to send the visitor to, always starting with a single "/". */
export function afterSignInPath(redirectUrl: string | null | undefined, origin: string = LOCAL, appOrigins: readonly string[] = []): string {
  if (!redirectUrl) return FALLBACK
  let u: URL
  try {
    u = new URL(redirectUrl, origin)
  } catch {
    return FALLBACK
  }
  if (u.origin !== new URL(origin).origin && !appOrigins.includes(u.origin)) return FALLBACK
  if (AUTH_PAGE.test(u.pathname)) return FALLBACK
  const path = u.pathname + u.search + u.hash
  return path.startsWith('/') && !path.startsWith('//') ? path : FALLBACK
}
