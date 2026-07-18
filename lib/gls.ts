// GLS MyGLS API client (CZ/SK/HU/RO/SI/HR).
// Docs: https://api.mygls.cz/ — ParcelService PrintLabels creates parcels and returns PDF labels.
// Auth: username (email) + SHA-512 password hash as a byte array + client number.

import { createHash } from 'crypto'

const GLS_API_BY_COUNTRY: Record<string, string> = {
  cz: 'https://api.mygls.cz',
  sk: 'https://api.mygls.sk',
  hu: 'https://api.mygls.hu',
  ro: 'https://api.mygls.ro',
  si: 'https://api.mygls.si',
  hr: 'https://api.mygls.hr',
}

const GLS_TEST_API_BY_COUNTRY: Record<string, string> = {
  cz: 'https://api.test.mygls.cz',
  sk: 'https://api.test.mygls.sk',
  hu: 'https://api.test.mygls.hu',
  ro: 'https://api.test.mygls.ro',
  si: 'https://api.test.mygls.si',
  hr: 'https://api.test.mygls.hr',
}

export interface GlsParcelInput {
  username: string
  password: string
  clientNumber: string
  accountCountry?: string       // GLS contract country: cz | sk | hu | ro | si | hr (default cz)
  testMode?: boolean

  // Recipient (customer). Pickup address defaults to the GLS client account address.
  recipientName: string
  recipientStreet: string
  recipientCity: string
  recipientZip: string
  recipientCountryCode: string  // ISO 3166-1 alpha-2, e.g. "CZ"
  recipientPhone?: string
  recipientEmail?: string

  orderNumber: string           // used as ClientReference
  content?: string              // parcel content description
  cod?: number                  // cash on delivery amount (0 = none)
  codReference?: string
}

export interface GlsParcelResult {
  parcelNumber: string
  trackingUrl: string
  labelBase64: string           // PDF label, base64-encoded
}

interface PrintLabelsResponse {
  Labels?: number[]
  PrintLabelsErrorList?: Array<{ ErrorCode?: number; ErrorDescription?: string }>
  PrintLabelsInfoList?: Array<{ ParcelId?: number; ParcelNumber?: number }>
}

export async function createGlsParcel(p: GlsParcelInput): Promise<GlsParcelResult> {
  const country = (p.accountCountry ?? 'cz').toLowerCase()
  const bases = p.testMode ? GLS_TEST_API_BY_COUNTRY : GLS_API_BY_COUNTRY
  const base = bases[country]
  if (!base) throw new Error(`GLS: unsupported account country "${country}"`)

  // MyGLS expects the SHA-512 hash of the password as a JSON byte array
  const passwordBytes = Array.from(createHash('sha512').update(p.password).digest())

  const body = {
    Username: p.username,
    Password: passwordBytes,
    ParcelList: [{
      ClientNumber: Number(p.clientNumber),
      ClientReference: p.orderNumber,
      Count: 1,
      CODAmount: p.cod && p.cod > 0 ? p.cod : 0,
      CODReference: p.cod && p.cod > 0 ? (p.codReference ?? p.orderNumber) : '',
      Content: p.content ?? 'E-commerce goods',
      DeliveryAddress: {
        Name: p.recipientName,
        Street: p.recipientStreet,
        HouseNumber: '',
        City: p.recipientCity,
        ZipCode: p.recipientZip,
        CountryIsoCode: p.recipientCountryCode.toUpperCase(),
        ContactName: p.recipientName,
        ContactPhone: p.recipientPhone ?? '',
        ContactEmail: p.recipientEmail ?? '',
      },
      ServiceList: [],
    }],
    TypeOfPrinter: 'A4_2x2',
  }

  const res = await fetch(`${base}/ParcelService.svc/json/PrintLabels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GLS API error ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }

  const data = await res.json() as PrintLabelsResponse

  const errors = data.PrintLabelsErrorList ?? []
  if (errors.length > 0) {
    const msg = errors.map(e => e.ErrorDescription ?? `code ${e.ErrorCode}`).join('; ')
    throw new Error(`GLS: ${msg}`)
  }

  const parcelNumber = data.PrintLabelsInfoList?.[0]?.ParcelNumber
  if (!parcelNumber) throw new Error('GLS: parcel number not found in response')
  if (!data.Labels || data.Labels.length === 0) throw new Error('GLS: label not found in response')

  return {
    parcelNumber: String(parcelNumber),
    trackingUrl: `https://gls-group.eu/GROUP/en/parcel-tracking?match=${parcelNumber}`,
    labelBase64: Buffer.from(Uint8Array.from(data.Labels)).toString('base64'),
  }
}
