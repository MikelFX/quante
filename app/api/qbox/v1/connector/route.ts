// The Qbox MCP connector — public address quantecode.com/qbox/mcp (next.config.ts rewrite). Same
// server as /api/qbox/v1/mcp, but a request without a valid key gets 401 + WWW-Authenticate, so
// MCP clients that take only a URL (claude.ai custom connectors) start the OAuth sign-in
// (lib/qbox/oauth.ts) and then call with the Qbox key it issues. /api/qbox/v1/mcp stays open for
// initialize / tools/list without a key (registries, x402 agents).
import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/qbox/store'
import { requestOrigin, wwwAuthenticate } from '@/lib/qbox/oauth'
import { GET as mcpGet, OPTIONS as mcpOptions, POST as mcpPost } from '../mcp/route'

export const maxDuration = 300

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

async function gate(request: Request): Promise<NextResponse | null> {
  const a = await authenticate(request)
  if (!(a instanceof NextResponse) || a.status !== 401) return null
  const body = await a.json().catch(() => ({ error: 'Sign in to use Qbox.' }))
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: `${body.error ?? 'Unauthorized.'} Connect Qbox again to sign in.` } },
    { status: 401, headers: { ...CORS, 'WWW-Authenticate': wwwAuthenticate(requestOrigin(request)) } },
  )
}

export async function POST(request: Request) {
  return (await gate(request)) ?? mcpPost(request)
}

export async function GET(request: Request) {
  return (await gate(request)) ?? mcpGet()
}

export function OPTIONS() {
  return mcpOptions()
}
