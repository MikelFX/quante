// The site MCP server: POST /api/mcp (JSON-RPC 2.0, Streamable HTTP, stateless JSON responses).
// No key; read tools + request_quote + the paid reads (PAID_MCP_TOOLS, x402 in _meta, lib/agents/mcp.ts). GET answers 405 (no server-sent stream) with a pointer.
import { NextResponse } from 'next/server'
import { handleSiteRpc, type ChangelogEntry, type PaidMcpTool } from '@/lib/agents/mcp'
import { agentRuntime, qboxLlms } from '@/lib/agents/runtime'
import { submitInquiry } from '@/lib/agents/inquiry'
import { getClientIp } from '@/lib/rate-limit'
import { APP_ORIGIN } from '@/lib/domains'
import { AGENT_LINKS } from '@/lib/agents/catalog'
import { mcpPaidCall } from '@/lib/agents/pay-per-call'
import { PRODUCT_MCP_TOOL, productUrl, readProduct } from '@/lib/agents/product-tool'
import { CHECK_MCP_TOOL, COMPANY_MCP_TOOL, COUNTERPARTY_MCP_TOOL, STORE_MCP_TOOL, checkCompany, quickCheck, readStoreProfile, verifyCounterparty } from '@/lib/agents/agent-tools'
import { parseCounterpartyQuery } from '@/lib/agents/counterparty'
import { CompanyInputError, parseCompanyQuery } from '@/lib/agents/company'
import { recordAgentVisit } from '@/lib/agents/visits-record'
import { parseSearch } from '@/lib/agent-shops/model'
import { SHOPS_MCP_TOOL, findProducts } from '@/lib/agent-shops/tool'
import { RegistryUnavailable, listDirectory } from '@/lib/agent-shops/registry'

export const maxDuration = 40

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
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
  recordAgentVisit(req, 'mcp')
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }
  const ip = getClientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  const deps = { rt: agentRuntime(), qboxLlms: qboxLlms(), changelog, inquiry: (a: Record<string, unknown>) => submitInquiry(a, ip, ua), paidTool: (name: PaidMcpTool, a: Record<string, unknown>, meta: unknown) => paidTool(name, a, meta, ip), shops }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleSiteRpc(m, deps)))).filter((x) => x !== null)
    return out.length ? NextResponse.json(out, { headers: CORS }) : new Response(null, { status: 202, headers: CORS })
  }
  const r = await handleSiteRpc(body as never, deps)
  return r === null ? new Response(null, { status: 202, headers: CORS }) : NextResponse.json(r, { headers: CORS })
}

const inputError = (text: string) => ({ isError: true, content: [{ type: 'text', text }] })

/** The free directory of agent-ready stores (null while the registry is not set up). */
async function shops(p: { country: string | null; limit: number; offset: number }) {
  const country = p.country && /^[A-Za-z]{2}$/.test(p.country) ? p.country.toUpperCase() : null
  try {
    return await listDirectory({ ...p, country })
  } catch (e) {
    if (e instanceof RegistryUnavailable) return null
    throw e
  }
}

/** A paid site tool: its input is checked first (a bad input costs nothing), then x402 over MCP. */
async function paidTool(name: PaidMcpTool, a: Record<string, unknown>, meta: unknown, ip: string) {
  if (name === 'check_company') {
    let q
    try {
      q = parseCompanyQuery(a)
    } catch (e) {
      return inputError(e instanceof CompanyInputError ? e.message : 'Send ico and/or vat.')
    }
    return mcpPaidCall(meta, ip, COMPANY_MCP_TOOL, AGENT_LINKS.mcp, () => checkCompany(q))
  }
  if (name === 'verify_counterparty') {
    let q
    try {
      q = parseCounterpartyQuery(a)
    } catch (e) {
      return inputError(e instanceof CompanyInputError ? e.message : 'Send ico and/or vat, optionally account.')
    }
    return mcpPaidCall(meta, ip, COUNTERPARTY_MCP_TOOL, AGENT_LINKS.mcp, () => verifyCounterparty(q))
  }
  if (name === 'find_products') {
    const f = parseSearch(a)
    if (!f.ok) return inputError(f.error)
    return mcpPaidCall(meta, ip, SHOPS_MCP_TOOL, AGENT_LINKS.mcp, () => findProducts(f.value))
  }
  const url = productUrl(a.url)
  if (!url) return inputError('url must be a public http(s) address.')
  if (name === 'profile_store') return mcpPaidCall(meta, ip, STORE_MCP_TOOL, AGENT_LINKS.mcp, () => readStoreProfile(url))
  if (name === 'check_store') return mcpPaidCall(meta, ip, CHECK_MCP_TOOL, AGENT_LINKS.mcp, () => quickCheck(url))
  return mcpPaidCall(meta, ip, PRODUCT_MCP_TOOL, AGENT_LINKS.mcp, () => readProduct(url))
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
