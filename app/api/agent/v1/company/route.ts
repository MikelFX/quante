// GET /api/agent/v1/company?ico=<Czech IČO>&vat=<EU VAT> (or POST { ico, vat }) — a company checked
// in the official registers: ARES (Czech business register) and VIES (EU VAT). $0.01 a call, x402
// with no account or Bearer qbx_…; not charged when the registers can't be reached. A "not found" or
// "invalid VAT" answer is a result. MCP: `check_company`.
import { CompanyInputError, parseCompanyQuery } from '@/lib/agents/company'
import { checkCompany, COMPANY_HTTP_TOOL } from '@/lib/agents/agent-tools'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 20

function handle(req: Request, input: { ico?: unknown; vat?: unknown }) {
  let q
  try {
    q = parseCompanyQuery(input)
  } catch (e) {
    return badRequest(e instanceof CompanyInputError ? e.message : 'Send ?ico=… and/or ?vat=….')
  }
  return paidToolResponse(req, COMPANY_HTTP_TOOL, `company ${q.ico ?? ''} ${q.vat ? q.vat.country + q.vat.number : ''}`.trim(), () => checkCompany(q))
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  return handle(req, { ico: p.get('ico'), vat: p.get('vat') })
}

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { ico?: unknown; vat?: unknown } | null
  return handle(req, body ?? {})
}

export function OPTIONS() {
  return preflight()
}
