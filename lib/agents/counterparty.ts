// Counterparty check for AI agents (pure, no I/O): "can my person safely pay this Czech company
// / put it on an invoice?" — one answer from the official registers. Built for invoicing,
// accounts-payable, procurement and onboarding agents, which must do this at EVERY payment:
//   - ARES (company exists, active, not dissolved, not "v likvidaci", record in the insolvency register),
//   - VIES (EU VAT number valid),
//   - the Czech tax administration's VAT-payer register (Finanční správa, "nespolehlivý plátce DPH" +
//     the bank accounts it published — a customer who pays a VAT payer to an unpublished account is
//     liable for that payer's unpaid VAT, § 109 zákona o DPH, so every Czech bookkeeper checks it).
// lib/agents/agent-tools.ts does the fixed-host requests (ARES, VIES REST, the SOAP service at
// adisrws.mfcr.cz); this file checks the input, reads the answers and gives the verdict. Nothing here
// is advice on the law — the output names the facts and which register they come from.
// Tested in __tests__/agent-counterparty.test.mjs.
import { CompanyInputError, parseCompanyQuery, type AresCompany, type ViesCheck } from './company'

// ── bank accounts ───────────────────────────────────────────────────────────────────────────

export interface BankAccount {
  /** CZ IBAN (electronic form, no spaces) — the key every comparison uses. */
  iban: string
  /** Czech domestic form "prefix-number/bank" (prefix left out when 0), null for a foreign IBAN. */
  local: string | null
  country: string
}

const mod97 = (s: string): number => {
  let r = 0
  for (const ch of s) r = (r * 10 + Number(ch)) % 97
  return r
}

/** IBAN check digits per ISO 13616 (letters → 10..35, rearranged, mod 97 == 1). */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  return mod97(digits) === 1
}

/** Czech domestic account (prefix ≤ 6 digits, number ≤ 10, bank code 4) → IBAN "CZkk BBBB PPPPPP NNNNNNNNNN". */
export function czIban(prefix: string, number: string, bank: string): string {
  const bban = bank.padStart(4, '0') + prefix.padStart(6, '0') + number.padStart(10, '0')
  const check = 98 - mod97((bban + '123500').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)))
  return `CZ${String(check).padStart(2, '0')}${bban}`
}

/** "19-2000145399/0800", "2000145399/0800" or an IBAN (spaces allowed) → the account, or null. */
export function parseBankAccount(raw: unknown): BankAccount | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return null
  const local = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/)
  if (local) {
    const prefix = (local[1] ?? '').replace(/^0+/, '')
    const number = local[2].replace(/^0+(?=\d)/, '')
    return { iban: czIban(prefix, number, local[3]), local: `${prefix ? prefix + '-' : ''}${number}/${local[3]}`, country: 'CZ' }
  }
  if (isValidIban(s)) {
    return { iban: s, local: s.startsWith('CZ') ? localFromCzIban(s) : null, country: s.slice(0, 2) }
  }
  return null
}

function localFromCzIban(iban: string): string {
  const bank = iban.slice(4, 8)
  const prefix = iban.slice(8, 14).replace(/^0+/, '')
  const number = iban.slice(14, 24).replace(/^0+(?=\d)/, '')
  return `${prefix ? prefix + '-' : ''}${number}/${bank}`
}

// ── input ───────────────────────────────────────────────────────────────────────────────────

export interface CounterpartyQuery {
  ico: string | null
  vat: { country: string; number: string } | null
  /** The account the person is about to pay, to check against the published ones. */
  account: BankAccount | null
}

/** { ico?, vat?, account? } → the query. Same ico / vat rules as the company check; account optional. */
export function parseCounterpartyQuery(input: { ico?: unknown; vat?: unknown; account?: unknown }): CounterpartyQuery {
  const base = parseCompanyQuery({ ico: input.ico, vat: input.vat })
  let account: BankAccount | null = null
  if (input.account !== undefined && input.account !== null && input.account !== '') {
    account = parseBankAccount(input.account)
    if (!account) throw new CompanyInputError('account must be a Czech bank account ("19-2000145399/0800", "2000145399/0800") or an IBAN.')
  }
  return { ...base, account }
}

// ── the VAT-payer register (SOAP, adisrws.mfcr.cz) ───────────────────────────────────────────

export const VAT_PAYER_SERVICE = 'https://adisrws.mfcr.cz/adistc/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP'

/** The SOAP request for one or more Czech VAT ids (the "CZ" prefix is kept, that is how the service wants them). */
export function vatPayerRequestXml(dics: string[]): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, '')
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:roz="http://adis.mfcr.cz/rozhraniCRPDPH/">'
    + '<soapenv:Header/><soapenv:Body><roz:StatusNespolehlivyPlatceRequest>'
    + dics.map((d) => `<roz:dic>${esc(d)}</roz:dic>`).join('')
    + '</roz:StatusNespolehlivyPlatceRequest></soapenv:Body></soapenv:Envelope>'
}

export interface PublishedAccount extends BankAccount {
  /** When the tax administration published it (YYYY-MM-DD). */
  published: string | null
}

export interface VatPayerStatus {
  vatId: string
  /** reliable = a VAT payer not marked unreliable; unreliable = marked "nespolehlivý plátce"; not_found = not a Czech VAT payer. */
  status: 'reliable' | 'unreliable' | 'not_found'
  unreliableSince: string | null
  /** Code of the tax office (cisloFu). */
  taxOffice: string | null
  /** Bank accounts the payer published for its business (the ones a customer may pay safely). */
  accounts: PublishedAccount[]
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? m[1] : null
}

/** The SOAP answer → one status per VAT id asked. An error status (statusCode ≠ 0) → null. */
export function parseVatPayerStatus(xml: string): VatPayerStatus[] | null {
  if (!xml.includes('StatusNespolehlivyPlatceResponse')) return null
  const status = xml.match(/<(?:\w+:)?status\b[^>]*>/)?.[0]
  if (status && attr(status, 'statusCode') !== '0') return null
  const out: VatPayerStatus[] = []
  const re = /<(?:\w+:)?statusPlatceDPH\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?statusPlatceDPH>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const head = m[1]
    const vatId = attr(head, 'dic') ?? ''
    const flag = attr(head, 'nespolehlivyPlatce')
    const accounts: PublishedAccount[] = []
    const inner = m[2] ?? ''
    const ucet = /<(?:\w+:)?ucet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?ucet>/g
    let u: RegExpExecArray | null
    while ((u = ucet.exec(inner))) {
      const published = attr(u[1], 'datumZverejneni')
      const std = u[2].match(/<(?:\w+:)?standardniUcet\b([^>]*)\/?>/)
      const iban = u[2].match(/<(?:\w+:)?nestandardniUcet\b([^>]*)\/?>/)
      let acc: BankAccount | null = null
      if (std) {
        const number = attr(std[1], 'cislo') ?? ''
        const bank = attr(std[1], 'kodBanky') ?? ''
        if (/^\d{2,10}$/.test(number) && /^\d{4}$/.test(bank)) acc = parseBankAccount(`${attr(std[1], 'predcisli') ? attr(std[1], 'predcisli') + '-' : ''}${number}/${bank}`)
      } else if (iban) {
        acc = parseBankAccount(attr(iban[1], 'cislo') ?? '')
      }
      if (acc) accounts.push({ ...acc, published })
    }
    out.push({
      vatId,
      status: flag === 'ANO' ? 'unreliable' : flag === 'NE' ? 'reliable' : 'not_found',
      unreliableSince: attr(head, 'datumZverejneniNespolehlivosti'),
      taxOffice: attr(head, 'cisloFu'),
      accounts,
    })
  }
  return out
}

// ── the verdict ─────────────────────────────────────────────────────────────────────────────

export type RiskSeverity = 'high' | 'medium' | 'info'

export interface Risk {
  code: string
  severity: RiskSeverity
  /** What the register says, in one sentence. */
  text: string
  source: 'ARES' | 'VIES' | 'Finanční správa' | 'input'
}

export interface CounterpartyVerdict {
  /** true = nothing in the registers speaks against paying; false = at least one high risk; null = the registers could not be asked. */
  safeToPay: boolean | null
  risks: Risk[]
  /** The company as the registers know it (null when not found / not asked). */
  company: AresCompany | null
  vies: ViesCheck | null
  vatPayer: VatPayerStatus | null
  /** The account the person wants to pay, and whether the payer published it. */
  account: (BankAccount & { published: boolean | null; publishedSince: string | null }) | null
  /** Where a person can see the same facts. */
  links: Record<string, string>
  checkedAt: string
}

export interface VerdictInput {
  query: CounterpartyQuery
  /** ARES answer: the company, false = not found, null = ARES unreachable, undefined = not asked. */
  ares: AresCompany | false | null | undefined
  vies: ViesCheck | null | undefined
  /** VAT-payer register: the status, null = unreachable, undefined = not asked (no Czech VAT id). */
  vatPayer: VatPayerStatus | null | undefined
  now?: Date
}

const monthsBetween = (from: string, to: Date): number => {
  const d = new Date(from)
  if (Number.isNaN(d.getTime())) return Infinity
  return (to.getTime() - d.getTime()) / (30.44 * 86_400_000)
}

export function counterpartyVerdict(v: VerdictInput): CounterpartyVerdict {
  const now = v.now ?? new Date()
  const risks: Risk[] = []
  const company = v.ares && typeof v.ares === 'object' ? v.ares : null
  let unknown = false

  if (v.ares === false) risks.push({ code: 'company_not_found', severity: 'high', text: 'No company with this IČO in ARES.', source: 'ARES' })
  if (v.ares === null) { unknown = true; risks.push({ code: 'ares_unavailable', severity: 'info', text: 'ARES is not answering right now; the company could not be checked.', source: 'ARES' }) }
  if (company) {
    if (company.dissolved) risks.push({ code: 'dissolved', severity: 'high', text: `The company was dissolved on ${company.dissolved}.`, source: 'ARES' })
    if (company.inLiquidation) risks.push({ code: 'liquidation', severity: 'high', text: 'The company is in liquidation ("v likvidaci" in its registered name).', source: 'ARES' })
    if (company.insolvencyRecord) risks.push({ code: 'insolvency_record', severity: 'high', text: 'The company has a record in the insolvency register (ISIR); check the proceedings before paying.', source: 'ARES' })
    if (company.founded && monthsBetween(company.founded, now) < 6) risks.push({ code: 'young_company', severity: 'medium', text: `The company was founded on ${company.founded}, less than 6 months ago.`, source: 'ARES' })
    if (company.vatRegistered === false) risks.push({ code: 'not_vat_payer', severity: 'info', text: 'Not registered for VAT in Czechia: invoices must not carry Czech VAT, and the published-account rule does not apply.', source: 'ARES' })
  }

  if (v.ares === undefined && v.vies) risks.push({ code: 'only_vies', severity: 'info', text: 'Not a Czech IČO, so only VIES could be asked: VAT validity, not insolvency, liquidation or published accounts.', source: 'input' })
  if (v.vies) {
    if (v.vies.valid === false) risks.push({ code: 'vat_invalid', severity: 'medium', text: `VIES does not know ${v.vies.vatNumber} as a valid EU VAT number.`, source: 'VIES' })
    if (v.vies.valid === null) risks.push({ code: 'vies_unavailable', severity: 'info', text: v.vies.note ?? 'VIES is not answering right now.', source: 'VIES' })
  }

  if (v.vatPayer === null) { unknown = true; risks.push({ code: 'vat_payer_register_unavailable', severity: 'info', text: 'The Czech VAT-payer register is not answering right now; reliability and published accounts could not be checked.', source: 'Finanční správa' }) }
  const vp = v.vatPayer ?? null
  if (vp?.status === 'unreliable') risks.push({ code: 'unreliable_vat_payer', severity: 'high', text: `Marked an unreliable VAT payer ("nespolehlivý plátce") since ${vp.unreliableSince ?? 'an unknown date'}: a customer paying it is liable for its unpaid VAT.`, source: 'Finanční správa' })

  let account: CounterpartyVerdict['account'] = null
  if (v.query.account) {
    const a = v.query.account
    if (vp && vp.status !== 'not_found') {
      const hit = vp.accounts.find((p) => p.iban === a.iban)
      account = { ...a, published: !!hit, publishedSince: hit?.published ?? null }
      if (!hit) risks.push({ code: 'account_not_published', severity: 'high', text: `The account ${a.local ?? a.iban} is not among the ${vp.accounts.length} account(s) this VAT payer published: paying it makes the customer liable for the payer's unpaid VAT (§ 109 zákona o DPH).`, source: 'Finanční správa' })
    } else {
      account = { ...a, published: null, publishedSince: null }
      if (vp?.status === 'not_found' || company?.vatRegistered === false) risks.push({ code: 'account_check_not_applicable', severity: 'info', text: 'Not a Czech VAT payer, so there is no list of published accounts to compare with.', source: 'Finanční správa' })
      else if (v.vatPayer === undefined) risks.push({ code: 'account_not_checked', severity: 'info', text: 'No Czech VAT id was found for this company, so the account could not be compared with the published ones.', source: 'input' })
    }
  }

  const high = risks.some((r) => r.severity === 'high')
  const safeToPay = high ? false : unknown || !company ? null : true
  const ico = company?.ico ?? v.query.ico
  const links: Record<string, string> = {}
  if (ico) {
    links.ares = `https://ares.gov.cz/ekonomicke-subjekty?ico=${ico}`
    links.insolvencyRegister = `https://isir.justice.cz/isir/ueu/vysledek_lustrace.do?ic=${ico}`
  }
  if (vp?.vatId) links.vatPayerRegister = `https://adisreg.mfcr.cz/adistc/DphReg?id=1&pocet=1&fu=&OK=+Search+&dic=${vp.vatId.replace(/^CZ/, '')}`
  if (v.vies?.vatNumber) links.vies = 'https://ec.europa.eu/taxation_customs/vies/#/vat-validation'

  return { safeToPay, risks, company, vies: v.vies ?? null, vatPayer: vp, account, links, checkedAt: now.toISOString() }
}
