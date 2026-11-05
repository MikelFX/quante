// The site MCP server: POST /api/mcp (JSON-RPC 2.0, Streamable HTTP, stateless JSON responses).
// No key; read tools + request_quote (lib/agents/mcp.ts). GET answers 405 (no server-sent stream) with a pointer.
import { NextResponse } from 'next/server'
import { handleSiteRpc, type ChangelogEntry } from '@/lib/agents/mcp'
import { agentRuntime, qboxLlms } from '@/lib/agents/runtime'
import { submitInquiry } from '@/lib/agents/inquiry'
import { getClientIp } from '@/lib/rate-limit'
import { APP_ORIGIN } from '@/lib/domains'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
}

async function changelog(limit: number): Promise<ChangelogEntry[]> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data } = await supabaseAdmin
      .from('changelog_entries')
      .select('date, title, description, slug')
      .eq('published', true)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data ?? []).map((r: { date: string; title: string; description: string; slug: string | null }) => ({
      date: r.date, title: r.title, description: r.description, url: r.slug ? `${APP_ORIGIN}/changelog#${r.slug}` : `${APP_ORIGIN}/changelog`,
    }))
  } catch {
    return []
  }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }
  const ip = getClientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  const deps = { rt: agentRuntime(), qboxLlms: qboxLlms(), changelog, inquiry: (a: Record<string, unknown>) => submitInquiry(a, ip, ua) }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleSiteRpc(m, deps)))).filter((x) => x !== null)
    return out.length ? NextResponse.json(out, { headers: CORS }) : new Response(null, { status: 202, headers: CORS })
  }
  const r = await handleSiteRpc(body as never, deps)
  return r === null ? new Response(null, { status: 202, headers: CORS }) : NextResponse.json(r, { headers: CORS })
}

export function GET() {
  return NextResponse.json(
    { error: 'This MCP server answers POST (Streamable HTTP, JSON responses).', docs: 'https://assetradigital.agency/agents.md', card: `${APP_ORIGIN}/.well-known/mcp/server-card.json` },
    { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } },
  )
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
