// Server-only. Never import this module in client code.

const BASE =
  process.env.NAMECHEAP_SANDBOX === 'true'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response'

function commonParams(): Record<string, string> {
  const apiUser = process.env.NAMECHEAP_API_USER ?? ''
  const apiKey = process.env.NAMECHEAP_API_KEY ?? ''
  const clientIp = process.env.NAMECHEAP_CLIENT_IP ?? ''
  // Fail closed — never send a half-configured request to the registrar.
  if (!apiUser || !apiKey || !clientIp) {
    console.error('[namecheap] NAMECHEAP_API_USER / NAMECHEAP_API_KEY / NAMECHEAP_CLIENT_IP not configured')
    throw new Error('Namecheap is not configured')
  }
  return {
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
  }
}

async function callApi(command: string, extra: Record<string, string>): Promise<string> {
  const params = new URLSearchParams({ ...commonParams(), Command: command, ...extra })
  const res = await fetch(`${BASE}?${params}`, { method: 'GET' })
  if (!res.ok) throw new Error(`Namecheap HTTP ${res.status}`)
  return res.text()
}

/** Namecheap answered (HTTP 200) but the XML payload says Status="ERROR". */
export class NamecheapApiError extends Error {
  constructor(message: string, readonly errNumber: string) {
    super(message)
    this.name = 'NamecheapApiError'
  }
}

// Parse <ApiResponse Status="ERROR"> and extract ErrCount/Errors
function checkError(xml: string): void {
  if (xml.includes('Status="ERROR"') || xml.includes("Status='ERROR'")) {
    const msgMatch = xml.match(/<Error Number="(\d+)">(.*?)<\/Error>/)
    const errNumber = msgMatch?.[1] ?? 'unknown'
    const errMessage = msgMatch?.[2] ?? 'Namecheap API error'
    // Logged deliberately (not swallowed) — the caller in app/api/domains/search/route.ts
    // uses Promise.allSettled and treats every rejection here as "just unavailable", so
    // without this log line a real auth/whitelist/config problem on Namecheap's side is
    // invisible end-to-end: the HTTP call to api.namecheap.com still returns 200, only the
    // XML payload inside says ERROR. Common causes for Number 1011102 / 1010900 series:
    // API access not enabled on the account, or the calling IP is not on the account's
    // Namecheap whitelist (Profile > Tools > Business & Dev Tools > API Access).
    console.error(`[namecheap] API error ${errNumber}: ${errMessage}`)
    throw new NamecheapApiError(errMessage, errNumber)
  }
}

// ─── Domain names ─────────────────────────────────────────────────────────
// The TLDs Quante actually sells (the ones the search UI suggests). Purchases
// are restricted to these: other TLDs have registry rules (nexus, local
// presence, ...) we don't collect data for, so they would fail AFTER payment.
// .ai is deliberately NOT here: it has a 2-year minimum term, while pricing and
// registerDomain() (called with Years=1 by the Stripe webhook) are 1-year only —
// a .ai sale would be charged and then fail at the registrar.
export const SUPPORTED_TLDS = ['com', 'cz', 'sk', 'eu', 'app', 'io', 'shop', 'store'] as const

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD_RE = /^[a-z]{2,63}$/

/**
 * Normalizes user input into a bare hostname (lowercase, no protocol / path /
 * port / trailing dot) and validates every label. Returns null when the input
 * is not a syntactically valid hostname with at least two labels.
 */
export function normalizeHostname(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let host = input.trim().toLowerCase()
  if (host.length === 0 || host.length > 300) return null
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split(/[/?#]/)[0] ?? ''
  host = host.replace(/:\d+$/, '').replace(/\.$/, '')
  if (host.length === 0 || host.length > 253) return null
  const labels = host.split('.')
  if (labels.length < 2) return null
  if (!labels.every((l) => LABEL_RE.test(l))) return null
  if (!TLD_RE.test(labels[labels.length - 1]!)) return null
  return host
}

/**
 * A domain Quante can register: exactly `name.tld` with a supported TLD.
 * Returns the normalized domain or null.
 */
export function parseRegistrableDomain(input: unknown): string | null {
  const host = normalizeHostname(input)
  if (!host) return null
  const labels = host.split('.')
  if (labels.length !== 2) return null
  if (!(SUPPORTED_TLDS as readonly string[]).includes(labels[1]!)) return null
  return host
}

// ─── Availability + pricing ───────────────────────────────────────────────

export interface DomainCheckResult {
  domain: string
  available: boolean
  price: number // USD, already marked up
  currency: 'USD'
  /** Premium / early-access names are never sold at the standard price. */
  premium?: boolean
}

/** Server-only quote: includes what the registration costs Quante. */
export interface DomainQuote extends DomainCheckResult {
  rawCost: number // USD, Namecheap's price to us (incl. ICANN fee)
}

const DEFAULT_MARKUP = 1.35

// Validated once per call — a typo in the env var must never produce a NaN
// or below-cost price.
function getMarkup(): number {
  const raw = process.env.DOMAIN_MARKUP_MULTIPLIER
  if (raw === undefined || raw === '') return DEFAULT_MARKUP
  const m = Number(raw)
  if (!Number.isFinite(m) || m < 1 || m > 10) {
    console.error(`[namecheap] invalid DOMAIN_MARKUP_MULTIPLIER "${raw}" — using ${DEFAULT_MARKUP}`)
    return DEFAULT_MARKUP
  }
  return m
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) out[m[1]!] = m[2]!
  return out
}

// Pricing changes rarely; cache per TLD so a search costs one domains.check
// call instead of 1 + N getPricing calls. Only successful lookups are cached.
// (Purchases always re-fetch with freshPricing, so the cache only affects display.)
const PRICE_CACHE_TTL_MS = 6 * 3600 * 1000
const priceCache = new Map<string, { raw: number; at: number }>()

// Namecheap's 1-year registration cost for a TLD, in USD. THROWS when the
// price can't be determined — there is deliberately no fallback price, since
// a guessed price means selling domains below what Namecheap charges us.
async function getRawRegistrationPrice(tld: string, fresh = false): Promise<number> {
  const cached = priceCache.get(tld)
  if (!fresh && cached && Date.now() - cached.at < PRICE_CACHE_TTL_MS) return cached.raw

  const xml = await callApi('namecheap.users.getPricing', {
    ProductType: 'DOMAIN',
    ProductCategory: 'REGISTER',
    ActionName: 'REGISTER',
    ProductName: tld,
  })
  checkError(xml)

  // Scope to <Product Name="tld"> ... </Product> when present.
  let scope = xml
  const tldPattern = tld.replace(/[^a-z0-9-]/gi, (c) => `\\${c}`)
  const productRe = new RegExp(`<Product\\b[^>]*\\bName="${tldPattern}"[^>]*>([\\s\\S]*?)</Product>`, 'i')
  const productMatch = xml.match(productRe)
  if (productMatch) scope = productMatch[1]!

  const oneYear = [...scope.matchAll(/<Price\b[^>]*>/gi)]
    .map((m) => parseAttrs(m[0]))
    .filter((a) => a.Duration === '1' && (!a.DurationType || a.DurationType.toUpperCase() === 'YEAR'))
  if (!productMatch && oneYear.length !== 1) {
    throw new Error(`Namecheap pricing for .${tld} is ambiguous`)
  }
  // If several 1-year rows exist, charge from the most expensive one.
  const attrs = oneYear.sort((a, b) => (Number(b.YourPrice) || 0) - (Number(a.YourPrice) || 0))[0]
  if (!attrs) throw new Error(`No 1-year Namecheap price for .${tld}`)
  if (attrs.Currency && attrs.Currency.toUpperCase() !== 'USD') {
    throw new Error(`Unexpected Namecheap pricing currency ${attrs.Currency} for .${tld}`)
  }

  const yourPrice = Number(attrs.YourPrice)
  // Namecheap spells it "YourAdditonalCost" (sic); accept both spellings.
  const additional = Number(attrs.YourAdditonalCost ?? attrs.YourAdditionalCost ?? attrs.AdditionalCost ?? '0')
  const raw = yourPrice + (Number.isFinite(additional) && additional > 0 ? additional : 0)
  if (!Number.isFinite(yourPrice) || yourPrice <= 0 || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Unparseable Namecheap price for .${tld}`)
  }

  priceCache.set(tld, { raw, at: Date.now() })
  return raw
}

function toRetailPrice(rawCost: number): number {
  const markedUp = rawCost * getMarkup()
  // Round to .99, but never below cost.
  let price = Math.floor(markedUp) + 0.99
  if (price < rawCost) price = Math.ceil(rawCost) + 0.99
  return Math.round(price * 100) / 100
}

// One namecheap.domains.check call → <DomainCheckResult> attributes by domain.
async function domainsCheckCall(domains: string[]): Promise<Map<string, Record<string, string>>> {
  const xml = await callApi('namecheap.domains.check', { DomainList: domains.join(',') })
  checkError(xml)
  const byDomain = new Map<string, Record<string, string>>()
  for (const m of xml.matchAll(/<DomainCheckResult\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    if (attrs.Domain) byDomain.set(attrs.Domain.toLowerCase(), attrs)
  }
  return byDomain
}

// Batched check that degrades gracefully: Namecheap fails the WHOLE request with
// Status="ERROR" when a single name is refused (a registry-specific label rule,
// say), so on an API-level error we re-check each name on its own and only the
// offending one becomes an Error. HTTP / configuration failures are rethrown —
// retrying them per name would just burn API quota.
async function checkDomainsRaw(domains: string[]): Promise<Map<string, Record<string, string> | Error>> {
  const out = new Map<string, Record<string, string> | Error>()
  try {
    const byDomain = await domainsCheckCall(domains)
    for (const d of domains) {
      const attrs = byDomain.get(d.toLowerCase())
      if (attrs) out.set(d.toLowerCase(), attrs)
    }
    return out
  } catch (err) {
    if (domains.length === 1 || !(err instanceof NamecheapApiError)) throw err
    console.warn(`[namecheap] batched domains.check failed (${err.errNumber}) — retrying per domain`)
  }
  const settled = await Promise.allSettled(domains.map((d) => domainsCheckCall([d])))
  domains.forEach((d, i) => {
    const r = settled[i]!
    const key = d.toLowerCase()
    if (r.status === 'rejected') {
      out.set(key, r.reason instanceof Error ? r.reason : new Error(String(r.reason)))
    } else {
      const attrs = r.value.get(key)
      if (attrs) out.set(key, attrs)
    }
  })
  return out
}

/**
 * Registry-level registration status only (no pricing). true = someone holds
 * the name; false = unregistered (including premium names that are still for
 * sale). Throws when Namecheap can't answer.
 */
export async function isDomainRegistered(domain: string): Promise<boolean> {
  const checks = await checkDomainsRaw([domain])
  const attrs = checks.get(domain.toLowerCase())
  if (!attrs) throw new Error(`No check result for ${domain}`)
  if (attrs instanceof Error) throw attrs
  if (attrs.ErrorNo && attrs.ErrorNo !== '0') throw new Error(`Namecheap check error ${attrs.ErrorNo} for ${domain}`)
  const flag = attrs.Available?.toLowerCase()
  if (flag !== 'true' && flag !== 'false') throw new Error(`Unparseable availability for ${domain}`)
  return flag === 'false'
}

/**
 * Checks up to 50 domains with ONE namecheap.domains.check call, then prices
 * each (per-TLD pricing is cached unless `freshPricing`). Premium and
 * early-access (EAP) names come back as unavailable — registerDomain() only
 * ever pays the standard price, so selling them would either lose money or
 * fail after the customer paid. A rejected entry means we couldn't check or
 * price that domain; callers must treat it as not purchasable.
 */
export async function checkDomainsAvailability(
  domains: string[],
  opts: { freshPricing?: boolean } = {},
): Promise<PromiseSettledResult<DomainQuote>[]> {
  if (domains.length === 0) return []
  if (domains.length > 50) throw new Error('Too many domains in one check')

  const checks = await checkDomainsRaw(domains)

  const tlds = [...new Set(domains.map((d) => d.split('.').slice(1).join('.')))]
  const priceResults = await Promise.allSettled(
    tlds.map((t) => getRawRegistrationPrice(t, opts.freshPricing)),
  )
  const priceByTld = new Map<string, PromiseSettledResult<number>>()
  tlds.forEach((t, i) => priceByTld.set(t, priceResults[i]!))

  return domains.map((domain): PromiseSettledResult<DomainQuote> => {
    const checked = checks.get(domain.toLowerCase())
    if (!checked) return { status: 'rejected', reason: new Error(`No check result for ${domain}`) }
    if (checked instanceof Error) return { status: 'rejected', reason: checked }
    const attrs = checked
    if (attrs.ErrorNo && attrs.ErrorNo !== '0') {
      return { status: 'rejected', reason: new Error(`Namecheap check error ${attrs.ErrorNo} for ${domain}`) }
    }
    const tld = domain.split('.').slice(1).join('.')
    const priced = priceByTld.get(tld)
    if (!priced || priced.status === 'rejected') {
      return { status: 'rejected', reason: priced?.reason ?? new Error(`No price for ${domain}`) }
    }

    const premium =
      attrs.IsPremiumName?.toLowerCase() === 'true' ||
      Number(attrs.PremiumRegistrationPrice ?? '0') > 0 ||
      Number(attrs.EapFee ?? '0') > 0
    const available = attrs.Available?.toLowerCase() === 'true' && !premium
    const rawCost = priced.value

    return {
      status: 'fulfilled',
      value: {
        domain,
        available,
        price: toRetailPrice(rawCost),
        currency: 'USD',
        ...(premium ? { premium: true } : {}),
        rawCost,
      },
    }
  })
}

/** Single-domain check. Throws when availability or pricing can't be determined. */
export async function checkDomainAvailability(
  domain: string,
  opts: { freshPricing?: boolean } = {},
): Promise<DomainQuote> {
  const [result] = await checkDomainsAvailability([domain], opts)
  if (!result) throw new Error(`No check result for ${domain}`)
  if (result.status === 'rejected') throw result.reason
  return result.value
}

// ─── Registrant contact ───────────────────────────────────────────────────
// The registrant is the actual customer buying the domain — WHOIS records are
// a legal record of ownership, and registrars (Namecheap included) reject
// registrations with incomplete or obviously fake contact data on most TLDs.
// This used to fall back to fixed company data read from env vars; that's
// gone now — every real registration requires the customer's own data,
// collected in the purchase form and validated before the Stripe charge.
//
// Types + validateRegistrant() live in lib/domain-registrant.ts (no
// Namecheap API calls or secrets there) so the same validation logic can run
// client-side, in the API route, and here — without ever importing this
// server-only module into client code.
import { type DomainRegistrant, validateRegistrant } from '@/lib/domain-registrant'
export type { DomainRegistrant }
export { validateRegistrant }

function toNamecheapContactFields(registrant: DomainRegistrant): Record<string, string> {
  return {
    FirstName: registrant.firstName.trim(),
    LastName: registrant.lastName.trim(),
    Address1: registrant.address1.trim(),
    City: registrant.city.trim(),
    StateProvince: registrant.stateProvince.trim() || registrant.city.trim(),
    PostalCode: registrant.postalCode.trim(),
    Country: registrant.country.trim().toUpperCase(),
    Phone: registrant.phone.trim(),
    EmailAddress: registrant.email.trim(),
  }
}

export async function registerDomain(
  domain: string,
  registrant: DomainRegistrant,
  years: number = 1,
): Promise<{ orderId: string }> {
  const validationError = validateRegistrant(registrant, domain)
  if (validationError) {
    // Defense in depth — the API route validates too, but registerDomain()
    // must never silently register a domain with bad/missing WHOIS data
    // even if some future caller forgets to validate first.
    throw new Error(`Invalid registrant data: ${validationError}`)
  }
  // Same defense in depth for the name itself: only plain `name.tld` on a TLD
  // we sell (the purchase route enforces this before charging).
  if (parseRegistrableDomain(domain) !== domain) {
    throw new Error(`Refusing to register unsupported domain "${domain}"`)
  }
  if (!Number.isInteger(years) || years < 1 || years > 10) {
    throw new Error(`Invalid registration period: ${years}`)
  }

  const parts = domain.split('.')
  const sld = parts[0] ?? ''
  const tld = parts.slice(1).join('.')

  const contact = toNamecheapContactFields(registrant)
  const contactParams: Record<string, string> = {}
  for (const role of ['Registrant', 'Tech', 'Admin', 'AuxBilling']) {
    for (const [field, value] of Object.entries(contact)) {
      contactParams[`${role}${field}`] = value
    }
  }

  const xml = await callApi('namecheap.domains.create', {
    DomainName: sld,
    TLD: tld,
    Years: String(years),
    ...contactParams,
    // Enable WhoisGuard privacy protection
    AddFreeWhoisguard: 'yes',
    WGEnabled: 'yes',
  })
  checkError(xml)

  const orderIdMatch = xml.match(/OrderID="(\d+)"/)
  const orderId = orderIdMatch?.[1] ?? crypto.randomUUID()
  return { orderId }
}

// Point a freshly registered domain at Vercel. Replaces ALL host records —
// only call this on domains Quante just registered, never on user-managed DNS.
export async function setDnsToVercel(domain: string): Promise<void> {
  if (parseRegistrableDomain(domain) !== domain) {
    throw new Error(`Refusing to set DNS for unsupported domain "${domain}"`)
  }
  const parts = domain.split('.')
  const sld = parts[0] ?? ''
  const tld = parts.slice(1).join('.')

  const xml = await callApi('namecheap.domains.dns.setHosts', {
    SLD: sld,
    TLD: tld,
    HostName1: '@',
    RecordType1: 'A',
    Address1: '76.76.21.21',
    TTL1: '1800',
    HostName2: 'www',
    RecordType2: 'CNAME',
    Address2: 'cname.vercel-dns.com',
    TTL2: '1800',
  })
  checkError(xml)
  if (!/IsSuccess="true"/i.test(xml)) {
    throw new Error('Namecheap setHosts did not report success')
  }
}

export async function getDomainInfo(
  domain: string,
): Promise<{ expiresAt: string; autoRenew: boolean }> {
  const xml = await callApi('namecheap.domains.getInfo', { DomainName: domain })
  checkError(xml)
  const expiresMatch = xml.match(/Expired="([^"]+)"/)
  const autoRenewMatch = xml.match(/AutoRenew="(true|false)"/)
  return {
    expiresAt:
      expiresMatch?.[1] ?? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    autoRenew: autoRenewMatch?.[1] === 'true',
  }
}
