// Company check for AI agents (pure, no I/O): a Czech IČO or an EU VAT number → who the company is,
// from the official registers only — ARES (Czech business register, ares.gov.cz) and VIES (the EU
// Commission's VAT check). Agents that onboard suppliers, fill invoices or vet a shop before buying
// call this. lib/agents/company-tool.ts does the two fixed-host requests; this file checks the input
// and reads the answers. Tested in __tests__/agent-tools.test.mjs.

/** EU VAT prefixes VIES answers for (EL = Greece; XI = Northern Ireland). */
export const VIES_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
] as const

/** A Czech IČO: 8 digits whose last one is the mod-11 check digit. */
export function isValidIco(raw: string): boolean {
  if (!/^\d{8}$/.test(raw)) return false
  let sum = 0
  for (let i = 0; i < 7; i++) sum += Number(raw[i]) * (8 - i)
  return (11 - (sum % 11)) % 10 === Number(raw[7])
}

export interface CompanyQuery {
  /** Czech IČO to look up in ARES. */
  ico: string | null
  /** EU VAT number to check in VIES: country prefix + the rest. */
  vat: { country: string; number: string } | null
}

export class CompanyInputError extends Error {}

/**
 * The agent's input → what to ask. `ico` (Czech, 7–8 digits, leading zeros added) and/or `vat`
 * ("CZ27082440", "DE 123456789"). A Czech VAT number of a company is CZ + its IČO, so it is looked
 * up in ARES as well.
 */
export function parseCompanyQuery(input: { ico?: unknown; vat?: unknown }): CompanyQuery {
  let ico: string | null = null
  let vat: CompanyQuery['vat'] = null
  if (input.ico !== undefined && input.ico !== null && input.ico !== '') {
    const s = String(input.ico).replace(/\s/g, '')
    if (!/^\d{1,8}$/.test(s)) throw new CompanyInputError('ico must be a Czech company number (8 digits).')
    const padded = s.padStart(8, '0')
    if (!isValidIco(padded)) throw new CompanyInputError(`${padded} is not a valid IČO (wrong check digit).`)
    ico = padded
  }
  if (input.vat !== undefined && input.vat !== null && input.vat !== '') {
    const s = String(input.vat).toUpperCase().replace(/[\s.\-]/g, '')
    const m = s.match(/^([A-Z]{2})([0-9A-Z+*]{2,12})$/)
    const country = m?.[1] === 'GR' ? 'EL' : m?.[1]
    if (!m || !country || !(VIES_COUNTRIES as readonly string[]).includes(country)) {
      throw new CompanyInputError('vat must be an EU VAT number with its country prefix, e.g. "CZ27082440" or "DE123456789".')
    }
    vat = { country, number: m[2] }
    if (!ico && country === 'CZ' && /^\d{8}$/.test(m[2]) && isValidIco(m[2])) ico = m[2]
  }
  if (!ico && !vat) throw new CompanyInputError('Send "ico" (Czech company number) or "vat" (EU VAT number with country prefix).')
  return { ico, vat }
}

/** ARES legal-form codes agents meet most often (others are returned as their code). */
const LEGAL_FORMS: Record<string, string> = {
  '100': 'sole trader', '101': 'sole trader', '105': 'sole trader', '107': 'sole trader',
  '111': 'general partnership (v.o.s.)', '112': 'limited liability company (s.r.o.)',
  '113': 'limited partnership (k.s.)', '121': 'joint-stock company (a.s.)', '205': 'cooperative (družstvo)',
  '141': 'public benefit company (o.p.s.)', '701': 'association (spolek)', '706': 'association (spolek)',
  '117': 'foundation (nadace)', '118': 'endowment fund (nadační fond)', '325': 'state organisational unit',
  '331': 'state contributory organisation', '801': 'municipality', '804': 'region',
  '931': 'branch of a foreign company', '932': 'branch of a foreign company',
}

export interface AresCompany {
  ico: string
  name: string
  vatId: string | null
  /** Registered for VAT in Czechia (ARES DPH register active). */
  vatRegistered: boolean | null
  legalForm: string | null
  legalFormCode: string | null
  address: string | null
  country: string | null
  founded: string | null
  dissolved: string | null
  active: boolean
  /** "v likvidaci" in the registered name (Czech law requires it once liquidation starts). */
  inLiquidation: boolean
  /** ARES lists a record for it in the insolvency register (ISIR); null when ARES does not say. */
  insolvencyRecord: boolean | null
  /** CZ-NACE activity codes. */
  activities: string[]
}

type Json = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** ARES /ekonomicke-subjekty/{ico} JSON → the company, or null when it is not a company record. */
export function aresCompany(json: unknown): AresCompany | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Json
  const ico = str(j.ico)
  const name = str(j.obchodniJmeno)
  if (!ico || !name) return null
  const sidlo = (j.sidlo && typeof j.sidlo === 'object' ? j.sidlo : {}) as Json
  const regs = (j.seznamRegistraci && typeof j.seznamRegistraci === 'object' ? j.seznamRegistraci : {}) as Json
  const dph = str(regs.stavZdrojeDph)
  const code = str(j.pravniForma)
  const dissolved = str(j.datumZaniku)
  return {
    ico,
    name,
    vatId: str(j.dic),
    vatRegistered: dph ? dph === 'AKTIVNI' : null,
    legalForm: code ? LEGAL_FORMS[code] ?? null : null,
    legalFormCode: code,
    address: str(sidlo.textovaAdresa),
    country: str(sidlo.kodStatu),
    founded: str(j.datumVzniku),
    dissolved,
    active: !dissolved,
    inLiquidation: /\bv\s+likvidaci\b/i.test(name),
    insolvencyRecord: str(regs.stavZdrojeIr) ? regs.stavZdrojeIr === 'AKTIVNI' : null,
    activities: Array.isArray(j.czNace2008) ? j.czNace2008.filter((x): x is string => typeof x === 'string').slice(0, 30)
      : Array.isArray(j.czNace) ? j.czNace.filter((x): x is string => typeof x === 'string').slice(0, 30) : [],
  }
}

export interface ViesCheck {
  vatNumber: string
  /** true = a valid, active EU VAT number; null = the country's register could not be asked now. */
  valid: boolean | null
  name: string | null
  address: string | null
  checkedAt: string | null
  /** When valid is null: why. */
  note: string | null
}

const UNAVAILABLE: Record<string, string> = {
  MS_UNAVAILABLE: "The country's VAT register is not answering right now.",
  MS_MAX_CONCURRENT_REQ: "The country's VAT register is busy right now.",
  GLOBAL_MAX_CONCURRENT_REQ: 'VIES is busy right now.',
  SERVICE_UNAVAILABLE: 'VIES is not answering right now.',
  TIMEOUT: "The country's VAT register did not answer in time.",
}

/** VIES REST /ms/{CC}/vat/{number} JSON → the check. */
export function viesCheck(json: unknown, country: string, number: string): ViesCheck {
  const j = (json && typeof json === 'object' ? json : {}) as Json
  const hidden = (v: unknown) => { const s = str(v); return s && s !== '---' ? s.replace(/\n+/g, ', ') : null }
  const err = str(j.userError)
  const unavailable = err && err in UNAVAILABLE
  return {
    vatNumber: `${country}${number}`,
    valid: unavailable ? null : j.isValid === true,
    name: hidden(j.name),
    address: hidden(j.address),
    checkedAt: str(j.requestDate),
    note: unavailable ? UNAVAILABLE[err] : null,
  }
}
