// Packeta (Zásilkovna) REST API client.
// Used to create parcels when the merchant marks an order as shipped.
// Docs: https://pickup-point.api.packeta.com/

const PACKETA_API = 'https://www.zasilkovna.cz/api/rest'

export interface PacketaParcelInput {
  apiKey: string
  apiPassword: string
  orderId: string           // your internal order ID → used as orderNumber
  orderNumber: string       // human-readable order number (e.g. "2026-0001")
  customerName: string
  customerEmail: string
  customerPhone?: string
  branchId: string          // Zásilkovna branch/pickup-point ID
  value: number             // declared value in CZK (for insurance)
  weight?: number           // in kg, default 1
  cod?: number              // cash-on-delivery amount in CZK (0 = no COD)
}

export interface PacketaParcelResult {
  barcode: string           // e.g. "Z1234567890"
  trackingUrl: string       // https://tracking.packeta.com/cs/?id=Z1234567890
}

export async function createPacketaParcel(p: PacketaParcelInput): Promise<PacketaParcelResult> {
  // Packeta uses a SOAP-like XML API
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
    <currency>CZK</currency>
    <value>${p.value.toFixed(2)}</value>
    <weight>${(p.weight ?? 1).toFixed(3)}</weight>
    ${p.cod ? `<cod>${p.cod.toFixed(2)}</cod>` : ''}
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
