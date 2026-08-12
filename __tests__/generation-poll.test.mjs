// Level 3 background-job architecture — pure decision logic from lib/generation-poll.ts
// (decidePollAction, phaseToStatusText, isJobStuck).
// Usage: node --test __tests__/generation-poll.test.mjs
// Or via: npm run test:generation-poll
//
// Inlines a plain-JS copy of the relevant logic (must stay in sync with lib/generation-poll.ts)
// — same convention as __tests__/generation-checkpoint.test.mjs and
// __tests__/generation-resume.test.mjs, since these tests run via plain `node --test`
// without a TypeScript loader.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/generation-poll.ts (inlined copy) ───────────────────────────────────────────────

function decidePollAction(payload) {
  if (payload.status === 'completed') {
    if (!payload.projectId) {
      return { action: 'error', message: 'Generation completed but no project was recorded. Please check your dashboard.' }
    }
    return {
      action: 'navigate',
      projectId: payload.projectId,
      deploymentId: payload.deploymentId,
      codeVersionId: payload.codeVersionId,
    }
  }
  if (payload.status === 'failed') {
    return { action: 'error', message: payload.error || 'Generation failed. Please try again.' }
  }
  return { action: 'continue' }
}

function phaseToStatusText(phase) {
  switch (phase) {
    case 'designing': return 'Designing your store…'
    case 'retrying_fallback': return 'Retrying with fallback model…'
    case 'parsing': return 'Parsing generated files…'
    case 'saving': return 'Saving…'
    case 'validating_build': return 'Validating build…'
    default: return 'Working on your store…'
  }
}

const JOB_STUCK_THRESHOLD_MS = 400_000

function isJobStuck(createdAtMs, nowMs, thresholdMs = JOB_STUCK_THRESHOLD_MS) {
  return nowMs - createdAtMs > thresholdMs
}

function basePayload(overrides = {}) {
  return {
    status: 'running',
    phase: 'designing',
    files: {},
    rawOutputTail: '',
    summary: null,
    error: null,
    projectId: null,
    deploymentId: null,
    previewUrl: null,
    codeVersionId: null,
    ...overrides,
  }
}

// ─── tests: decidePollAction ──────────────────────────────────────────────────────────────

test('decidePollAction: status running → continue, regardless of phase', () => {
  const result = decidePollAction(basePayload({ status: 'running', phase: 'parsing' }))
  assert.deepEqual(result, { action: 'continue' })
})

test('decidePollAction: status completed with a projectId → navigate, carries deploymentId/codeVersionId along', () => {
  const result = decidePollAction(basePayload({
    status: 'completed',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    codeVersionId: 'ver-1',
  }))
  assert.deepEqual(result, {
    action: 'navigate',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    codeVersionId: 'ver-1',
  })
})

test('decidePollAction: status completed but projectId missing → error (defensive — should not happen, but must not silently navigate to /project/null)', () => {
  const result = decidePollAction(basePayload({ status: 'completed', projectId: null }))
  assert.equal(result.action, 'error')
  assert.match(result.message, /no project was recorded/i)
})

test('decidePollAction: status completed with null deploymentId/codeVersionId still navigates (preview deploy is best-effort, non-fatal)', () => {
  const result = decidePollAction(basePayload({
    status: 'completed',
    projectId: 'proj-2',
    deploymentId: null,
    codeVersionId: null,
  }))
  assert.deepEqual(result, {
    action: 'navigate',
    projectId: 'proj-2',
    deploymentId: null,
    codeVersionId: null,
  })
})

test('decidePollAction: status failed with an error message → error, message passed through verbatim', () => {
  const result = decidePollAction(basePayload({ status: 'failed', error: 'Claude API returned an invalid response.' }))
  assert.deepEqual(result, { action: 'error', message: 'Claude API returned an invalid response.' })
})

test('decidePollAction: status failed with no error message → generic fallback message', () => {
  const result = decidePollAction(basePayload({ status: 'failed', error: null }))
  assert.deepEqual(result, { action: 'error', message: 'Generation failed. Please try again.' })
})

test('decidePollAction: status failed with empty-string error → generic fallback message (falsy, not passed through)', () => {
  const result = decidePollAction(basePayload({ status: 'failed', error: '' }))
  assert.deepEqual(result, { action: 'error', message: 'Generation failed. Please try again.' })
})

// ─── tests: phaseToStatusText ──────────────────────────────────────────────────────────────

test('phaseToStatusText: maps every known phase to its display text', () => {
  assert.equal(phaseToStatusText('designing'), 'Designing your store…')
  assert.equal(phaseToStatusText('retrying_fallback'), 'Retrying with fallback model…')
  assert.equal(phaseToStatusText('parsing'), 'Parsing generated files…')
  assert.equal(phaseToStatusText('saving'), 'Saving…')
  assert.equal(phaseToStatusText('validating_build'), 'Validating build…')
})

test('phaseToStatusText: null phase → generic fallback', () => {
  assert.equal(phaseToStatusText(null), 'Working on your store…')
})

test('phaseToStatusText: unrecognized phase string → generic fallback, not a throw', () => {
  assert.equal(phaseToStatusText('some-future-phase'), 'Working on your store…')
})

// ─── tests: isJobStuck ──────────────────────────────────────────────────────────────────────

test('isJobStuck: just under the default threshold → not stuck', () => {
  assert.equal(isJobStuck(0, JOB_STUCK_THRESHOLD_MS - 1), false)
})

test('isJobStuck: just over the default threshold → stuck', () => {
  assert.equal(isJobStuck(0, JOB_STUCK_THRESHOLD_MS + 1), true)
})

test('isJobStuck: exactly at the threshold → not stuck (strictly greater-than)', () => {
  assert.equal(isJobStuck(0, JOB_STUCK_THRESHOLD_MS), false)
})

test('isJobStuck: freshly created (now === createdAt) → not stuck', () => {
  assert.equal(isJobStuck(5000, 5000), false)
})

test('isJobStuck: respects a custom threshold override', () => {
  assert.equal(isJobStuck(0, 1000, 500), true)
  assert.equal(isJobStuck(0, 400, 500), false)
})
