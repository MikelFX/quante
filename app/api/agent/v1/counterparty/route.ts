// GET /api/agent/v1/counterparty?ico=<Czech IČO>&vat=<EU VAT>&account=<bank account> (or POST the same
// as JSON) — "can my person safely pay / invoice this Czech company?": one verdict from ARES, VIES and
// the Czech VAT-payer register (unreliable payer, published accounts), plus whether the given account
// is a published one (lib/agents/counterparty.ts). $0.03 a call, x402 with no account or Bearer qbx_…;
// not charged when no register answers. MCP: `verify_counterparty`.
import { CompanyInputError } from '@/lib/agents/company'
import { parseCounterpartyQuery } from '@/lib/agents/counterparty'
import { COUNTERPARTY_HTTP_TOOL, verifyCounterparty } from '@/lib/agents/agent-tools'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 25

function handle(req: Request, input: { ico?: unknown; vat?: unknown; account?: unknown }) {
  let q
  try {
    q = parseCounterpartyQuery(input)
  } catch (e) {
    return badRequest(e instanceof CompanyInputError ? e.message : 'Send ?ico=… and/or ?vat=…, optionally &account=….')
  }
  return paidToolResponse(req, COUNTERPARTY_HTTP_TOOL, `counterparty ${q.ico ?? ''} ${q.vat ? q.vat.country + q.vat.number : ''}`.trim(), () => verifyCounterparty(q))
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  return handle(req, { ico: p.get('ico'), vat: p.get('vat'), account: p.get('account') })
}

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { ico?: unknown; vat?: unknown; account?: unknown } | null
  return handle(req, body ?? {})
}

export function OPTIONS() {
  return preflight()
}
