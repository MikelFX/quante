// Dynamic client registration (RFC 7591) for the Qbox MCP connector (lib/qbox/oauth.ts). Stateless:
// the client id is a signed blob carrying its redirect URIs. Public, no session.
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { oauthSecret, registerClient } from '@/lib/qbox/oauth'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

export async function POST(request: Request) {
  const secret = oauthSecret(process.env)
  if (!secret) return NextResponse.json({ error: 'temporarily_unavailable', error_description: 'Qbox sign-in is not set up.' }, { status: 503, headers: CORS })
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`qbox-oauth-register:${ip}`, 30, 3_600_000).allowed) return NextResponse.json({ error: 'slow_down' }, { status: 429, headers: CORS })
  const body = await request.json().catch(() => null)
  const r = registerClient(secret, body)
  if (!r.ok) return NextResponse.json({ error: 'invalid_redirect_uri', error_description: r.error }, { status: 400, headers: CORS })
  return NextResponse.json({
    client_id: r.clientId,
    client_name: r.client.name,
    redirect_uris: r.client.redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201, headers: CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
