// Fulfillment provider abstraction.
// A fulfillment provider is a 3PL warehouse that stores the merchant's stock
// and ships orders on their behalf (vs. carriers like Packeta/DHL/GLS where
// the merchant prints a label and hands the parcel over themselves).
//
// Implementations: lib/fulfillment/byrd.ts

export interface FulfillmentAddress {
  name: string
  companyName?: string
  email?: string
  phone?: string
  streetName: string
  streetNumber?: string
  addressAddition?: string
  city: string
  postalCode: string
  countryCode: string          // ISO 3166-1 alpha-2, upper-case
}

export interface FulfillmentItem {
  sku: string                  // must match the SKU registered at the warehouse
  name: string
  quantity: number
  priceValue: number           // unit price in major units (e.g. 20.00)
  currency: string             // ISO 4217, upper-case
}

export interface CreateFulfillmentShipmentInput {
  orderNumber: string
  orderId: string
  address: FulfillmentAddress
  items: FulfillmentItem[]
  service?: 'standard' | 'express' | 'economy' | 'pickup_point'
  cod?: { value: number; currency: string }
  testMode?: boolean
}

export interface FulfillmentShipment {
  id: string                   // provider's shipment id
  status: string               // provider-native status (e.g. byrd: new | processing | shipped …)
  subStatus?: string
  trackingCarrier?: string
  trackingNumber?: string
  trackingUrl?: string
  warnings?: string[]
}

export interface FulfillmentProvider {
  readonly name: string
  createShipment(input: CreateFulfillmentShipmentInput): Promise<FulfillmentShipment>
  getShipment(shipmentId: string): Promise<FulfillmentShipment>
}
