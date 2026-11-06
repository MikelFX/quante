// The paid agent tools beyond the product lookup (server only): store profile, company check,
// quick store check and run-code-once. Each is a PayPerCallTool (its x402 offer + Bazaar listing)
// and a `work` function returning a Work; routes under app/api/agent/v1/* share them, and the site
// MCP server shares the reads (never `run`: the site server runs nothing). Failed work is never
// charged. Page reads go only through Qscan's SSRF-safe fetcher; registers are fixed hosts.
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ScanFetchError, scanFetch } from '@/lib/qscan/fetch'
import { readHome, readProductPage, SwarmError } from '@/lib/qgent/swarm/run'
import { runChecks } from '@/lib/qgent/swarm/checks'
import { SWARM_AGENTS } from '@/lib/qgent/swarm/agents'
import { admitCreate, clipOutput, globalCaps, SANDBOX_HOME } from '@/lib/qbox/model'
import { globalLoad, markEnded, memberSandboxes } from '@/lib/qbox/store'
import { engine } from '@/lib/qbox/vercel'
import { RUN_ONCE, type RunOnceInput } from './run-once'
import { storeProfile } from './store-profile'
import { aresCompany, viesCheck, type CompanyQuery } from './company'
import { counterpartyVerdict, parseVatPayerStatus, VAT_PAYER_SERVICE, vatPayerRequestXml, type CounterpartyQuery, type VatPayerStatus } from './counterparty'
import { CHECK_COMPANY_INPUT, STORE_URL_INPUT, VERIFY_COUNTERPARTY_INPUT } from './mcp'
import type { Work } from './pay-per-call'
import type { PayPerCallTool } from './pay-per-call-offer'

const failed = (status: number, error: string, extra: Record<string, unknown> = {}): Work => ({ ok: false, status, body: { error, ...extra } })
const mcp = (t: PayPerCallTool, toolName: string, inputSchema: Record<string, unknown>, example: Record<string, unknown>): PayPerCallTool => ({
  ...t, call: { method: 'MCP', toolName, description: t.description, inputSchema, example },
})

// ── store profile ───────────────────────────────────────────────────────────────────────────

const STORE_EXAMPLE_URL = 'https://www.allbirds.com'
export const STORE_HTTP_TOOL: PayPerCallTool = {
  tool: 'store',
  description: 'Store home page → contacts, company ids (IČO, EU VAT), address, socials, payment + shipping methods, policy links',
  call: { method: 'GET', query: { url: { description: 'Public store address (home page)', example: STORE_EXAMPLE_URL } } },
  outputExample: {
    url: STORE_EXAMPLE_URL, name: 'Allbirds', platform: 'shopify', language: 'en', currency: 'USD',
    contact: { emails: ['help@allbirds.com'], phones: [], address: null }, company: { legalName: null, ico: [], vatIds: [] },
    payments: ['paypal', 'apple_pay', 'klarna'], shipping: [], policies: { returns: 'https://www.allbirds.com/pages/returns' },
  },
  tags: ['ecommerce', 'lead-generation', 'enrichment', 'contacts', 'kyb'],
  perIpHour: 300,
}
export const STORE_MCP_TOOL = mcp(STORE_HTTP_TOOL, 'profile_store', STORE_URL_INPUT, { url: STORE_EXAMPLE_URL })

async function readPage(url: URL): Promise<{ html: string; url: string } | Work> {
  let res
  try {
    res = await scanFetch(url, { timeoutMs: 12_000, maxBytes: 3 * 1024 * 1024, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' })
  } catch (err) {
    return failed(422, err instanceof ScanFetchError ? err.message : 'Could not read the page.')
  }
  if ([401, 403, 429, 503].includes(res.status)) return failed(422, `The site refused automated reading (HTTP ${res.status}). We don't work around bot protection.`)
  if (res.status !== 200) return failed(422, `The page answered HTTP ${res.status}.`)
  if (!/html/i.test(res.contentType)) return failed(422, 'The address is not an HTML page.')
  return { html: res.body.toString('utf8'), url: res.url }
}

/** One store's home page → its profile (not charged when the HTML says nothing about the store). */
export async function readStoreProfile(url: URL): Promise<Work> {
  const page = await readPage(url)
  if ('ok' in page) return page
  if (page.html.length < 200) return failed(422, 'The page is empty.')
  const p = storeProfile(page.html, page.url)
  const empty = !p.name && !p.contact.emails.length && !p.contact.phones.length && !p.socials.length && !Object.keys(p.policies).length
  if (empty) return failed(422, 'Found nothing about the store in the page\'s HTML (it may be built only by JavaScript). Nothing was charged.', { url: p.url, platform: p.platform })
  return { ok: true, body: { ...p } }
}

// ── company check ───────────────────────────────────────────────────────────────────────────

export const COMPANY_HTTP_TOOL: PayPerCallTool = {
  tool: 'company',
  description: 'Czech IČO and/or EU VAT number → the company in the official registers (ARES, VIES): name, address, legal form, VAT validity',
  call: { method: 'GET', query: {
    ico: { description: 'Czech company number (IČO, 8 digits)', example: '27082440' },
    vat: { description: 'EU VAT number with country prefix', example: 'CZ27082440' },
  } },
  outputExample: {
    ares: { ico: '27082440', name: 'Alza.cz a.s.', vatId: 'CZ27082440', vatRegistered: true, legalForm: 'joint-stock company (a.s.)', address: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7', founded: '2003-08-26', active: true },
    vies: { vatNumber: 'CZ27082440', valid: true, name: 'Alza.cz a.s.' },
  },
  tags: ['kyb', 'company-data', 'vat', 'business-registry', 'eu'],
  perIpHour: 300,
}
export const COMPANY_MCP_TOOL = mcp(COMPANY_HTTP_TOOL, 'check_company', CHECK_COMPANY_INPUT, { ico: '27082440' })

async function getJson(registerUrl: string): Promise<{ status: number; json: unknown } | null> {
  try {
    const res = await fetch(registerUrl, { headers: { accept: 'application/json', 'user-agent': 'QuanteAgentTools/1.0 (+https://quantecode.com/agents)' }, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    return { status: res.status, json: await res.json().catch(() => null) }
  } catch {
    return null
  }
}

/** ARES and/or VIES, side by side. A register that answered "not found" / "invalid" is a result. */
export async function checkCompany(q: CompanyQuery): Promise<Work> {
  const [ares, vies] = await Promise.all([
    q.ico ? getJson(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${q.ico}`) : null,
    q.vat ? getJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${q.vat.country}/vat/${encodeURIComponent(q.vat.number)}`) : null,
  ])
  const body: Record<string, unknown> = { query: { ico: q.ico, vat: q.vat ? `${q.vat.country}${q.vat.number}` : null } }
  let answered = false
  if (q.ico) {
    if (ares && ares.status === 200 && aresCompany(ares.json)) { body.ares = aresCompany(ares.json); answered = true }
    else if (ares && (ares.status === 404 || ares.status === 400)) { body.ares = { found: false, note: 'No company with this IČO in ARES.' }; answered = true }
    else body.ares = { found: null, note: 'ARES is not answering right now.' }
  }
  if (q.vat) {
    const v = vies && vies.status === 200 ? viesCheck(vies.json, q.vat.country, q.vat.number) : null
    if (v && v.valid !== null) answered = true
    body.vies = v ?? { vatNumber: `${q.vat.country}${q.vat.number}`, valid: null, note: 'VIES is not answering right now.' }
  }
  if (!answered) return failed(503, 'The registers are not answering right now. Nothing was charged; try again in a minute.', body)
  return { ok: true, body }
}

// ── counterparty check ──────────────────────────────────────────────────────────────────────

export const COUNTERPARTY_HTTP_TOOL: PayPerCallTool = {
  tool: 'counterparty',
  description: 'Can I safely pay / invoice this Czech company? One verdict from the official registers: ARES (exists, active, liquidation, insolvency record), VIES (VAT valid), the tax administration\'s VAT-payer register (unreliable payer, published bank accounts) and whether the account you are about to pay is a published one',
  call: { method: 'GET', query: {
    ico: { description: 'Czech company number (IČO, 8 digits)', example: '27082440' },
    vat: { description: 'EU VAT number with country prefix', example: 'CZ27082440' },
    account: { description: 'The bank account you are about to pay: "19-2000145399/0800", "2000145399/0800" or an IBAN', example: '2000145399/0800' },
  } },
  outputExample: {
    safeToPay: true, risks: [],
    company: { ico: '27082440', name: 'Alza.cz a.s.', vatId: 'CZ27082440', vatRegistered: true, active: true, inLiquidation: false, insolvencyRecord: false },
    vies: { vatNumber: 'CZ27082440', valid: true },
    vatPayer: { vatId: 'CZ27082440', status: 'reliable', unreliableSince: null, accounts: [{ iban: 'CZ6508000000192000145399', local: '19-2000145399/0800', published: '2013-04-01' }] },
    account: { iban: 'CZ6508000000192000145399', local: '19-2000145399/0800', published: true, publishedSince: '2013-04-01' },
    links: { ares: 'https://ares.gov.cz/ekonomicke-subjekty?ico=27082440' },
  },
  tags: ['kyb', 'accounts-payable', 'invoicing', 'vat', 'compliance', 'czech', 'business-registry'],
  perIpHour: 300,
}
export const COUNTERPARTY_MCP_TOOL = mcp(COUNTERPARTY_HTTP_TOOL, 'verify_counterparty', VERIFY_COUNTERPARTY_INPUT, { ico: '27082440', account: '2000145399/0800' })

/** The Czech VAT-payer register (SOAP, fixed host), one retry. null = unreachable or an error answer. */
async function vatPayerStatus(vatId: string, attempt = 0): Promise<VatPayerStatus | null> {
  try {
    const res = await fetch(VAT_PAYER_SERVICE, {
      method: 'POST',
      headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""', 'user-agent': 'QuanteAgentTools/1.0 (+https://quantecode.com/agents)' },
      body: vatPayerRequestXml([vatId]),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) return attempt === 0 ? vatPayerStatus(vatId, 1) : null
    const parsed = parseVatPayerStatus(await res.text())
    return parsed?.find((p) => p.vatId === vatId) ?? parsed?.[0] ?? null
  } catch {
    return attempt === 0 ? vatPayerStatus(vatId, 1) : null
  }
}

/** ARES + VIES + the VAT-payer register, then the verdict. Charged only when at least one register answered. */
export async function verifyCounterparty(q: CounterpartyQuery): Promise<Work> {
  const [aresRes, viesRes] = await Promise.all([
    q.ico ? getJson(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${q.ico}`) : null,
    q.vat ? getJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${q.vat.country}/vat/${encodeURIComponent(q.vat.number)}`) : null,
  ])
  const ares = !q.ico ? undefined
    : aresRes && aresRes.status === 200 && aresCompany(aresRes.json) ? aresCompany(aresRes.json)
    : aresRes && (aresRes.status === 404 || aresRes.status === 400) ? false
    : null
  const vies = q.vat ? (viesRes && viesRes.status === 200 ? viesCheck(viesRes.json, q.vat.country, q.vat.number) : { vatNumber: `${q.vat.country}${q.vat.number}`, valid: null, name: null, address: null, checkedAt: null, note: 'VIES is not answering right now.' }) : undefined
  // The Czech VAT id: from the input, or the one ARES knows.
  const czVat = q.vat?.country === 'CZ' ? `CZ${q.vat.number}` : ares && typeof ares === 'object' && ares.vatId?.startsWith('CZ') ? ares.vatId : null
  const vatPayer = czVat ? await vatPayerStatus(czVat) : undefined
  const answered = (ares !== null && ares !== undefined) || (vies !== undefined && vies.valid !== null) || (vatPayer !== null && vatPayer !== undefined)
  if (!answered) return failed(503, 'The registers are not answering right now. Nothing was charged; try again in a minute.')
  return { ok: true, body: { query: { ico: q.ico, vat: q.vat ? `${q.vat.country}${q.vat.number}` : null, account: q.account?.local ?? q.account?.iban ?? null }, ...counterpartyVerdict({ query: q, ares, vies, vatPayer }) } }
}

// ── quick store check ───────────────────────────────────────────────────────────────────────

export const CHECK_HTTP_TOOL: PayPerCallTool = {
  tool: 'check',
  description: 'Quick rule-based check of an online store (home + one product page): findings with severity and why, no AI',
  call: { method: 'GET', query: { url: { description: 'Public store address (home page)', example: STORE_EXAMPLE_URL } } },
  outputExample: {
    url: STORE_EXAMPLE_URL, productPage: 'https://www.allbirds.com/products/mens-tree-runners', counts: { high: 0, medium: 1, low: 2 },
    findings: [{ agent: 'accessibility', agentName: 'Accessibility', severity: 'medium', title: '6 images have no alt text', why: 'Screen readers and search engines can’t tell what they show.', where: null }],
  },
  tags: ['ecommerce', 'audit', 'seo', 'conversion', 'accessibility'],
  perIpHour: 120,
}
export const CHECK_MCP_TOOL = mcp(CHECK_HTTP_TOOL, 'check_store', STORE_URL_INPUT, { url: STORE_EXAMPLE_URL })

/** The Qgent rule checks (no model) over a store's home page and one product page. */
export async function quickCheck(url: URL): Promise<Work> {
  let home
  try {
    home = await readHome(url.toString())
  } catch (err) {
    return failed(422, err instanceof SwarmError ? err.message : 'Could not read the page.')
  }
  if (home.layers.length < 3) return failed(422, 'The page has almost no content in its HTML (it may be built only by JavaScript), so there is nothing to check.')
  const product = await readProductPage(home)
  const names = new Map(SWARM_AGENTS.map((a) => [a.id, a.role]))
  const findings = runChecks(home.facts, home.layers, product?.facts ?? null, 'en').map((f) => ({
    agent: f.agent,
    agentName: names.get(f.agent) ?? f.agent,
    severity: f.severity,
    title: f.title,
    why: f.why,
    suggestion: f.after || null,
    where: f.layer ? home.layers.find((l) => l.id === f.layer)?.text ?? null : null,
  }))
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
  return { ok: true, body: { url: home.url, productPage: product?.url ?? null, counts, findings, note: 'Rule-based checks only. For the full review by 20 AI agents use POST /api/agent/v1/review.' } }
}

// ── run code once ───────────────────────────────────────────────────────────────────────────

export const RUN_HTTP_TOOL: PayPerCallTool = {
  tool: 'run',
  description: 'Run one Python / JavaScript / shell snippet once in a fresh sandbox with no network (≤ 40 s, 1 vCPU): stdout, stderr, exit code',
  call: { method: 'POST', body: {
    language: { type: 'string', description: 'python | javascript | shell', example: 'python' },
    code: { type: 'string', description: 'The code to run (max 20000 characters)', example: 'print(sum(range(10)))' },
    stdin: { type: 'string', description: 'Optional standard input', example: '' },
  } },
  outputExample: { language: 'python', exitCode: 0, stdout: '45\n', stderr: '', truncated: false, timedOut: false, durationMs: 41 },
  tags: ['code-execution', 'sandbox', 'python', 'javascript', 'compute'],
  perIpHour: 120,
}

/**
 * One snippet in a fresh Qbox sandbox with NO network; the sandbox is stopped either way. Same
 * guards as every Qbox sandbox: QBOX_DISABLED, global concurrency + the daily vCPU budget, and the
 * qbox_sandboxes row is written before the engine spends anything. No secret goes in (env {}).
 */
export async function runOnce(input: RunOnceInput): Promise<Work> {
  if (process.env.QBOX_DISABLED === '1') return failed(503, 'Qbox is paused. Try again later.')
  const now = Date.now()
  let rows, load
  try {
    ;[rows, load] = await Promise.all([memberSandboxes(RUN_ONCE.userId, now), globalLoad(now)])
  } catch {
    return failed(503, 'Running code is not set up yet.')
  }
  const admit = admitCreate(rows, { maxConcurrent: RUN_ONCE.concurrent, monthlyMinutes: Infinity, vcpus: RUN_ONCE.vcpus }, RUN_ONCE.lifetimeMs, now, load, globalCaps(process.env))
  if (!admit.ok) return failed(503, admit.status === 429 ? 'Too many runs right now. Try again in a minute.' : admit.error)

  const id = randomUUID()
  const { error } = await supabaseAdmin.from('qbox_sandboxes').insert({
    id, user_id: RUN_ONCE.userId, key_id: null, created_at: new Date(now).toISOString(), expires_at: new Date(now + RUN_ONCE.lifetimeMs).toISOString(),
    status: 'running', engine: engine().name, template: input.template, ports: [], metadata: { kind: 'x402-run-once', language: input.language },
    vcpus: RUN_ONCE.vcpus, billed: false,
  })
  if (error) return failed(503, 'Running code is not set up yet.')

  try {
    await engine().create({ id, template: input.template, timeoutMs: RUN_ONCE.lifetimeMs, ports: [], network: 'none', env: {}, vcpus: RUN_ONCE.vcpus, tags: { sandbox: id, tier: 'x402-run' } })
  } catch (e) {
    await markEnded(id, 'failed', String((e as Error)?.message ?? e))
    return failed(502, 'The sandbox could not be started. Nothing was charged; try again.')
  }
  const started = Date.now()
  try {
    let cmd = input.cmd
    let args = input.args
    if (input.stdin !== null) {
      const path = `${SANDBOX_HOME}/.stdin`
      await engine().writeFile(id, path, new TextEncoder().encode(input.stdin))
      args = ['-c', `exec "$@" < ${path}`, 'sh', cmd, ...args]
      cmd = 'sh'
    }
    const r = await engine().exec(id, { cmd, args, env: {}, timeoutMs: RUN_ONCE.execMs })
    const out = clipOutput(r.stdout)
    const err = clipOutput(r.stderr)
    return {
      ok: true,
      body: { language: input.language, exitCode: r.exitCode, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, timedOut: r.timedOut, durationMs: Date.now() - started },
    }
  } catch {
    return failed(502, 'The code could not be run. Nothing was charged; try again.')
  } finally {
    await engine().kill(id).catch(() => {})
    await markEnded(id, 'stopped')
  }
}
