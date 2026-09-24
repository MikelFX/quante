// Shared auth check for every cron endpoint. Server-only.
//
// FAILS CLOSED: if CRON_SECRET is not configured, every request is rejected. The old
// per-route `if (secret) { ... }` pattern left all cron routes public (service-role DB
// access, merchant byrd credentials, Vercel maintenance deploys, emails) whenever the
// env var was missing. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
// automatically once the variable is set on the project; for local runs set it in
// .env.local and send the header by hand.

import { timingSafeEqual } from 'crypto'

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron-auth] CRON_SECRET is not configured — rejecting cron request')
    return false
  }

  const got = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  // timingSafeEqual throws on unequal lengths; the length itself is not secret.
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}
