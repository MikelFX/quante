// POST /api/agent/v1/run { language: python|javascript|shell, code, stdin? } — one snippet run once in
// a fresh Qbox sandbox with no network (≤ 40 s, 1 vCPU), then the sandbox is gone
// (lib/agents/agent-tools.ts runOnce). Owner's choice 2026-11-05 ("1–4 at once"). $0.02 a call, x402
// with no account or Bearer qbx_…; not charged when the sandbox can't start. A non-zero exit code is a
// result. For longer work, files or ports use the Qbox sandboxes API. Never on the site MCP server.
import { parseRunOnce, RunInputError } from '@/lib/agents/run-once'
import { RUN_HTTP_TOOL, runOnce } from '@/lib/agents/agent-tools'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 90

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null)
  let input
  try {
    input = parseRunOnce(body)
  } catch (e) {
    return badRequest(e instanceof RunInputError ? e.message : 'Send { "language": "python", "code": "…" }.')
  }
  return paidToolResponse(req, RUN_HTTP_TOOL, `run ${input.language}`, () => runOnce(input))
}

export function OPTIONS() {
  return preflight('POST, OPTIONS')
}
