import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { APP_ORIGIN, SITE_ORIGIN, isClerkFreePage } from '@/lib/domains'
import { afterSignInPath, redirectParam } from '@/lib/auth/after-sign-in'
import { hostKind } from '@/lib/domains'
import { agentPageId } from '@/lib/agents/page-ids'
import { wantsMarkdown } from '@/lib/agents/negotiate'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/new(.*)',
  '/project(.*)',
  '/billing(.*)',
  '/settings(.*)',
])

const isAuthRoute = createRouteMatcher(['/login(.*)', '/signup(.*)'])

// Endpoints that are legitimately called cross-site (signed webhooks, payment-gateway
// callbacks, crons, and the public store API the generated storefronts call). They
// authenticate by signature / token / key, never by the Clerk session cookie, so the
// Origin check below does not apply to them.
const isCrossSiteApi = createRouteMatcher([
  '/api/stripe/webhook(.*)',
  '/api/webhooks/(.*)',
  '/api/store/(.*)',
  '/api/payments/(.*)',
  '/api/cron/(.*)',
  '/api/qads/cron/(.*)',
  '/api/qbox/v1/(.*)', // Qbox API: authenticated by API key, never by the session cookie
  '/api/mcp', // site MCP server: no session, open to every agent (lib/agents/mcp.ts)
  '/api/qbox/oauth/register', // Qbox connector OAuth (lib/qbox/oauth.ts): called by MCP clients, no cookie
  '/api/qbox/oauth/token',
  '/api/agent/(.*)', // agent API (lib/agents): never the session cookie — no key, or a Qbox key
])

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * CSRF guard for cookie-authenticated API routes. Generated stores live on
 * *.stores.<platform domain>, i.e. the SAME site as the platform, so Clerk's
 * SameSite=Lax session cookie rides along on their cross-origin POSTs (text/plain
 * bodies need no CORS preflight). Reject state-changing /api requests whose Origin
 * (or Sec-Fetch-Site) says they came from anywhere but the platform itself.
 * Requests with no Origin header (server-to-server, curl) carry no browser cookies
 * worth forging and are left to the route's own auth.
 */
function isForeignOriginApiWrite(req: NextRequest): boolean {
  if (!req.nextUrl.pathname.startsWith('/api/')) return false
  if (!STATE_CHANGING.has(req.method)) return false
  if (isCrossSiteApi(req)) return false

  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true

  const origin = req.headers.get('origin')
  if (!origin) return false

  // The request's own origin plus both hosts of the domain split (lib/domains.ts).
  const allowed = new Set<string>([req.nextUrl.origin, SITE_ORIGIN, APP_ORIGIN])
  const site = originOf(process.env.NEXT_PUBLIC_APP_URL)
  if (site) allowed.add(site)
  const site2 = originOf(process.env.NEXT_PUBLIC_SITE_URL)
  if (site2) allowed.add(site2)
  return !allowed.has(origin)
}

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isForeignOriginApiWrite(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const { userId } = await auth()
  // Signed-in users hitting the login/signup pages are sent on — to the redirect_url they came
  // with (e.g. back to /qads after "Generate"), else the dashboard. Clerk refreshes the sign-in
  // page right after a sign-in, and this redirect must not swallow its redirect_url
  // (lib/auth/after-sign-in.ts).
  // Homepage + every marketing page (/qads, /pricing, /showcase, /about,
  // /domains, /contact, /terms, /privacy) stay reachable while logged in
  // so a merchant deep in the Studio can jump back to marketing / their
  // generator without having to sign out first.
  if (isAuthRoute(req) && userId) {
    const to = afterSignInPath(redirectParam(req.nextUrl.searchParams), req.nextUrl.origin, [APP_ORIGIN])
    return NextResponse.redirect(new URL(to, req.url))
  }
  if (isProtectedRoute(req)) await auth.protect()
})

function markdownRewrite(req: NextRequest): NextResponse | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null
  const path = req.nextUrl.pathname
  if (path.startsWith('/api/') || path.startsWith('/_next/')) return null
  const explicit = path.endsWith('.md') || path === '/agents'
  if (!explicit && !wantsMarkdown(req.headers.get('accept'))) return null
  if (!agentPageId(path, hostKind(req.headers.get('x-forwarded-host') ?? req.headers.get('host')))) return null
  const url = req.nextUrl.clone()
  url.pathname = '/api/agent/v1/page'
  url.search = `?path=${encodeURIComponent(path)}`
  // The path also travels as a header: a rewrite does not always hand the new query to the route.
  const headers = new Headers(req.headers)
  headers.set('x-agent-path', path)
  return NextResponse.rewrite(url, { request: { headers } })
}

/** The root of the app host (quantecode.com/), which is not the website's homepage. */
export function proxy(req: NextRequest, ev: NextFetchEvent) {
  // Agents (lib/agents): a page asked for as Markdown (`Accept: text/markdown`, "<path>.md", or
  // /agents) is answered by /api/agent/v1/page — same content as the HTML, no Clerk.
  const md = markdownRewrite(req)
  if (md) return md
  // The app/(site) pages — the AssetraDigital website and the Quante product pages, including
  // quantecode.com/ (the Quante overview, owner 2026-11-04) — never use Clerk (lib/domains.ts,
  // components/auth/QuanteClerk.tsx): skip it there — no session lookup, no handshake redirect.
  // /api/* always goes through Clerk.
  if (isClerkFreePage(req.nextUrl.pathname)) return NextResponse.next()
  // The Qbox MCP connector (rewritten to /api/qbox/v1/connector) authenticates by its Qbox key only.
  if (req.nextUrl.pathname === '/qbox/mcp') return NextResponse.next()
  return withClerk(req, ev)
}

export const config = {
  matcher: [
    // /preview/* is NOT excluded: those pages call auth() to enforce project
    // ownership, which requires clerkMiddleware to have run on the request.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/(api|trpc)(.*)',
  ],
}
