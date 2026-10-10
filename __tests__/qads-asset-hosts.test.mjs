// SSRF allowlist for Qads output downloads (lib/qads/assets.ts): only https on Higgsfield's own
// hosts — exact CloudFront distributions, never all of cloudfront.net.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const FAKES = new URL('./fakes/', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/supabase/admin') return nextResolve(new URL('supabase-admin.mjs', FAKES).href, context)
    return nextResolve(specifier, context)
  },
})
const { isAllowedAssetUrl } = await import('../lib/qads/assets.ts')

test('Higgsfield hosts and its CloudFront distributions are allowed', () => {
  for (const u of [
    'https://d8j0ntlcm91z4.cloudfront.net/out/a.mp4',
    'https://d3u0tzju9qaucj.cloudfront.net/out/b.png',
    'https://cdn.higgsfield.ai/x.webp',
    'https://higgsfield.ai/x.jpg',
  ]) assert.ok(isAllowedAssetUrl(u), u)
})

test('everything else is refused', () => {
  for (const u of [
    'https://someone-else.cloudfront.net/x.png',
    'http://d3u0tzju9qaucj.cloudfront.net/x.png',
    'https://user:pw@d3u0tzju9qaucj.cloudfront.net/x.png',
    'https://d3u0tzju9qaucj.cloudfront.net:8443/x.png',
    'https://higgsfield.ai.evil.com/x.png',
    'https://evilhiggsfield.ai/x.png',
    'not a url',
  ]) assert.ok(!isAllowedAssetUrl(u), u)
})
