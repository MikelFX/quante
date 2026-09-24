// Store → Quante API key authentication (the per-project QUANTE_API_KEY injected into
// a deployed store's env at deploy time). Server-only. `_lib` is a private folder, so
// nothing in here is routed.
//
// SECURITY:
//  - The key is looked up by its SHA-256 hash (project_secrets.quante_api_key_hash,
//    maintained by a trigger — see supabase/migration-security-store-public.sql), so
//    the lookup never needs the plaintext. Until that migration runs (or for rows the
//    trigger hasn't touched yet) it falls back to the legacy plaintext lookup.
//  - Either way, the presented key is then compared to the stored value with
//    crypto.timingSafeEqual before it is accepted.
//  - Only "Authorization: Bearer <key>" is accepted — a bare token is rejected.

import { createHash, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Extracts the key from `Authorization: Bearer <key>`; null for anything else. */
export function bearerKey(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{16,200})\s*$/)
  return m ? m[1] : null
}

/**
 * Resolves the project a store API key belongs to, or null. `extraColumns` are
 * additional project_secrets columns to return with the row (comma-separated).
 */
export async function authenticateStoreKey<T extends Record<string, unknown> = Record<string, unknown>>(
  request: Request,
  extraColumns = '',
): Promise<(T & { project_id: string }) | null> {
  const key = bearerKey(request)
  if (!key) return null
  const hash = sha256Hex(key)
  const extra = extraColumns ? `, ${extraColumns}` : ''

  // 1) Hash lookup (the column may not exist yet if the migration hasn't been run —
  //    the query then errors and we fall through to the legacy lookup).
  let row: Record<string, unknown> | null = null
  const byHash = await supabaseAdmin
    .from('project_secrets')
    .select(`project_id, quante_api_key_hash${extra}`)
    .eq('quante_api_key_hash', hash)
    .maybeSingle()
  if (!byHash.error && byHash.data) {
    row = byHash.data as unknown as Record<string, unknown>
    const storedHash = row.quante_api_key_hash
    if (typeof storedHash !== 'string' || !safeEqual(storedHash, hash)) return null
  } else {
    // 2) Legacy plaintext lookup, confirmed in constant time.
    const byKey = await supabaseAdmin
      .from('project_secrets')
      .select(`project_id, quante_api_key${extra}`)
      .eq('quante_api_key', key)
      .maybeSingle()
    if (byKey.error || !byKey.data) return null
    row = byKey.data as unknown as Record<string, unknown>
    const stored = row.quante_api_key
    if (typeof stored !== 'string' || !safeEqual(stored, key)) return null
  }

  if (typeof row.project_id !== 'string') return null

  const { quante_api_key: _k, quante_api_key_hash: _h, ...rest } = row
  void _k; void _h
  return rest as T & { project_id: string }
}

// Checkout / order-status helpers (in-memory, per instance). Verified keys are cached
// briefly so a busy store proxy doesn't cost a DB lookup per request, and failed
// verifications are counted per connecting IP so junk Bearer tokens can't drive
// unthrottled project_secrets lookups. Callers use the cached result to identify the
// store's project (checkout) or to bind a request to it (order-status, where the
// per-order token is the actual credential); endpoints that grant access to store data
// (orders, etc.) use authenticateStoreKey, which always hits the DB.
//
// Failure throttle vs. shared egress IPs: stores proxy from Vercel's shared egress
// IPs, so a tenant on the same IP could send junk keys to throttle it. To keep that
// from knocking out other stores' keys:
//   - a key that already failed is answered from a negative cache (no lookup, no count);
//   - while an IP is throttled, a key verified on this instance within
//     KNOWN_GOOD_TTL_MS is still re-verified against the DB (a junk-key sender can't
//     guess one), and other unknown keys still get THROTTLED_LOOKUPS lookups per minute
//     per IP;
//   - only beyond that is the result 'throttled' — callers must not treat it as
//     invalid. A store never verified on this instance can still hit 'throttled' while
//     an attacker keeps the trickle busy; see STORE_CHECKOUT_REQUIRE_KEY in
//     ../checkout/route.ts.
const VERIFIED_TTL_MS = 5 * 60_000
const KNOWN_GOOD_TTL_MS = 24 * 60 * 60_000
const FAIL_WINDOW_MS = 10 * 60_000
const MAX_FAILS = 20
const THROTTLED_LOOKUPS_PER_MIN = 30
const verifiedKeys = new Map<string, { projectId: string; expires: number }>()
const knownGoodKeys = new Map<string, number>()  // key hash → expiry
const failedKeys = new Map<string, number>()     // key hash → expiry (negative cache)
const keyFailures = new Map<string, { count: number; resetAt: number }>()
const throttledLookups = new Map<string, { count: number; resetAt: number }>()

function pruneMaps(now: number) {
  if (verifiedKeys.size > 5000) for (const [k, v] of verifiedKeys) if (v.expires < now) verifiedKeys.delete(k)
  if (knownGoodKeys.size > 5000) for (const [k, v] of knownGoodKeys) if (v < now) knownGoodKeys.delete(k)
  if (failedKeys.size > 5000) for (const [k, v] of failedKeys) if (v < now) failedKeys.delete(k)
  // Bounded memory under a flood of distinct junk keys (they are throttled anyway).
  if (failedKeys.size > 20000) failedKeys.clear()
  if (keyFailures.size > 5000) for (const [k, v] of keyFailures) if (v.resetAt < now) keyFailures.delete(k)
  if (throttledLookups.size > 5000) for (const [k, v] of throttledLookups) if (v.resetAt < now) throttledLookups.delete(k)
}

function takeThrottledLookup(ip: string, now: number): boolean {
  const e = throttledLookups.get(ip)
  if (!e || e.resetAt < now) {
    throttledLookups.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (e.count >= THROTTLED_LOOKUPS_PER_MIN) return false
  e.count++
  return true
}

export type StoreKeyResult =
  | { status: 'none' }                        // no "Authorization: Bearer" header
  | { status: 'invalid' }                     // a key was presented but is not a valid store key
  | { status: 'throttled' }                   // too many failed keys from this connecting IP — not checked
  | { status: 'ok'; projectId: string }       // the project the key belongs to

/**
 * Resolves the project of the store API key on a checkout request (audit #59: the
 * checkout identifies the project from the key, not from the body). `connectingIp`
 * is the TCP-level client (the store's egress IP for proxied requests); after
 * MAX_FAILS failed verifications from it, unknown keys are only looked up at a
 * reduced rate (see above). Successful verifications are cached for VERIFIED_TTL_MS
 * per instance, so a rotated key may keep placing checkouts on an instance for up to
 * that long.
 */
export async function resolveStoreKeyProject(request: Request, connectingIp: string): Promise<StoreKeyResult> {
  const key = bearerKey(request)
  if (!key) {
    // A header that is present but malformed is not "no key" — treat it as invalid so
    // a broken store build fails loudly instead of silently taking the keyless path.
    return request.headers.get('authorization') ? { status: 'invalid' } : { status: 'none' }
  }
  const now = Date.now()
  pruneMaps(now)
  const hash = sha256Hex(key)
  const cached = verifiedKeys.get(hash)
  if (cached && cached.expires > now) return { status: 'ok', projectId: cached.projectId }
  const failedUntil = failedKeys.get(hash)
  if (failedUntil && failedUntil > now) return { status: 'invalid' }

  const fails = keyFailures.get(connectingIp)
  if (fails && fails.resetAt > now && fails.count >= MAX_FAILS) {
    const knownGood = (knownGoodKeys.get(hash) ?? 0) > now
    if (!knownGood && !takeThrottledLookup(connectingIp, now)) return { status: 'throttled' }
  }

  const row = await authenticateStoreKey(request)
  if (row) {
    verifiedKeys.set(hash, { projectId: row.project_id, expires: now + VERIFIED_TTL_MS })
    knownGoodKeys.set(hash, now + KNOWN_GOOD_TTL_MS)
    return { status: 'ok', projectId: row.project_id }
  }
  knownGoodKeys.delete(hash)
  failedKeys.set(hash, now + FAIL_WINDOW_MS)
  const entry = fails && fails.resetAt > now ? fails : { count: 0, resetAt: now + FAIL_WINDOW_MS }
  entry.count++
  keyFailures.set(connectingIp, entry)
  return { status: 'invalid' }
}

/**
 * True when the request carries the valid store API key of `projectId` (same caching
 * and failure throttling as resolveStoreKeyProject).
 */
export async function isStoreKeyForProject(request: Request, projectId: string, connectingIp: string): Promise<boolean> {
  const r = await resolveStoreKeyProject(request, connectingIp)
  return r.status === 'ok' && r.projectId === projectId
}
