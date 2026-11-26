// Plnolet — age verification for e-shops (owner 2026-11-25, design doc
// https://claude.ai/artifact/7DfoV89N5sURyWpYq5U4ar). Pure rules, no I/O: API keys, session input,
// age from a verified birth date, the signed state that carries a session through an identity
// provider, and the age pass (a passkey that remembers "over 18 / over 21", never who the person is).
//
// What we store about a shopper: the result (over 18 / over 21), the method and the time. Never a
// name, a birth date or a document number. Tested in __tests__/plnolet.test.mjs.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const PLNOLET = {
  /** Age thresholds a merchant may ask for (pyrotechnics F3 needs 21). */
  thresholds: [18, 21] as const,
  /** A verification link works this long. */
  sessionTtlMs: 30 * 60_000,
  /** An age pass is valid this long after the identity check behind it. */
  passValidDays: 365,
  /** Sessions a key may open per hour (runaway / abuse guard). */
  sessionsPerKeyHour: 600,
  /** Attempts per verification link (test buttons, pass checks, provider round-trips). */
  attemptsPerSession: 12,
  maxReference: 120,
  maxDomains: 10,
  maxMerchantName: 80,
} as const

export type Threshold = (typeof PLNOLET.thresholds)[number]
export type Mode = 'test' | 'live'
import type { Method } from './labels.ts'
export type { Method } from './labels.ts'
export { METHOD_LABEL } from './labels.ts'
export type SessionStatus = 'pending' | 'verified' | 'failed' | 'expired'

// ── API keys ─────────────────────────────────────────────────────────────────

const KEY_BODY = 40
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const KEY_PREFIX: Record<Mode, string> = { test: 'plt_test_', live: 'plt_live_' }

export function newKey(mode: Mode): { key: string; hash: string; prefix: string } {
  let body = ''
  for (const b of randomBytes(KEY_BODY)) body += KEY_ALPHABET[b % KEY_ALPHABET.length]
  const key = KEY_PREFIX[mode] + body
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX[mode].length + 6) }
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** The key from `Authorization: Bearer plt_…` (or X-Api-Key) and its mode, strictly parsed. */
export function keyFrom(headers: { get(name: string): string | null }): { key: string; mode: Mode } | null {
  const raw = headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? headers.get('x-api-key') ?? ''
  const key = raw.trim()
  for (const mode of ['test', 'live'] as const) {
    const p = KEY_PREFIX[mode]
    if (key.startsWith(p) && key.length === p.length + KEY_BODY && /^[A-Za-z0-9_]+$/.test(key)) return { key, mode }
  }
  return null
}

// ── Merchant settings ───────────────────────────────────────────────────────

export class PlnoletInputError extends Error {}

/** A domain the merchant owns, as typed ("www.shop.cz", "https://shop.cz/") → "shop.cz". */
export function normalizeDomain(input: string): string | null {
  let s = String(input ?? '').trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^www\./, '')
  if (s === 'localhost') return s
  if (s.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null
  return s
}

export function parseMerchant(body: unknown): { name: string; domains: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new PlnoletInputError('Vyplňte název e-shopu.')
  if (name.length > PLNOLET.maxMerchantName) throw new PlnoletInputError('Název je příliš dlouhý.')
  const list = Array.isArray(b.domains) ? b.domains : typeof b.domains === 'string' ? b.domains.split(/[\s,]+/) : []
  const domains: string[] = []
  for (const d of list) {
    if (typeof d !== 'string' || !d.trim()) continue
    const n = normalizeDomain(d)
    if (!n) throw new PlnoletInputError(`Doména „${d.slice(0, 60)}“ není platná.`)
    if (!domains.includes(n)) domains.push(n)
  }
  if (domains.length > PLNOLET.maxDomains) throw new PlnoletInputError(`Nejvýš ${PLNOLET.maxDomains} domén.`)
  return { name, domains }
}

/** True when `host` is one of the merchant's domains or a subdomain of one. */
export function hostAllowed(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return domains.some((d) => h === d || h.endsWith('.' + d))
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface SessionInput {
  threshold: Threshold
  returnUrl: string
  reference: string | null
}

/**
 * POST /v1/sessions body. The return address must be on one of the merchant's domains (https;
 * http://localhost only for test keys), so a stolen key cannot turn us into an open redirect.
 */
export function parseSession(body: unknown, mode: Mode, domains: readonly string[]): SessionInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const t = b.threshold ?? b.min_age ?? 18
  const threshold = Number(t)
  if (!PLNOLET.thresholds.includes(threshold as Threshold)) throw new PlnoletInputError('threshold must be 18 or 21.')
  const rawUrl = typeof b.return_url === 'string' ? b.return_url : typeof b.returnUrl === 'string' ? b.returnUrl : ''
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new PlnoletInputError('return_url must be an absolute URL.')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.username || url.password) throw new PlnoletInputError('return_url must not carry credentials.')
  if (local) {
    if (mode !== 'test') throw new PlnoletInputError('localhost return_url works only with a test key.')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PlnoletInputError('return_url must be http(s).')
  } else {
    if (url.protocol !== 'https:') throw new PlnoletInputError('return_url must use https.')
    if (!hostAllowed(url.hostname, domains)) {
      throw new PlnoletInputError('return_url must be on one of your domains (add it in your Plnolet account).')
    }
  }
  url.hash = ''
  let reference: string | null = null
  const r = b.reference ?? b.order_id
  if (r != null && r !== '') {
    if (typeof r !== 'string' && typeof r !== 'number') throw new PlnoletInputError('reference must be a string.')
    const s = String(r).trim()
    if (s.length > PLNOLET.maxReference || /[\u0000-\u001f\u007f]/.test(s)) throw new PlnoletInputError('reference is too long or has control characters.')
    reference = s
  }
  return { threshold: threshold as Threshold, returnUrl: url.toString(), reference }
}

export function newSessionId(): string {
  let id = ''
  for (const b of randomBytes(24)) id += KEY_ALPHABET[b % KEY_ALPHABET.length]
  return 'ses_' + id
}

export function isSessionId(s: unknown): s is string {
  return typeof s === 'string' && /^ses_[A-Za-z0-9]{24}$/.test(s)
}

export interface SessionRow {
  id: string
  status: SessionStatus
  expires_at: string
  threshold: number
  mode: Mode
}

/** The status a reader should see: a pending session past its time is expired. */
export function effectiveStatus(row: Pick<SessionRow, 'status' | 'expires_at'>, now: number): SessionStatus {
  if (row.status === 'pending' && Date.parse(row.expires_at) <= now) return 'expired'
  return row.status
}

/** Where the shopper goes back to, with the session id (the merchant then asks our API for the result). */
export function returnTo(returnUrl: string, sessionId: string, status: SessionStatus): string {
  const u = new URL(returnUrl)
  u.searchParams.set('plnolet_session', sessionId)
  u.searchParams.set('plnolet_status', status)
  return u.toString()
}

// ── Age ─────────────────────────────────────────────────────────────────────

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC calendar days), or null if not a date. */
export function ageOn(birthdate: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthdate ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const born = new Date(Date.UTC(y, mo - 1, d))
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null
  const t = new Date(now)
  let age = t.getUTCFullYear() - y
  if (t.getUTCMonth() < mo - 1 || (t.getUTCMonth() === mo - 1 && t.getUTCDate() < d)) age--
  return age >= 0 && age < 130 ? age : null
}

export interface AgeResult {
  over18: boolean
  over21: boolean
}

/**
 * What an identity provider's claims prove. Only verified identities count: mojeID needs
 * `mojeid_valid: true` (the account was checked against an ID document), Bank iD identities are
 * always bank-verified. A birth date decides both thresholds; mojeID's `adult` flag alone proves 18 only.
 */
export function ageFromClaims(method: 'mojeid' | 'bankid', claims: Record<string, unknown>, now: number): AgeResult | null {
  if (method === 'mojeid' && claims.mojeid_valid !== true) return null
  const age = typeof claims.birthdate === 'string' ? ageOn(claims.birthdate, now) : null
  if (age != null) return { over18: age >= 18, over21: age >= 21 }
  if (method === 'mojeid' && claims.adult === true) return { over18: true, over21: false }
  if (method === 'mojeid' && claims.adult === false) return { over18: false, over21: false }
  return null
}

export function meets(result: AgeResult, threshold: number): boolean {
  return threshold >= 21 ? result.over21 : result.over18
}

// ── Signed state (provider round-trips, pass challenges) ───────────────────

const b64u = (buf: Buffer) => buf.toString('base64url')

/** HMAC-signed, expiring token: `<payload b64url>.<sig>`. Payload is JSON with `exp` (ms). */
export function signState(payload: Record<string, unknown>, secret: string): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)))
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`
}

export function verifyState<T extends { exp: number }>(token: string, secret: string, now: number): T | null {
  const [body, sig, extra] = String(token ?? '').split('.')
  if (!body || !sig || extra !== undefined) return null
  const want = createHmac('sha256', secret).update(body).digest()
  let got: Buffer
  try {
    got = Buffer.from(sig, 'base64url')
  } catch {
    return null
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    if (typeof p?.exp !== 'number' || p.exp <= now) return null
    return p
  } catch {
    return null
  }
}

/** The signing secret: PLNOLET_SECRET, else derived from the Clerk secret (always set in production). */
export function plnoletSecret(env: Record<string, string | undefined>): string | null {
  const own = env.PLNOLET_SECRET?.trim()
  if (own && own.length >= 32) return own
  const base = env.CLERK_SECRET_KEY?.trim()
  return base ? createHmac('sha256', base).update('plnolet/v1').digest('hex') : null
}

/** PKCE S256 pair for an OpenID Connect round-trip. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64u(randomBytes(32))
  return { verifier, challenge: b64u(createHash('sha256').update(verifier).digest()) }
}

// ── Age pass ────────────────────────────────────────────────────────────────

export interface PassRow {
  over18: boolean
  over21: boolean
  mode: Mode
  expires_at: string
  revoked_at: string | null
}

/** Why a pass cannot answer this session, or null when it can. */
export function passProblem(pass: PassRow, session: { threshold: number; mode: Mode }, now: number): string | null {
  if (pass.revoked_at) return 'revoked'
  if (Date.parse(pass.expires_at) <= now) return 'expired'
  if (pass.mode !== session.mode) return 'mode'
  if (!meets(pass, session.threshold)) return 'age'
  return null
}

export function passExpiry(verifiedAt: number): string {
  return new Date(verifiedAt + PLNOLET.passValidDays * 86_400_000).toISOString()
}

/** Methods strong enough to issue a pass (a pass never issues another pass; test passes stay test). */
export function canIssuePass(method: Method | null): boolean {
  return method === 'mojeid' || method === 'bankid' || method === 'test'
}

// ── Verification log (what a merchant can show an inspector) ────────────────

export interface LogRow {
  id: string
  created_at: string
  expires_at: string
  verified_at: string | null
  status: SessionStatus
  threshold: number
  method: Method | null
  reference: string | null
  mode: Mode
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // formula-safe for spreadsheets
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function logCsv(rows: readonly LogRow[], now: number): string {
  const head = ['session', 'created_at', 'verified_at', 'status', 'min_age', 'method', 'reference', 'mode']
  const lines = rows.map((r) =>
    [r.id, r.created_at, r.verified_at, effectiveStatus(r, now), r.threshold, r.method, r.reference, r.mode].map(csvCell).join(','),
  )
  return [head.join(','), ...lines].join('\r\n') + '\r\n'
}
