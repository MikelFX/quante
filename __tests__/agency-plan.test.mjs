// The Agency plan's promises (lib/agency-plan.ts, the website ceník) must be true in code. These
// checks pin the code paths that make them true, so a refactor that drops one fails here instead
// of silently charging Agency users or limiting their projects again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (p) => readFileSync(ROOT + p, 'utf8')

test('no project limit for Agency', () => {
  assert.match(src('lib/tier.ts'), /activeProjectLimit[\s\S]*agency \? null/)
  for (const f of ['app/api/projects/route.ts', 'app/api/quante/generate/route.ts']) {
    assert.match(src(f), /activeProjectLimit\(/, `${f} checks the limit through activeProjectLimit`)
  }
  assert.match(src('app/api/stripe/webhook/route.ts'), /if \(isActive\) \{[\s\S]*?restoreArchivedProjects\(userId\)/, 'reactivation restores archived projects')
})

test('store generation debits nothing on Agency, behind the daily fair-use cap', () => {
  const g = src('app/api/quante/generate/route.ts')
  assert.match(g, /const charged = !agency/)
  assert.match(g, /charged \? await debitCredits\(/)
  assert.match(g, /AGENCY_FAIR_USE\.generationsPerDay/)
  assert.match(g, /if \(!codeSaved && charged\)/, 'no refund of a debit that never happened')
})

test('every other store-work charge skips Agency', () => {
  for (const f of [
    'app/api/quante/vision/route.ts',
    'app/api/quante/image-suggest/route.ts',
    'app/api/projects/[id]/insights/route.ts',
    'app/api/deploy/route.ts',
    'app/api/quante/section/route.ts',
    'app/api/quante/custom-component/route.ts',
  ]) {
    const s = src(f)
    assert.match(s, /debitUnlessAgency\(/, `${f} uses debitUnlessAgency`)
    assert.doesNotMatch(s, /await debitCredits\(/, `${f} still debits Agency`)
  }
})

test('Qads is included for Agency with a daily cap on renders', () => {
  for (const f of ['app/api/qads/generate/route.ts', 'app/api/qads/generations/[id]/regenerate-item/route.ts']) {
    assert.match(src(f), /reserveAgencyRenders\(/, `${f} counts Agency renders`)
  }
  const fair = src('lib/qads/fair-use.ts')
  assert.match(fair, /qadsVideosPerDay/)
  assert.match(fair, /qadsPhotosPerDay/)
})

test('the plan text promises nothing the code lacks', () => {
  const plan = src('lib/agency-plan.ts')
  assert.doesNotMatch(plan, /priority/i, 'there is no priority queue')
  assert.match(plan, /Batch generation[^\n]*soon: true/, 'batch generation is marked as coming until it ships')
  for (const f of ['app/(app)/billing/page.tsx', 'app/(app)/dashboard/page.tsx', 'app/(app)/project/[id]/StudioClient.tsx']) {
    assert.doesNotMatch(src(f), /Priority generation|batch limit|batch slots|Agency batch/i, f)
  }
})
