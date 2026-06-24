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

export async function registerDomain(
  domain: string,
  years: number = 1,
): Promise<{ orderId: string }> {
  const parts = domain.split('.')
  const sld = parts[0] ?? ''
  const tld = parts.slice(1).join('.')

  const registrantEmail = process.env.DOMAIN_REGISTRANT_EMAIL ?? 'domains@quante.io'

  const xml = await callApi('namecheap.domains.create', {
    DomainName: sld,
    TLD: tld,
    Years: String(years),
    AuxBillingFirstName: 'Domain',
    AuxBillingLastName: 'Owner',
    AuxBillingAddress1: '123 Main St',
    AuxBillingCity: 'New York',
    AuxBillingStateProvince: 'NY',
    AuxBillingPostalCode: '10001',
    AuxBillingCountry: 'US',
    AuxBillingPhone: '+1.2125550100',
    AuxBillingEmailAddress: registrantEmail,
    RegistrantFirstName: 'Domain',
    RegistrantLastName: 'Owner',
    RegistrantAddress1: '123 Main St',
    RegistrantCity: 'New York',
    RegistrantStateProvince: 'NY',
    RegistrantPostalCode: '10001',
    RegistrantCountry: 'US',
    RegistrantPhone: '+1.2125550100',
    RegistrantEmailAddress: registrantEmail,
    TechFirstName: 'Domain',
    TechLastName: 'Owner',
    TechAddress1: '123 Main St',
    TechCity: 'New York',
    TechStateProvince: 'NY',
    TechPostalCode: '10001',
    TechCountry: 'US',
    TechPhone: '+1.2125550100',
    TechEmailAddress: registrantEmail,
    AdminFirstName: 'Domain',
    AdminLastName: 'Owner',
    AdminAddress1: '123 Main St',
    AdminCity: 'New York',
    AdminStateProvince: 'NY',
    AdminPostalCode: '10001',
    AdminCountry: 'US',
    AdminPhone: '+1.2125550100',
    AdminEmailAddress: registrantEmail,
    // Enable WhoisGuard privacy protection
    AddFreeWhoisguard: 'yes',
    WGEnabled: 'yes',
  })
  checkError(xml)

  const orderIdMatch = xml.match(/OrderID="(\d+)"/)
  const orderId = orderIdMatch?.[1] ?? crypto.randomUUID()
  return { orderId }
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
