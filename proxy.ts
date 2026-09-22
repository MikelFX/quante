import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/new(.*)',
  '/project(.*)',
  '/billing(.*)',
  '/settings(.*)',
])

const isAuthRoute = createRouteMatcher(['/login(.*)', '/signup(.*)'])

export const proxy = clerkMiddleware(async (auth, req) => {
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
    '/((?!_next/static|_next/image|favicon.ico|preview/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/(api|trpc)(.*)',
  ],
}
