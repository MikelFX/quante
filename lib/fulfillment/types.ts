// Fulfillment provider abstraction — a 3PL warehouse that stores the merchant's stock and
// ships orders on their behalf (vs. carriers like Packeta/DHL/GLS in lib/zasilkovna.ts,
// lib/dhl.ts, lib/gls.ts, where the merchant prints a label and hands the parcel over
// themselves). byrd (providers/byrd/) is the first implementation; this interface is written
// so a second one (Skladon, Shipmonk, ...) can be added without touching the checkout flow
// or any existing carrier code — see registry.ts.
//
// These domain types are deliberately provider-agnostic — no byrd-specific field names or
// shapes here. All Quante <-> byrd mapping lives in providers/byrd/mapper.ts. They're also
// shaped to match what Quante's actual schema has available (store_orders rows, store_inventory
// rows), not the generic "products"/"orders" tables an abstract spec might assume — see the
// field-level comments below.

export interface FulfillmentAddress {
  name: string
  companyName?: string
  email?: string
  phone?: string
  street: string          // single line as collected at checkout (e.g. "Hlavní 12") — provider
                           // implementations that need street name/number split separately
                           // (byrd does) do that split themselves in their own mapper.
  city: string
  postalCode: string
  countryCode: string     // ISO 3166-1 alpha-2, upper-case
}

export interface QuanteOrderItem {
  sku: string              // falls back to the store's product id if no explicit SKU was set —
                            // see mapper.ts skuForItem(). Providers match warehouse stock by this.
  name: string
  quantity: number
  unitPriceCents: number   // integer minor units, matches store_orders.items[].price convention
}

// Matches the fields fulfillment code actually reads off a store_orders row (see
// app/api/projects/[id]/store-orders/[orderId]/fulfillment/route.ts) — not a generic "Order"
// shape. Build this from a store_orders row at the call site.
export interface QuanteOrder {
  id: string                // store_orders.id
  orderNumber: string
  address: FulfillmentAddress
  items: QuanteOrderItem[]
  currency: string          // ISO 4217, upper-case
  totalCents: number
  isCashOnDelivery: boolean // store_orders.payment_method === 'dobirka'
  testMode?: boolean
}

// Matches store_inventory (project_id, product_id, variant_id) — Quante has no separate
// per-product "SKU" column (code-gen stores keep products in generated data/products.ts
// files, not a DB products table), so `sku` here is store_inventory.product_id, optionally
// suffixed with the variant id. This is documented explicitly because it's a real deviation
// from a naive "products have SKUs" assumption — see mapper.ts skuForProduct().
export interface QuanteProduct {
  sku: string
  name: string
  priceCents: number
  currency: string
  weightKg?: number
}

export interface StockLevel {
  sku: string
  available: number
}

export interface ShipmentStatus {
  externalId: string        // provider's shipment id
  status: string             // provider-native status string, e.g. byrd: new | processing | sent | delivered
  subStatus?: string
  trackingCarrier?: string
  trackingNumber?: string
  trackingUrl?: string
  warnings?: string[]
}

export interface ReturnItem {
  shipmentItemId: string    // provider's line-item id from the original shipment, NOT a Quante order item id
  quantity: number
  reason: string
}

export interface FulfillmentProvider {
  readonly slug: string

  testConnection(): Promise<{ ok: boolean; accountName?: string; error?: string }>

  syncProduct(product: QuanteProduct): Promise<{ externalId: string }>
  getStock(skus?: string[]): Promise<StockLevel[]>

  // idempotencyKey is passed through to the provider when it supports native dedup
  // (byrd: `ensure_unique_order_id=true` query param, keyed on order.id as order_id) — this is
  // a second, provider-side safety net *in addition to*, never *instead of*, the DB-level
  // unique(order_id) constraint in fulfillment_shipments enforced by lib/fulfillment/auto-ship.ts.
  createShipment(order: QuanteOrder, idempotencyKey: string): Promise<{ externalId: string; status: string; subStatus?: string; warnings?: string[] }>
  getShipment(externalId: string): Promise<ShipmentStatus>

  announceReturn(orderId: string, items: ReturnItem[]): Promise<{ externalId: string }>
}
