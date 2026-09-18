// Signs/verifies the OAuth `state` param passed to Meta/TikTok so the callback route can
// trust which user+project+channel initiated the flow without a DB round trip. Reuses
// SECRETS_ENCRYPTION_KEY (already required for project_secrets encryption, see
// lib/crypto.ts) as the HMAC key rather than introducing a second secret env var — same
// key, different algorithm (HMAC-SHA256 here vs AES-GCM there), both purely server-side.

import { createHmac, timingSafeEqual } from 'crypto'
import type { AdChannelSlug } from './types'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes — plenty for a user to complete the OAuth consent screen

interface OAuthStatePayload {
  userId: string
  projectId: string
  channel: AdChannelSlug
  exp: number
}

function hmacKey(): string {
  const key = process.env.SECRETS_ENCRYPTION_KEY
  if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is not configured — required to sign OAuth state')
  return key
}

function sign(payload: string): string {
  return createHmac('sha256', hmacKey()).update(payload).digest('base64url')
}

export function createOAuthState(userId: string, projectId: string, channel: AdChannelSlug): string {
  const payload: OAuthStatePayload = { userId, projectId, channel, exp: Date.now() + STATE_TTL_MS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = sign(payloadB64)
  return `${payloadB64}.${sig}`
}

export function verifyOAuthState(state: string): { ok: true; payload: OAuthStatePayload } | { ok: false; error: string } {
  const [payloadB64, sig] = (state ?? '').split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'Malformed state' }

  const expectedSig = sign(payloadB64)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: 'Invalid state signature' }
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'Malformed state payload' }
  }
  if (Date.now() > payload.exp) return { ok: false, error: 'State expired — please retry connecting the ad account' }

  return { ok: true, payload }
}
