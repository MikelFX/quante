// Request helpers shared by the Plnolet routes (server-only).

import { NextResponse } from 'next/server'
import { APP_ORIGIN } from '@/lib/domains'
import { PLNOLET, plnoletSecret, verifyState } from './model'
import { PlnoletNotSetUpError } from './store'

/**
 * Where the shopper-facing pages live. Passkeys are bound to this host, so in production it is
 * always the app host (PLNOLET_ORIGIN can move it, e.g. to https://plnolet.cz later); previews and
 * local dev use their own origin.
 */
export function plnoletOrigin(request: Request): string {
  const own = process.env.PLNOLET_ORIGIN?.trim()
  if (own && /^https:\/\/[a-z0-9.-]+$/i.test(own)) return own
  if (process.env.VERCEL_ENV === 'production') return APP_ORIGIN
  return new URL(request.url).origin
}

export const rpIdOf = (origin: string) => new URL(origin).hostname

export function secretOrThrow(): string {
  const s = plnoletSecret(process.env)
  if (!s) throw new PlnoletNotSetUpError('PLNOLET_SECRET is not set.')
  return s
}

/** The page-side error shape (Czech, shown to the shopper). */
export const pageError = (status: number, message: string) => NextResponse.json({ ok: false, message }, { status })

export function handle(e: unknown): NextResponse {
  if (e instanceof PlnoletNotSetUpError) return pageError(503, 'Ověřování věku teď není k dispozici.')
  console.error('[plnolet]', e)
  return pageError(500, 'Něco se pokazilo. Zkuste to prosím znovu.')
}

/**
 * Cookie that lets the browser which just proved the age (and only that browser) save an age pass
 * for that session. Signed, short-lived, HttpOnly.
 */
export const ISSUE_COOKIE = 'pn_issue'

export interface Grant { m: string; a18: boolean; a21: boolean }

export function issueCookie(sessionId: string, grant: Grant, secret: string, sign: (p: Record<string, unknown>, s: string) => string) {
  return {
    name: ISSUE_COOKIE,
    value: sign({ sid: sessionId, ...grant, exp: Date.now() + 15 * 60_000 }, secret),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/plnolet',
    maxAge: 15 * 60,
  }
}

export function issueGrant(request: Request, sessionId: string, secret: string): Grant | null {
  const raw = request.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(ISSUE_COOKIE + '='))?.slice(ISSUE_COOKIE.length + 1)
  if (!raw) return null
  const p = verifyState<Grant & { sid: string; exp: number }>(decodeURIComponent(raw), secret, Date.now())
  return p && p.sid === sessionId ? { m: p.m, a18: p.a18 === true, a21: p.a21 === true } : null
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 16_000) throw new SyntaxError('too large')
  if (!text) return {}
  const v = JSON.parse(text)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export { PLNOLET }
