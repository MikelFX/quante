// Meta (Facebook Login for Business) OAuth — confirmed endpoints, fetched from
// developers.facebook.com/docs/marketing-api/get-started/authorization during this
// implementation step:
//   authorize: https://www.facebook.com/v25.0/dialog/oauth?client_id=...&redirect_uri=...&scope=...
//   token:     https://graph.facebook.com/v25.0/oauth/access_token?client_id=...&redirect_uri=...&client_secret=...&code=...
// v25.0 was the version shown in Meta's own current docs at fetch time — pin via env if
// Meta ships a newer version before this is deployed, rather than hardcoding forever.
//
// Meta issues long-lived tokens, not a refresh-token pair (see qads_ad_accounts.
// refresh_token_enc comment in supabase/migration-qads.sql) — "refreshing" here means
// exchanging the current token for a new long-lived one via grant_type=fb_exchange_token,
// which is the real, documented mechanism for extending a Meta token before expiry.

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

// ads_management + ads_read cover ad account/campaign/adset/ad read+write (confirmed at
// the URL above). business_management is additionally requested for Business Manager
// asset access (Page/Pixel/Catalog ids the ad account form needs) — a very standard
// pairing for this kind of integration, but its exact necessity for every field Qads
// wants (page_id, pixel_id, catalog_id) is an open item to confirm against a real
// Business Manager during app review, per docs/qads-proposal.md §9-style open questions.
const SCOPES = ['ads_management', 'ads_read', 'business_management']

function appId(): string {
  const id = process.env.META_APP_ID
  if (!id) throw new Error('META_APP_ID not configured')
  return id
}
function appSecret(): string {
  const secret = process.env.META_APP_SECRET
  if (!secret) throw new Error('META_APP_SECRET not configured')
  return secret
}
function redirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL not configured')
  return `${appUrl}/api/qads/ad-accounts/meta/callback`
}

export function getMetaOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    scope: SCOPES.join(','),
    state,
  })
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`
}

interface MetaTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
}

interface MetaAdAccount {
  id: string // Graph API returns this prefixed 'act_<numeric_id>'
  name: string
  business?: { id: string }
}

export interface MetaOAuthExchangeResult {
  accessToken: string
  expiresAt?: string
  externalAccountId: string
  businessId?: string
  scopes: string[]
}

export async function exchangeMetaOAuthCode(code: string): Promise<MetaOAuthExchangeResult> {
  const tokenParams = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    client_secret: appSecret(),
    code,
  })
  const tokenRes = await fetch(`${GRAPH_BASE}/oauth/access_token?${tokenParams.toString()}`)
  const tokenJson = (await tokenRes.json()) as MetaTokenResponse & { error?: { message: string } }
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(`Meta OAuth token exchange failed: ${tokenJson.error?.message ?? tokenRes.statusText}`)
  }

  // List ad accounts the user granted access to, and pick the first one. Phase 1 only
  // supports connecting a single Meta ad account per project (schema: UNIQUE(project_id,
  // channel) on qads_ad_accounts) — a real account picker for merchants with multiple ad
  // accounts is a step (j) UI concern, not solved here. Flagged rather than silently
  // assumed to be the right account.
  const accountsRes = await fetch(`${GRAPH_BASE}/me/adaccounts?fields=id,name,business&access_token=${tokenJson.access_token}`)
  const accountsJson = (await accountsRes.json()) as { data?: MetaAdAccount[]; error?: { message: string } }
  if (!accountsRes.ok || !accountsJson.data?.length) {
    throw new Error(`No Meta ad accounts available for this login: ${accountsJson.error?.message ?? 'none returned'}`)
  }
  const account = accountsJson.data[0]
  if (accountsJson.data.length > 1) {
    console.warn(`[qads/meta-oauth] user has ${accountsJson.data.length} ad accounts, defaulting to the first (${account.id}) — no account picker yet`)
  }

  return {
    accessToken: tokenJson.access_token,
    expiresAt: tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString() : undefined,
    externalAccountId: account.id,
    businessId: account.business?.id,
    scopes: SCOPES,
  }
}

export async function refreshMetaToken(currentAccessToken: string): Promise<{ accessToken: string; expiresAt?: string }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId(),
    client_secret: appSecret(),
    fb_exchange_token: currentAccessToken,
  })
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`)
  const json = (await res.json()) as MetaTokenResponse & { error?: { message: string } }
  if (!res.ok || !json.access_token) {
    throw new Error(`Meta token refresh failed: ${json.error?.message ?? res.statusText}`)
  }
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
  }
}

export async function checkMetaPermissions(accessToken: string): Promise<{ ok: boolean; missing: string[] }> {
  const res = await fetch(`${GRAPH_BASE}/me/permissions?access_token=${accessToken}`)
  const json = (await res.json()) as { data?: { permission: string; status: string }[]; error?: { message: string } }
  if (!res.ok || !json.data) return { ok: false, missing: SCOPES }

  const granted = new Set(json.data.filter((p) => p.status === 'granted').map((p) => p.permission))
  const missing = SCOPES.filter((s) => !granted.has(s))
  return { ok: missing.length === 0, missing }
}

export { GRAPH_BASE as META_GRAPH_BASE, GRAPH_VERSION as META_GRAPH_VERSION }
