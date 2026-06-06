import { NextResponse } from 'next/server'

// Clerk handles sign-out via <UserButton /> or <SignOutButton />.
// This stub keeps any old links from 404-ing.
export async function POST() {
  return NextResponse.redirect(new URL('/login', 'http://localhost:3000'))
}

export async function GET() {
  return NextResponse.redirect(new URL('/login', 'http://localhost:3000'))
}
