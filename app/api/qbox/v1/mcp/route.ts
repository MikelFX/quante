// Qbox MCP server (Model Context Protocol, Streamable HTTP, stateless JSON responses).
//   POST /api/qbox/v1/mcp   JSON-RPC 2.0: initialize, ping, tools/list, tools/call
//   Header for tools/call:  Authorization: Bearer qbx_…   (initialize / tools/list need no key, so
//   clients and registries can see what Qbox offers before paying)
//
// Tools = lib/qbox/openapi.ts MCP_TOOLS; each one runs the same lib/qbox/actions.ts operation as the
// REST API, with the same limits and billing. A 402 comes back as a tool error whose text carries
// the payment offer (x402 / credits), so the agent knows how to top up.

import { NextResponse } from 'next/server'
import { authorize, createSandbox, execIn, getSandbox, listSandboxes, readFileIn, stopSandbox, writeFileIn, type Caller, type Result } from '@/lib/qbox/actions'
import { pricing } from '@/lib/qbox/billing'
import { paidAccount } from '@/lib/qbox/store'
import { MCP_TOOLS, QBOX_LINKS, PRICE_LINE } from '@/lib/qbox/openapi'

export const maxDuration = 300

const SERVER = { name: 'qbox', title: 'Qbox — sandboxes for AI agents', version: '1.0.0' }
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const rpcResult = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function text(r: Result<unknown>) {
  if (r.ok) return { content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }], structuredContent: r.data as Record<string, unknown> }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(r.body ?? { error: r.error }, null, 2) }] }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Text if the bytes are valid UTF-8 without NULs, else base64. */
function decodeContent(buf: Buffer) {
  const t = buf.toString('utf8')
  return !t.includes('\u0000') && Buffer.from(t, 'utf8').equals(buf) ? { encoding: 'utf8', content: t } : { encoding: 'base64', content: buf.toString('base64') }
}

async function callTool(c: Caller, name: string, a: Record<string, unknown>): Promise<Result<unknown>> {
  const sid = str(a.sandbox_id)
  switch (name) {
    case 'create_sandbox':
      return createSandbox(c, {
        template: a.template,
        timeoutMs: typeof a.timeout_minutes === 'number' ? a.timeout_minutes * 60_000 : undefined,
        vcpus: a.vcpus, ports: a.ports, internet: a.internet,
      })
    case 'run_command':
      return execIn(c, sid, {
        command: a.command, cwd: a.cwd,
        timeoutMs: typeof a.timeout_seconds === 'number' ? a.timeout_seconds * 1000 : undefined,
      })
    case 'write_file': {
      const content = str(a.content)
      const bytes = a.encoding === 'base64' ? new Uint8Array(Buffer.from(content, 'base64')) : new TextEncoder().encode(content)
      return writeFileIn(c, sid, a.path, bytes)
    }
    case 'read_file': {
      const r = await readFileIn(c, sid, a.path)
      return r.ok ? { ok: true, data: { path: r.data.path, ...decodeContent(r.data.content) } } : r
    }
    case 'get_sandbox':
      return getSandbox(c, sid)
    case 'list_sandboxes':
      return listSandboxes(c)
    case 'stop_sandbox':
      return stopSandbox(c, sid)
    case 'get_balance': {
      if (c.member.tier !== 'paid') return { ok: true, data: { plan: 'beta (free, monthly limit)', pricing: pricing() } }
      try {
        return { ok: true, data: { plan: 'paid', balanceVcpuMinutes: (await paidAccount(c.member.userId, Date.now())).balance, pricing: pricing(), topUp: `${QBOX_LINKS.api}/billing` } }
      } catch {
        return { ok: false, status: 503, error: 'Qbox paid access is not set up yet.' }
      }
    }
    default:
      return { ok: false, status: 404, error: `Unknown tool ${name}.` }
  }
}

async function handle(msg: Rpc, request: Request, caller: { c?: Caller | NextResponse }) {
  const { id, method } = msg
  if (msg.jsonrpc !== '2.0' || typeof method !== 'string') return rpcError(id, -32600, 'Invalid JSON-RPC request.')
  const isNotification = id === undefined || id === null
  switch (method) {
    case 'initialize': {
      const asked = str(msg.params?.protocolVersion)
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: `Qbox gives you isolated Linux sandboxes. create_sandbox, then run_command / write_file / read_file, and stop_sandbox when done. ${PRICE_LINE} `
          + `No key yet? An agent can open a paid account itself: POST ${QBOX_LINKS.api}/accounts (x402). Docs: ${QBOX_LINKS.llms}`,
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS })
    case 'tools/call': {
      caller.c ??= await authorize(request)
      if (caller.c instanceof NextResponse) {
        const body = await caller.c.clone().json().catch(() => ({ error: 'Unauthorized.' }))
        return rpcResult(id, { isError: true, content: [{ type: 'text', text: `${body.error ?? 'Unauthorized.'} Get a key: ${QBOX_LINKS.page} or POST ${QBOX_LINKS.api}/accounts (x402).` }] })
      }
      const name = str(msg.params?.name)
      if (!MCP_TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool ${name}.`)
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>
      return rpcResult(id, text(await callTool(caller.c, name, args)))
    }
    default:
      if (isNotification || method.startsWith('notifications/')) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, X-PAYMENT, PAYMENT-SIGNATURE',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export async function POST(request: Request) {
  if (process.env.QBOX_DISABLED === '1') return NextResponse.json(rpcError(null, -32000, 'Qbox is paused. Try again later.'), { status: 503, headers: CORS })
  const body = await request.json().catch(() => undefined)
  if (body === undefined) return NextResponse.json(rpcError(null, -32700, 'Parse error.'), { status: 400, headers: CORS })
  const caller: { c?: Caller | NextResponse } = {}
  if (Array.isArray(body)) {
    if (body.length > 20) return NextResponse.json(rpcError(null, -32600, 'At most 20 messages per batch.'), { status: 400, headers: CORS })
    const out = []
    for (const m of body) {
      const r = await handle(m as Rpc, request, caller)
      if (r) out.push(r)
    }
    return out.length ? NextResponse.json(out, { headers: CORS }) : new NextResponse(null, { status: 202, headers: CORS })
  }
  const r = await handle(body as Rpc, request, caller)
  return r ? NextResponse.json(r, { headers: CORS }) : new NextResponse(null, { status: 202, headers: CORS })
}

/** No server-initiated stream: this server answers every request directly. */
export function GET() {
  return new NextResponse('Qbox MCP server: send JSON-RPC with POST. Docs: ' + QBOX_LINKS.llms, { status: 405, headers: { ...CORS, Allow: 'POST' } })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
