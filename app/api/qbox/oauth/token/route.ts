// Token endpoint for the Qbox MCP connector (lib/qbox/oauth.ts): authorization_code + PKCE → a
// normal Qbox API key (qbx_…) as the access token. One key per connected client: connecting again
// replaces the old one. Public (the client calls it server-side), no session.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { hashApiKey } from '@/lib/qbox/model'
import { QBOX_BETA } from '@/lib/qbox/limits'
import { QboxNotSetUpError, betaMember } from '@/lib/qbox/store'
import { OAUTH_SCOPE, connectorKeyName, keyForCode, oauthSecret, redeemCode } from '@/lib/qbox/oauth'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const NO_STORE = { ...CORS, 'Cache-Control': 'no-store', Pragma: 'no-cache' }
const fail = (status: number, error: string, error_description: string) => NextResponse.json({ error, error_description }, { status, headers: NO_STORE })

async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const j = await request.json().catch(() => ({}))
    return Object.fromEntries(Object.entries(j && typeof j === 'object' ? j : {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  }
  const text = (await request.text().catch(() => '')).slice(0, 20_000)
  return Object.fromEntries(new URLSearchParams(text))
}

export async function POST(request: Request) {
  const secret = oauthSecret(process.env)
  if (!secret) return fail(503, 'temporarily_unavailable', 'Qbox sign-in is not set up.')
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`qbox-oauth-token:${ip}`, 60, 3_600_000).allowed) return fail(429, 'slow_down', 'Too many requests.')

  const form = await readForm(request)
  const r = redeemCode(secret, form, Date.now())
  if (!r.ok) return fail(400, r.error, r.description)

  let member
  try {
    member = await betaMember(r.userId)
  } catch (e) {
    return fail(503, 'temporarily_unavailable', e instanceof QboxNotSetUpError ? 'Qbox is not set up yet.' : 'Could not check the account.')
  }
  if (!member) return fail(400, 'invalid_grant', 'This account has no Qbox access.')

  const name = connectorKeyName(r.clientName)
  const { count } = await supabaseAdmin.from('qbox_api_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', r.userId).is('revoked_at', null).neq('name', name)
  if ((count ?? 0) >= QBOX_BETA.maxKeys) return fail(400, 'invalid_grant', `At most ${QBOX_BETA.maxKeys} keys. Revoke one on /qbox first.`)

  const key = keyForCode(secret, r.nonce)
  const { data, error } = await supabaseAdmin.from('qbox_api_keys')
    .insert({ user_id: r.userId, name, key_hash: hashApiKey(key), prefix: key.slice(0, 10) }).select('id').single()
  // A unique violation = this code was already exchanged.
  if (error) return error.code === '23505' ? fail(400, 'invalid_grant', 'The code was already used.') : fail(500, 'server_error', 'Could not create the key.')
  // The new connection replaces the client's earlier key (insert first, so a failure never leaves none).
  await supabaseAdmin.from('qbox_api_keys').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', r.userId).eq('name', name).is('revoked_at', null).neq('id', data.id)

  return NextResponse.json({ access_token: key, token_type: 'Bearer', scope: OAUTH_SCOPE }, { headers: NO_STORE })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
