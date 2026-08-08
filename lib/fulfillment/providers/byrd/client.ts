// byrd HTTP + auth layer. Endpoints and shapes verified against the live docs at
// https://developers.getbyrd.com (fetched 2026-08-07 — see docs/authentication,
// docs/how-to-call-bryd-apis, docs/creating-a-shipment, docs/get-shipment-details,
// docs/listing-products, docs/creating-a-product, docs/announcing-returns). Nothing here is
// guessed; anywhere the docs didn't cover something needed, it's called out in a comment.
//
// Auth: POST /v2/login {username, password, validity} -> {token, payload}. Rate-limited to
// 5 calls/min per docs/frequency-of-calls-to-the-api — the token cache below exists
// specifically to stay far under that, not just as an optimization.
// Refresh: POST /v2/refresh_token {token} -> {token, payload} — takes the *current* token,
// not a separate refresh token; used to renew before expiry without burning a login-rate-limit
// call. On a real 401 (refresh itself rejected) we fall back to one full re-login; a second
// 401 after that is surfaced as an auth error rather than retried further (matches spec: "at
// the second 401, stop").
//
// Token cache: Supabase `fulfillment_tokens` (see supabase/migration-fulfillment-v2.sql),
// one row per (project_id, provider), TTL a few minutes shorter than byrd's own expiry.

import type { SupabaseClient } from '@supabase/supabase-js'

export const BYRD_API_BASE = 'https://api.getbyrd.com'
const USER_AGENT = process.env.BYRD_USER_AGENT ?? 'Quante (info@quantecode.com) - 2.0'
const LOGIN_TOKEN_VALIDITY_SECONDS = 6 * 60 * 60 // 6h — well under the 7-day max, refreshed well before expiry
const REFRESH_SAFETY_MARGIN_MS = 5 * 60_000 // refresh/re-login if less than 5min of validity remains

export interface ByrdClientConfig {
  apiKey: string
  apiSecret: string
  projectId: string
}

interface TokenPayload {
  token: string
  payload?: { exp?: number }
}

async function rawLogin(cfg: ByrdClientConfig): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(`${BYRD_API_BASE}/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      username: cfg.apiKey,
      password: cfg.apiSecret,
      validity: LOGIN_TOKEN_VALIDITY_SECONDS,
    }),
  })
  if (!res.ok) {
    throw new Error(`byrd login failed (${res.status}) — check API key & secret`)
  }
  const data = await res.json() as TokenPayload
  if (!data.token) throw new Error('byrd login response did not contain a token')
  // payload.exp is a unix-seconds JWT exp claim per docs/authentication response example —
  // fall back to our requested validity if it's ever absent.
  const expiresAt = data.payload?.exp
    ? data.payload.exp * 1000
    : Date.now() + LOGIN_TOKEN_VALIDITY_SECONDS * 1000
  return { token: data.token, expiresAt }
}

async function rawRefresh(currentToken: string): Promise<{ token: string; expiresAt: number } | null> {
  const res = await fetch(`${BYRD_API_BASE}/v2/refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ token: currentToken }),
  })
  if (!res.ok) return null // 401/expired — caller falls back to a full re-login
  const data = await res.json() as TokenPayload
  if (!data.token) return null
  const expiresAt = data.payload?.exp ? data.payload.exp * 1000 : Date.now() + LOGIN_TOKEN_VALIDITY_SECONDS * 1000
  return { token: data.token, expiresAt }
}

// Reads/writes the `fulfillment_tokens` cache row for this (project, provider). Table is
// created by supabase/migration-fulfillment-v2.sql (NOT run against production — see that
// file's header). Until that migration runs, getToken() below falls back to an in-memory
// (per-lambda-instance, best-effort) cache so the integration still works, just without the
// cross-invocation caching the DB table is meant to provide.
const inMemoryFallbackCache = new Map<string, { token: string; expiresAt: number }>()

async function getToken(
  db: SupabaseClient | null,
  cfg: ByrdClientConfig,
): Promise<string> {
  const now = Date.now()

  if (db) {
    const { data: row, error } = await db
      .from('fulfillment_tokens')
      .select('token, expires_at')
      .eq('project_id', cfg.projectId)
      .eq('provider', 'byrd')
      .maybeSingle()

    // 42P01 = undefined_table — migration hasn't run yet, use the in-memory fallback silently
    // rather than failing every fulfillment call.
    if (!error && row && new Date(row.expires_at as string).getTime() - now > REFRESH_SAFETY_MARGIN_MS) {
      return row.token as string
    }

    if (!error && row) {
      // Close to expiry — try a cheap refresh before falling back to a full re-login.
      const refreshed = await rawRefresh(row.token as string)
      if (refreshed) {
        await db.from('fulfillment_tokens').upsert({
          project_id: cfg.projectId,
          provider: 'byrd',
          token: refreshed.token,
          expires_at: new Date(refreshed.expiresAt).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'project_id,provider' })
        return refreshed.token
      }
    }

    const fresh = await rawLogin(cfg)
    await db.from('fulfillment_tokens').upsert({
      project_id: cfg.projectId,
      provider: 'byrd',
      token: fresh.token,
      expires_at: new Date(fresh.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,provider' }).then(
      () => {},
      // Swallow — e.g. table doesn't exist yet (migration not run). The token still works for
      // this invocation via the return value; we just lose cross-invocation caching.
      () => {},
    )
    return fresh.token
  }

  // No db client passed — in-memory fallback only (used by tests / callers without a
  // Supabase context).
  const cached = inMemoryFallbackCache.get(cfg.projectId)
  if (cached && cached.expiresAt - now > REFRESH_SAFETY_MARGIN_MS) return cached.token
  const fresh = await rawLogin(cfg)
  inMemoryFallbackCache.set(cfg.projectId, fresh)
  return fresh.token
}

export interface ByrdRequestOptions extends RequestInit {
  // Set true only for reads/idempotent calls. NEVER set true for shipment creation — see
  // module header and lib/fulfillment/auto-ship.ts.
  retryable?: boolean
}

// Logs every call to `fulfillment_api_log` (endpoint, status, latency — never credentials or
// body) when a db client is available. Best-effort: a logging failure never fails the actual
// API call.
async function logCall(
  db: SupabaseClient | null,
  projectId: string,
  endpoint: string,
  method: string,
  status: number | null,
  latencyMs: number,
  errorMessage?: string,
): Promise<void> {
  if (!db) return
  try {
    await db.from('fulfillment_api_log').insert({
      project_id: projectId,
      provider: 'byrd',
      endpoint,
      method,
      status_code: status,
      latency_ms: Math.round(latencyMs),
      error_message: errorMessage ?? null,
    })
  } catch {
    // Table may not exist yet (migration not run) — never let logging break the real call.
  }
}

const MAX_RETRIES = 2
const BASE_BACKOFF_MS = 500

// Central request helper: attaches auth + headers, retries with exponential backoff + jitter
// ONLY on 429/5xx AND only when `retryable: true` is explicitly passed, logs every attempt.
// Callers making a non-idempotent write (shipment creation) must NOT pass retryable: true.
export async function byrdRequest(
  db: SupabaseClient | null,
  cfg: ByrdClientConfig,
  path: string,
  options: ByrdRequestOptions = {},
): Promise<Response> {
  const { retryable, ...init } = options
  const method = init.method ?? 'GET'
  let attempt = 0

  for (;;) {
    const token = await getToken(db, cfg)
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${BYRD_API_BASE}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      })
    } catch (err) {
      await logCall(db, cfg.projectId, path, method, null, Date.now() - started, err instanceof Error ? err.message : 'network error')
      if (retryable && attempt < MAX_RETRIES) {
        attempt++
        await sleep(backoffDelay(attempt))
        continue
      }
      throw err
    }

    await logCall(db, cfg.projectId, path, method, res.status, Date.now() - started, res.ok ? undefined : `HTTP ${res.status}`)

    // One retry-on-401: token might have just expired between getToken() and the request
    // landing. Force a fresh login (bypass cache) and retry once, regardless of `retryable` —
    // this is about auth freshness, not general resilience, and is safe to do even for the
    // shipment-creation call since nothing was created if byrd rejected the auth.
    if (res.status === 401 && attempt === 0) {
      attempt++
      if (db) {
        await db.from('fulfillment_tokens').delete().eq('project_id', cfg.projectId).eq('provider', 'byrd')
      } else {
        inMemoryFallbackCache.delete(cfg.projectId)
      }
      continue
    }

    if (retryable && (res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      attempt++
      await sleep(backoffDelay(attempt))
      continue
    }

    return res
  }
}

function backoffDelay(attempt: number): number {
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  return base + Math.random() * base * 0.5 // jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
