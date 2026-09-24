import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'

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

  const allowed = new Set<string>([req.nextUrl.origin])
  const site = originOf(process.env.NEXT_PUBLIC_APP_URL)
  if (site) allowed.add(site)
  const site2 = originOf(process.env.NEXT_PUBLIC_SITE_URL)
  if (site2) allowed.add(site2)
  return !allowed.has(origin)
}

export const proxy = clerkMiddleware(async (auth, req) => {
  if (isForeignOriginApiWrite(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const { userId } = await auth()
  // Signed-in users hitting the login/signup pages get bounced to the
  // Studio — those pages have no meaning for an already-authed session.
  // Homepage + every marketing page (/qads, /pricing, /showcase, /about,
  // /domains, /contact, /terms, /privacy) stay reachable while logged in
  // so a merchant deep in the Studio can jump back to marketing / their
  // generator without having to sign out first.
  if (isAuthRoute(req) && userId) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    // /preview/* is NOT excluded: those pages call auth() to enforce project
    // ownership, which requires clerkMiddleware to have run on the request.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/(api|trpc)(.*)',
  ],
}
