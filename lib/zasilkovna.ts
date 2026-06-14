// Packeta (Zásilkovna) REST API client.
// Supports both domestic CZ pickup points and Packeta International
// (DE, SK, PL, AT, HU, RO, HR, … via Z-BOX, partner points, and carrier home delivery).
// Docs: https://docs.packetery.com/01-pickup-point-selection/02-widget.html

const PACKETA_API = 'https://www.zasilkovna.cz/api/rest'

// Countries where Packeta supports COD (cash on delivery).
// Outside this list, cod should be 0.
const COD_SUPPORTED_COUNTRIES = new Set(['cz', 'sk'])

export interface PacketaParcelInput {
  apiKey: string
  apiPassword: string
  orderId: string           // internal order ID
  orderNumber: string       // human-readable, e.g. "2026-0001"
  customerName: string
  customerEmail: string
  customerPhone?: string
  branchId: string          // Zásilkovna / partner-point / Z-BOX / carrier ID
  branchCountry?: string    // ISO 3166-1 alpha-2 lower-case, e.g. "cz", "de", "sk"
  currency?: string         // ISO 4217, e.g. "CZK", "EUR" — declared value currency
  value: number             // declared value in that currency (for insurance / customs)
  weight?: number           // kg, default 1; required for international carriers
  size?: {                  // cm — required by DHL, GLS, etc.
    width: number
    height: number
    depth: number
  }
  cod?: number              // cash-on-delivery amount (0 = no COD); auto-zeroed for non-COD countries
}

export interface PacketaParcelResult {
  barcode: string           // e.g. "Z1234567890"
  trackingUrl: string       // https://tracking.packeta.com/cs/?id=Z1234567890
}

export async function createPacketaParcel(p: PacketaParcelInput): Promise<PacketaParcelResult> {
  const currency = p.currency?.toUpperCase() ?? 'CZK'
  const country = p.branchCountry?.toLowerCase() ?? 'cz'

  // COD is only supported for domestic countries — zero it out for international
  const cod = COD_SUPPORTED_COUNTRIES.has(country) ? (p.cod ?? 0) : 0

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${escXml(p.apiPassword)}</apiPassword>
  <packetAttributes>
    <number>${escXml(p.orderNumber)}</number>
    <name>${escXml(p.customerName.split(' ')[0] ?? p.customerName)}</name>
    <surname>${escXml(p.customerName.split(' ').slice(1).join(' ') || '-')}</surname>
    <email>${escXml(p.customerEmail)}</email>
    ${p.customerPhone ? `<phone>${escXml(p.customerPhone)}</phone>` : ''}
    <addressId>${escXml(p.branchId)}</addressId>
    <currency>${escXml(currency)}</currency>
    <value>${p.value.toFixed(2)}</value>
    <weight>${(p.weight ?? 1).toFixed(3)}</weight>
    ${cod > 0 ? `<cod>${cod.toFixed(2)}</cod>` : ''}
    ${p.size ? `<size><width>${p.size.width}</width><height>${p.size.height}</height><depth>${p.size.depth}</depth></size>` : ''}
    <apiKey>${escXml(p.apiKey)}</apiKey>
  </packetAttributes>
</createPacket>`

  const res = await fetch(`${PACKETA_API}/createPacket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: xml,
  })

  if (!res.ok) throw new Error(`Packeta API error: ${res.status}`)
  const text = await res.text()

  const faultMatch = text.match(/<fault>[\s\S]*?<detail>([\s\S]*?)<\/detail>/i)
  if (faultMatch) throw new Error(`Packeta error: ${faultMatch[1].trim()}`)

  const barcode = text.match(/<barcode>([^<]+)<\/barcode>/i)?.[1]
  if (!barcode) throw new Error('Packeta: barcode not found in response')

  return {
    barcode,
    trackingUrl: `https://tracking.packeta.com/cs/?id=${encodeURIComponent(barcode)}`,
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
