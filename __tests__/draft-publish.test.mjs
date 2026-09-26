// Draft / publish (2026-09-26): which deployments row is LIVE once staged draft builds
// exist and get promoted. Pure rules from lib/hosting/scaffold-rollout-rules.ts — the
// same ones checkout pricing, the scaffold rollout, the publish route and the Studio's
// deployments endpoint use.
// Usage: node --test __tests__/draft-publish.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const R = await import(new URL('../lib/hosting/scaffold-rollout-rules.ts', import.meta.url).href)

const row = (id, extra) => ({
  id, status: 'ready', code_version_id: `cv-${id}`, domain: null, url: `https://${id}.vercel.app`,
  created_at: '2026-09-26T10:00:00Z', target: 'production', ...extra,
})

test('a staged draft is never live, however new it is', () => {
  const rows = [
    row('draft', { target: 'staged', created_at: '2026-09-26T12:00:00Z' }),
    row('live', { created_at: '2026-09-26T09:00:00Z' }),
  ]
  assert.equal(R.classifyDeploymentRow(rows[0]), 'preview')
  assert.equal(R.pickLiveDeployment(rows).id, 'live')
})

test('a promoted draft is live from its promotion time, not its creation time', () => {
  const rows = [
    // Rollout build of the previous live version, finished before the promote.
    row('rollout', { created_at: '2026-09-26T11:00:00Z' }),
    // Draft built at 10:00, promoted at 11:30.
    row('promoted', { created_at: '2026-09-26T10:00:00Z', promoted_at: '2026-09-26T11:30:00Z' }),
  ]
  assert.equal(R.pickLiveDeployment(rows).id, 'promoted')
  assert.equal(R.pickLiveCodeVersionId(rows), 'cv-promoted')
  assert.deepEqual(R.productionRowsNewestFirst(rows).map((r) => r.id), ['promoted', 'rollout'])
})

test('a production build created after the promotion wins again', () => {
  const rows = [
    row('promoted', { created_at: '2026-09-26T10:00:00Z', promoted_at: '2026-09-26T11:30:00Z' }),
    row('push-to-live', { created_at: '2026-09-26T12:00:00Z' }),
  ]
  assert.equal(R.pickLiveDeployment(rows).id, 'push-to-live')
})

test('liveSinceMs falls back to created_at (rows before the migration have no promoted_at)', () => {
  assert.equal(R.liveSinceMs(row('a', {})), Date.parse('2026-09-26T10:00:00Z'))
  assert.equal(R.liveSinceMs(row('b', { promoted_at: null })), Date.parse('2026-09-26T10:00:00Z'))
  assert.equal(R.liveSinceMs(row('c', { promoted_at: 'garbage' })), Date.parse('2026-09-26T10:00:00Z'))
})

test('scaffold state follows the promoted build', () => {
  const rows = [
    row('rollout', { created_at: '2026-09-26T11:00:00Z', scaffold_version: 3 }),
    row('promoted', { created_at: '2026-09-26T10:00:00Z', promoted_at: '2026-09-26T11:30:00Z', scaffold_version: 4 }),
  ]
  const ev = R.evaluateScaffoldState(rows, { currentVersion: 4, now: Date.parse('2026-09-26T12:00:00Z') })
  assert.equal(ev.state, 'up_to_date')
  assert.equal(ev.liveRow.id, 'promoted')
})
