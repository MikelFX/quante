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
