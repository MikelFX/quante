// After signing in, a visitor returns to where they came from (e.g. /qads after "Generate") —
// lib/auth/after-sign-in.ts, used by proxy.ts and the sign-in / sign-up pages. Never an open
// redirect, never a loop back to an auth page.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { afterSignInPath, redirectParam } = await import('../lib/auth/after-sign-in.ts')
const ORIGIN = 'https://quantecode.com'

test('returns to the page the visitor came from', () => {
  assert.equal(afterSignInPath('/qads', ORIGIN), '/qads')
  assert.equal(afterSignInPath('/project/abc?did=1#log', ORIGIN), '/project/abc?did=1#log')
  assert.equal(afterSignInPath('https://quantecode.com/billing#agency', ORIGIN), '/billing#agency')
  assert.equal(afterSignInPath('http://localhost:3000/qads', 'http://localhost:3000'), '/qads')
  assert.equal(afterSignInPath('https://quantecode.com/qads', 'https://quante-git-x.vercel.app', ['https://quantecode.com']), '/qads')
})

test('anything else goes to the dashboard', () => {
  for (const bad of [null, '', 'https://evil.com/qads', '//evil.com/qads', 'javascript:alert(1)', '/login', '/signup?redirect_url=/qads', '/login/sso-callback']) {
    assert.equal(afterSignInPath(bad, ORIGIN), '/dashboard', String(bad))
  }
})

test('reads the target under every name Clerk uses', () => {
  assert.equal(redirectParam(new URLSearchParams('redirect_url=%2Fqads')), '/qads')
  assert.equal(redirectParam(new URLSearchParams('sign_up_force_redirect_url=%2Fqads')), '/qads')
  assert.equal(redirectParam({ sign_in_fallback_redirect_url: ['/qads', '/x'] }), '/qads')
  assert.equal(redirectParam({}), null)
})
