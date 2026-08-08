import 'server-only'
import crypto from 'crypto'

// Shared logic for app/api/webhooks/vercel-deploy/route.ts, split out into a
// plain module (no Next.js/Supabase imports) so it's importable from a plain
// `node --test` file without a TS loader — see __tests__/changelog-webhook.test.mjs,
// which inlines a copy of verifyVercelSignature() and isDuplicateDeploymentError()
// and must be kept in sync with this file (same convention as
// __tests__/export-whitelabel.test.mjs / lib/export-scrub.ts).

/**
 * Verifies the `x-vercel-signature` header per
 * https://vercel.com/docs/headers/request-headers#x-vercel-signature
 * (HMAC-SHA1 of the raw body, hex-encoded). Confirmed against the live docs
 * 2026-08-07 — this is NOT guessed.
 */
export function verifyVercelSignature(
  rawBody: string,
  headerSignature: string | null,
  secret: string,
): boolean {
  if (!headerSignature || !secret) return false
  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
  if (headerSignature.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(headerSignature), Buffer.from(expected))
  } catch {
    // Buffer length mismatch or non-hex input — timingSafeEqual throws instead
    // of returning false in that case.
    return false
  }
}

/**
 * Postgres unique_violation. We insert the changelog_entries row with a
 * UNIQUE(deployment_id) constraint BEFORE doing anything else (see
 * migration-changelog-v3.sql + route.ts) — insert-first-then-act, same pattern
 * quante-fulfillment-byrd-spec.md uses for fulfillment_shipments/order_id. A
 * 23505 here means "we already logged this deployment", not a real error.
 */
export function isDuplicateDeploymentError(error: { code?: string | null } | null): boolean {
  return error?.code === '23505'
}

// Best-effort extraction of the first line of the linked GitHub commit
// message from a Vercel deployment payload. `payload.deployment.meta` is only
// documented as "a Map of deployment metadata" (no fixed schema) — the
// githubCommit* keys used here are commonly observed on GitHub-linked
// deployments but are NOT part of Vercel's contractually documented payload.
// Verify against a real test delivery (Vercel dashboard → Webhooks → Test)
// before relying on this; falls back to null if the key is absent so callers
// always have a safe default.
export function extractCommitMessage(meta: Record<string, unknown> | undefined | null): string | null {
  const raw = meta?.githubCommitMessage
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  // First line only — commit bodies can be long/multi-paragraph.
  return raw.split('\n')[0].trim()
}

export function fallbackTitleFromDeployment(commitMessage: string | null, deploymentId: string): string {
  return commitMessage && commitMessage.length > 0
    ? commitMessage
    : `Production deploy ${deploymentId.slice(0, 12)}`
}
