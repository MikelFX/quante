// DHL Express REST API (MyDHL+ API) client.
// Docs: https://developer.dhl.com/api-reference/dhl-express-mydhl-api

const DHL_API_PROD = 'https://express.api.dhl.com/mydhlapi'
const DHL_API_TEST = 'https://express.api.dhl.com/mydhlapi/test'

// EU member states — used to determine if customs declaration is required
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR',
  'HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
])

export interface DhlShipmentInput {
  apiKey: string
  apiSecret: string
  accountNumber: string
  testMode?: boolean

  // Shipper (merchant)
  shipperName: string
  shipperCompany?: string
  shipperEmail: string
  shipperPhone: string
  shipperStreet: string
  shipperCity: string
  shipperPostalCode: string
  shipperCountryCode: string    // ISO 3166-1 alpha-2 upper-case, e.g. "CZ"

  // Recipient (customer)
  recipientName: string
  recipientEmail: string
  recipientPhone?: string
  recipientStreet: string
  recipientCity: string
  recipientPostalCode: string
  recipientCountryCode: string  // ISO 3166-1 alpha-2 upper-case, e.g. "DE"

  // Parcel
  orderNumber: string
  description: string           // customs description, e.g. "E-commerce goods"
  weight: number                // kg
  length?: number               // cm
  width?: number                // cm
  height?: number               // cm

  // Financials
  currency: string              // ISO 4217, e.g. "CZK", "EUR"
  declaredValue: number         // order total, for customs/insurance
}

export interface DhlShipmentResult {
  trackingNumber: string
  trackingUrl: string
  labelBase64: string           // PDF label, base64-encoded
}

export async function createDhlShipment(p: DhlShipmentInput): Promise<DhlShipmentResult> {
  const base = p.testMode ? DHL_API_TEST : DHL_API_PROD
  const auth = Buffer.from(`${p.apiKey}:${p.apiSecret}`).toString('base64')

  const shipperCC = p.shipperCountryCode.toUpperCase()
  const recipientCC = p.recipientCountryCode.toUpperCase()
  const isCustomsDeclarable = !(EU_COUNTRIES.has(shipperCC) && EU_COUNTRIES.has(recipientCC))

  // Use today + 1 business day as planned date
  const plannedDate = new Date()
  plannedDate.setDate(plannedDate.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  const plannedISO = `${plannedDate.getFullYear()}-${pad(plannedDate.getMonth() + 1)}-${pad(plannedDate.getDate())}T12:00:00 GMT+00:00`

  const body = {
    plannedShippingDateAndTime: plannedISO,
    pickup: { isRequested: false },
    productCode: 'P',           // DHL Express Worldwide
    accounts: [{ typeCode: 'shipper', number: p.accountNumber }],
    outputImageProperties: {
      printerDPI: 300,
      encodingFormat: 'pdf',
      imageOptions: [{ typeCode: 'label', templateName: 'ECOM26_84_001' }],
    },
    customerDetails: {
      shipperDetails: {
        postalAddress: {
          postalCode: p.shipperPostalCode,
          cityName: p.shipperCity,
          countryCode: shipperCC,
          addressLine1: p.shipperStreet,
        },
        contactInformation: {
          phone: p.shipperPhone,
          companyName: p.shipperCompany || p.shipperName,
          fullName: p.shipperName,
          email: p.shipperEmail,
        },
      },
      receiverDetails: {
        postalAddress: {
          postalCode: p.recipientPostalCode,
          cityName: p.recipientCity,
          countryCode: recipientCC,
          addressLine1: p.recipientStreet,
        },
        contactInformation: {
          phone: p.recipientPhone || '',
          fullName: p.recipientName,
          email: p.recipientEmail,
        },
      },
    },
    content: {
      packages: [{
        weight: p.weight,
        ...(p.length && p.width && p.height
          ? { dimensions: { length: p.length, width: p.width, height: p.height } }
          : {}),
      }],
      isCustomsDeclarable,
      description: p.description,
      unitOfMeasurement: 'metric',
      incoterm: 'DAP',          // Delivered at Place — recipient handles customs
      declaredValue: p.declaredValue,
      declaredValueCurrency: p.currency.toUpperCase(),
    },
    shipmentNotification: [{
      typeCode: 'email',
      receiverId: p.recipientEmail,
      languageCode: 'en',
    }],
    reference: [{ value: p.orderNumber, typeCode: 'CU' }],
  }

  const res = await fetch(`${base}/shipments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    const detail = (data?.detail as string) || (data?.title as string) || JSON.stringify(data)
    throw new Error(`DHL API error ${res.status}: ${detail}`)
  }

  const trackingNumber = data.shipmentTrackingNumber as string
  if (!trackingNumber) throw new Error('DHL: tracking number not found in response')

  const documents = data.documents as Array<{ typeCode: string; content: string }> | undefined
  const labelDoc = documents?.find(d => d.typeCode === 'label')
  if (!labelDoc?.content) throw new Error('DHL: label not found in response')

  return {
    trackingNumber,
    trackingUrl: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}&brand=DHL`,
    labelBase64: labelDoc.content,
  }
}
