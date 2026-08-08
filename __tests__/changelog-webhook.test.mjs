// Vercel deploy webhook — signature verification + idempotency guard.
// Usage: node --test __tests__/changelog-webhook.test.mjs
// Or via: npm run test:changelog-webhook
//
// Inlines a copy of the pure logic from lib/vercel-webhook.ts (must stay in
// sync) — same convention as __tests__/export-whitelabel.test.mjs /
// lib/export-scrub.ts, since these tests run via plain `node --test` without
// a TypeScript loader.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

function verifyVercelSignature(rawBody, headerSignature, secret) {
  if (!headerSignature || !secret) return false
  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
  if (headerSignature.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(headerSignature), Buffer.from(expected))
  } catch {
    return false
  }
}

function isDuplicateDeploymentError(error) {
  return error?.code === '23505'
}

// ─── Signature verification ─────────────────────────────────────────────

test('accepts a correctly signed payload', () => {
  const secret = 'whsec_test_secret'
  const body = JSON.stringify({ type: 'deployment.succeeded', payload: { target: 'production' } })
  const signature = crypto.createHmac('sha1', secret).update(body).digest('hex')
  assert.equal(verifyVercelSignature(body, signature, secret), true)
})

test('rejects a payload signed with the wrong secret', () => {
  const body = JSON.stringify({ type: 'deployment.succeeded' })
  const signature = crypto.createHmac('sha1', 'wrong_secret').update(body).digest('hex')
  assert.equal(verifyVercelSignature(body, signature, 'whsec_test_secret'), false)
})

test('rejects a tampered body (signature no longer matches)', () => {
  const secret = 'whsec_test_secret'
  const originalBody = JSON.stringify({ type: 'deployment.succeeded', payload: { target: 'production' } })
  const signature = crypto.createHmac('sha1', secret).update(originalBody).digest('hex')
  const tamperedBody = JSON.stringify({ type: 'deployment.succeeded', payload: { target: 'staging' } })
  assert.equal(verifyVercelSignature(tamperedBody, signature, secret), false)
})

test('rejects a missing signature header', () => {
  const body = JSON.stringify({ type: 'deployment.succeeded' })
  assert.equal(verifyVercelSignature(body, null, 'whsec_test_secret'), false)
})

test('rejects when the server has no configured secret', () => {
  const body = JSON.stringify({ type: 'deployment.succeeded' })
  const signature = crypto.createHmac('sha1', '').update(body).digest('hex')
  assert.equal(verifyVercelSignature(body, signature, ''), false)
})

test('rejects a garbage/non-hex signature without throwing', () => {
  const body = JSON.stringify({ type: 'deployment.succeeded' })
  assert.doesNotThrow(() => {
    assert.equal(verifyVercelSignature(body, 'not-a-real-signature', 'whsec_test_secret'), false)
  })
})

// ─── Idempotency guard ───────────────────────────────────────────────────
// This is the part that matters most: a duplicate webhook delivery for a
// deployment we already logged must be recognized and treated as success,
// never as an error that could cause a caller (or Vercel's retry logic) to
// treat it as a failure needing another attempt.

test('recognizes a Postgres unique_violation (23505) as a duplicate deployment', () => {
  assert.equal(isDuplicateDeploymentError({ code: '23505' }), true)
})

test('does not treat other Postgres error codes as a duplicate', () => {
  assert.equal(isDuplicateDeploymentError({ code: '42703' }), false) // undefined_column (migration not run)
  assert.equal(isDuplicateDeploymentError({ code: '23502' }), false) // not_null_violation
})

test('does not treat a null/absent error as a duplicate', () => {
  assert.equal(isDuplicateDeploymentError(null), false)
})

// Note: this file tests the pure signature/error-code logic in isolation, the
// same way export-whitelabel.test.mjs tests scrubContent() in isolation. It
// does NOT exercise the actual route against a live Supabase table — the
// route.ts insert-first-then-act sequence (see its file header) and the
// UNIQUE(deployment_id) constraint in migration-changelog-v3.sql are the
// other half of the idempotency guarantee and can only be verified against a
// real (or staging) database, which this sandbox does not have network
// access to. Send two identical test deliveries from the Vercel dashboard
// after wiring up the webhook and confirm only one changelog_entries row
// appears, before relying on this in production.
