// Per-item Higgsfield webhook tokens. Server-only.
//
// Higgsfield's webhook contract has no signing scheme, so the callback URL
// carries a token. It used to be the raw global HIGGSFIELD_WEBHOOK_SECRET —
// leaked once (provider dashboard, access logs) it authenticated a forged event
// for ANY item. Now each URL carries HMAC-SHA256(secret, itemId), bound to that
// one item, and every comparison is constant-time. The webhook route also no
// longer trusts the body (it re-polls Higgsfield), so a token alone can at most
// trigger an early status check.

import { createHmac, timingSafeEqual } from 'crypto'

function secret(): string | null {
  const s = process.env.HIGGSFIELD_WEBHOOK_SECRET
  return s && s.length > 0 ? s : null
}

export function qadsWebhookToken(itemId: string): string | null {
  const s = secret()
  if (!s) return null
  return createHmac('sha256', s).update(`qads-item:${itemId}`).digest('hex')
}

// Builds the hf_webhook URL for one item, or undefined when the app URL or the
// secret is not configured (the sweep cron is then the only completion path).
export function buildQadsWebhookUrl(itemId: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const token = qadsWebhookToken(itemId)
  if (!base || !token) return undefined
  return `${base}/api/webhooks/higgsfield?item=${encodeURIComponent(itemId)}&s=${token}`
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function verifyQadsWebhookToken(itemId: string, provided: string): boolean {
  const s = secret()
  if (!s || !provided) return false
  const expected = qadsWebhookToken(itemId)
  if (expected && safeEqual(provided, expected)) return true
  // Legacy URLs (jobs submitted before per-item tokens) carry the raw secret.
  // Still accepted so in-flight jobs complete; safe because the route acts only
  // on a fresh Higgsfield status poll, never on the request body.
  return safeEqual(provided, s)
}
