// Server-only. Never import this module in client code.

const BASE =
  process.env.NAMECHEAP_SANDBOX === 'true'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response'

function commonParams(): Record<string, string> {
  return {
    ApiUser: process.env.NAMECHEAP_API_USER ?? '',
    ApiKey: process.env.NAMECHEAP_API_KEY ?? '',
    UserName: process.env.NAMECHEAP_API_USER ?? '',
    ClientIp: process.env.NAMECHEAP_CLIENT_IP ?? '',
  }
}

async function callApi(command: string, extra: Record<string, string>): Promise<string> {
  const params = new URLSearchParams({ ...commonParams(), Command: command, ...extra })
  const res = await fetch(`${BASE}?${params}`, { method: 'GET' })
  if (!res.ok) throw new Error(`Namecheap HTTP ${res.status}`)
  return res.text()
}

// Parse <ApiResponse Status="ERROR"> and extract ErrCount/Errors
function checkError(xml: string): void {
  if (xml.includes('Status="ERROR"') || xml.includes("Status='ERROR'")) {
    const msgMatch = xml.match(/<Error Number="\d+">(.*?)<\/Error>/)
    throw new Error(msgMatch ? msgMatch[1] : 'Namecheap API error')
  }
}

export interface DomainCheckResult {
  domain: string
  available: boolean
  price: number // USD, already marked up
  currency: 'USD'
}

export async function checkDomainAvailability(domain: string): Promise<DomainCheckResult> {
  const [, ...tldParts] = domain.split('.')
  const tld = tldParts.join('.')
  const xml = await callApi('namecheap.domains.check', { DomainList: domain })
  checkError(xml)

  const availableMatch = xml.match(/Available="(true|false)"/i)
  const available = availableMatch?.[1]?.toLowerCase() === 'true'

  // Get pricing
  let rawPrice = 0
  try {
    const pricingXml = await callApi('namecheap.users.getPricing', {
      ProductType: 'DOMAIN',
      ProductCategory: 'REGISTER',
      ActionName: 'REGISTER',
      ProductName: tld,
    })
    const priceMatch = pricingXml.match(/YourPrice="([0-9.]+)"/)
    rawPrice = priceMatch ? parseFloat(priceMatch[1]) : 12.99
  } catch {
    rawPrice = 12.99 // fallback
  }

  const markup = parseFloat(process.env.DOMAIN_MARKUP_MULTIPLIER ?? '1.35')
  const markedUp = rawPrice * markup
  // Round to .99
  const price = Math.floor(markedUp) + 0.99

  return { domain, available, price, currency: 'USD' }
}

// Registrant contact data — set the DOMAIN_REGISTRANT_* env vars to real company data.
// Namecheap rejects registrations with obviously fake contacts on some TLDs.
function registrantContact(): Record<string, string> {
  return {
    FirstName: process.env.DOMAIN_REGISTRANT_FIRST_NAME ?? 'Quante',
    LastName: process.env.DOMAIN_REGISTRANT_LAST_NAME ?? 'Domains',
    Address1: process.env.DOMAIN_REGISTRANT_ADDRESS ?? '',
    City: process.env.DOMAIN_REGISTRANT_CITY ?? '',
    StateProvince: process.env.DOMAIN_REGISTRANT_STATE ?? '',
    PostalCode: process.env.DOMAIN_REGISTRANT_ZIP ?? '',
    Country: process.env.DOMAIN_REGISTRANT_COUNTRY ?? 'CZ',
    Phone: process.env.DOMAIN_REGISTRANT_PHONE ?? '',
    EmailAddress: process.env.DOMAIN_REGISTRANT_EMAIL ?? 'domains@quantecode.com',
  }
}

export async function registerDomain(
  domain: string,
  years: number = 1,
): Promise<{ orderId: string }> {
  const parts = domain.split('.')
  const sld = parts[0] ?? ''
  const tld = parts.slice(1).join('.')

  const contact = registrantContact()
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
