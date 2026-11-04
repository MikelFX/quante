import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deleteNameMatches, normalizeStoreName } from '../lib/projects/delete-confirm.ts'

test('delete confirmation needs the exact store name', () => {
  assert.equal(deleteNameMatches('Kávovar Praha', 'Kávovar Praha'), true)
  assert.equal(deleteNameMatches('  Kávovar   Praha ', 'Kávovar Praha'), true)
  assert.equal(deleteNameMatches('Kávovar Praha', 'Kávovar Praha'), true)
  assert.equal(deleteNameMatches('kávovar praha', 'Kávovar Praha'), false)
  assert.equal(deleteNameMatches('Kávovar', 'Kávovar Praha'), false)
  assert.equal(deleteNameMatches('', ''), false)
  assert.equal(deleteNameMatches(undefined, 'Shop'), false)
  assert.equal(deleteNameMatches('Shop', null), false)
  assert.equal(normalizeStoreName(42), '')
})

test('the delete route and the dashboard both use the check', () => {
  const route = readFileSync(new URL('../app/api/projects/[id]/route.ts', import.meta.url), 'utf8')
  assert.match(route, /deleteNameMatches\(/)
  const ui = readFileSync(new URL('../app/(app)/dashboard/GrideetClient.tsx', import.meta.url), 'utf8')
  assert.match(ui, /deleteNameMatches\(/)
  assert.match(ui, /confirmName/)
})

test('rows pointing at a version are cleared before the versions are deleted', () => {
  const route = readFileSync(new URL('../app/api/projects/[id]/route.ts', import.meta.url), 'utf8')
  const at = (s) => { const i = route.indexOf(s); assert.ok(i > 0, s); return i }
  const versions = at("from('code_versions').delete()")
  for (const s of ["from('generation_jobs').update({ code_version_id: null })", "from('deployments').delete()", "from('exports').delete()"]) {
    assert.ok(at(s) < versions, s)
  }
  assert.ok(at("const step2 = step1 ?? await runCleanup") < versions)
})
