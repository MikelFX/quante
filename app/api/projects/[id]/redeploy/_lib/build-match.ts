// Pure helpers for /api/projects/[id]/redeploy (audit F4). Server-only.
// Plain-JS copies live in __tests__/redeploy-build-match.test.mjs — keep them in sync.

import { createHash } from 'crypto'

/**
 * Content fingerprint of a code version: sha256 over its files in path order. Every
 * free path that writes a new code_versions row (restore, product edit with an
 * unchanged list, …) produces the SAME hash for the same content, so "has this content
 * already been built?" can't be dodged by minting a new version id.
 */
export function hashCodeFiles(files: unknown): string {
  const obj = (files && typeof files === 'object' && !Array.isArray(files))
    ? files as Record<string, unknown>
    : {}
  const entries = Object.keys(obj)
    .sort()
    .map((path) => [path, typeof obj[path] === 'string' ? obj[path] : JSON.stringify(obj[path] ?? null)])
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

// Store builds finish in a few minutes and the Studio gives up watching after ~6. A
// deployment Vercel still reports as queued / building (or with an unknown readyState,
// which lib/hosting/vercel.ts maps to 'building') after this long is treated as dead,
// so the "Rebuild preview" retry can't dead-end. Same for rows whose status lookup keeps
// failing.
export const STALE_BUILD_MS = 10 * 60 * 1000

export type RowVerdict = 'ready' | 'building' | 'dead' | 'lookup_failed'

/**
 * What one existing deployment of identical content means for a free rebuild.
 *   vercelState: the state Vercel reported, or null when the lookup threw.
 *   lookupStatus: HTTP status of a failed lookup (404 = Vercel has no such deployment).
 *   dbReady: the deployments row already says 'ready' — a transient lookup error on it
 *     fails closed at any age (it may well still be a working preview).
 */
export function classifyDeploymentRow(input: {
  vercelState: string | null
  lookupStatus?: number
  ageMs: number
  dbReady?: boolean
}): RowVerdict {
  const stale = !Number.isFinite(input.ageMs) || input.ageMs > STALE_BUILD_MS
  if (input.vercelState === null) {
    if (input.lookupStatus === 404) return 'dead'
    if (input.dbReady) return 'lookup_failed'
    return stale ? 'dead' : 'lookup_failed'
  }
  if (input.vercelState === 'ready') return 'ready'
  if (input.vercelState === 'error' || input.vercelState === 'canceled') return 'dead'
  // queued / building / anything unknown
  return stale ? 'dead' : 'building'
}
