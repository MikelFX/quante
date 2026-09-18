// TikTok Business API OAuth — NOT the same as TikTok's consumer "Login Kit" (that's a
// different product for TikTok-the-app consumer integrations and does not grant ads
// access). Confirmed via WebSearch during this implementation step (direct fetch to
// business-api.tiktok.com/portal/docs was blocked in this sandbox — see the "OPEN" note
// in ../../types.ts and this repo's standing web-fetch restrictions):
//   authorize: https://business-api.tiktok.com/portal/auth?app_id=...&state=...&redirect_uri=...
//   (redirect carries an `auth_code` query param back to redirect_uri)
//   token:     POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
//              body: { app_id, secret, auth_code }
// Every authenticated v1.3 call after that sends the token in an `Access-Token` request
// header (not Authorization: Bearer) — this is TikTok Business API's own convention,
// distinct from Meta's query-param style. NOT independently re-verified against a live
// TikTok Business Center in this session (no sandbox credentials available) — same open
// item posture as Meta's enum strings, tracked in ../../types.ts and
// docs/qads-proposal.md §9. QADS_LIVE_DEPLOY stays off regardless.

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

// advertiser.write/read cover campaign/adgroup/ad CRUD; reporting.read covers insights.
// Exact scope string spelling is an open item per the note above — these are the
// documented scope names as of this research pass, to be confirmed against a live app
// registration before QADS_LIVE_DEPLOY is ever turned on.
const SCOPES = ['advertiser.write', 'advertiser.read', 'reporting.read']

function appId(): string {
  const id = process.env.TIKTOK_APP_ID
  if (!id) throw new Error('TIKTOK_APP_ID not configured')
  return id
}
function appSecret(): string {
  const secret = process.env.TIKTOK_APP_SECRET
  if (!secret) throw new Error('TIKTOK_APP_SECRET not configured')
  return secret
}
function redirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL not configured')
  return `${appUrl}/api/qads/ad-accounts/tiktok/callback`
}

export function getTiktokOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: appId(),
    state,
    redirect_uri: redirectUri(),
  })
  return `https://business-api.tiktok.com/portal/auth?${params.toString()}`
}

interface TiktokTokenResponse {
  code: number
  message: string
  data?: {
    access_token: string
    advertiser_ids?: string[]
    scope?: string[]
  }
}

export interface TiktokOAuthExchangeResult {
  accessToken: string
  externalAccountId: string
  scopes: string[]
}

export async function exchangeTiktokOAuthCode(authCode: string): Promise<TiktokOAuthExchangeResult> {
  const res = await fetch(`${API_BASE}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId(), secret: appSecret(), auth_code: authCode }),
  })
  const json = (await res.json()) as TiktokTokenResponse
  if (!res.ok || json.code !== 0 || !json.data?.access_token) {
    throw new Error(`TikTok OAuth token exchange failed: ${json.message ?? res.statusText}`)
  }

  // TikTok returns the advertiser ids the auth grant covers directly in the token
  // response (unlike Meta, which needs a separate /me/adaccounts call) — pick the first,
  // same single-ad-account-per-project Phase 1 limitation as Meta's provider (see
  // ../meta/oauth.ts). A real account picker is a step (j) UI concern.
  const advertiserIds = json.data.advertiser_ids ?? []
  if (!advertiserIds.length) {
    throw new Error('TikTok OAuth grant did not include any advertiser (ad account) ids')
  }
  if (advertiserIds.length > 1) {
    console.warn(`[qads/tiktok-oauth] user has ${advertiserIds.length} advertiser ids, defaulting to the first (${advertiserIds[0]}) — no account picker yet`)
  }

  return {
    accessToken: json.data.access_token,
    externalAccountId: advertiserIds[0],
    scopes: json.data.scope ?? SCOPES,
  }
}

// TikTok's long-lived access token does not expire on a fixed schedule the way Meta's
// short-lived token does, and the Business API does not document a refresh-token grant
// type for this flow the way the consumer Login Kit has one (see file header note) — so
// "refresh" here is a no-op that returns the same token, flagged rather than guessed at.
// If TikTok's docs turn out to define one once a human can inspect a live app
// registration, wire it in here; until then qads_ad_accounts.status flips to
// 'needs_reauth' on a 401 from any TikTok call (see client.ts) and the merchant
// re-authorizes via getTiktokOAuthUrl.
export async function refreshTiktokToken(currentAccessToken: string): Promise<{ accessToken: string; expiresAt?: string }> {
  return { accessToken: currentAccessToken }
}

export async function checkTiktokPermissions(accessToken: string, advertiserId: string): Promise<{ ok: boolean; missing: string[] }> {
  const res = await fetch(`${API_BASE}/advertiser/info/?advertiser_ids=${encodeURIComponent(JSON.stringify([advertiserId]))}`, {
    headers: { 'Access-Token': accessToken },
  })
  const json = (await res.json()) as { code: number; message: string; data?: { list?: unknown[] } }
  if (!res.ok || json.code !== 0 || !json.data?.list?.length) {
    return { ok: false, missing: SCOPES }
  }
  // advertiser/info/ succeeding confirms the token is live and scoped to this advertiser —
  // TikTok doesn't expose a granular per-scope introspection endpoint the way Meta's
  // /me/permissions does, so this is the closest equivalent confirmation available.
  return { ok: true, missing: [] }
}

export { API_BASE as TIKTOK_API_BASE, SCOPES as TIKTOK_SCOPES }
