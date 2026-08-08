// Quante <-> byrd mapping. No byrd-specific fields leak outside this file and index.ts —
// lib/fulfillment/types.ts stays provider-agnostic.
//
// Response envelope: byrd wraps single-resource responses as { "data": {...} } and list
// responses as { "page", "per_page", "last_page", "data": [...] } — confirmed against real
// examples in docs/creating-a-shipment, docs/get-shipment-details, docs/listing-products,
// docs/announcing-returns (fetched 2026-08-07). unwrapData() below is the single place that
// assumption lives, with a defensive fallback in case a future API version stops wrapping.

import type { QuanteOrder, QuanteProduct, ShipmentStatus } from '../../types'

export function unwrapData<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data
  }
  return body as T
}

// byrd requires street name and number as separate fields (docs/creating-a-shipment ->
// destination_address.street_name / street_number); Quante's checkout only collects a single
// free-text street line, so split a trailing house number when present.
export function splitStreet(street: string): { name: string; number: string } {
  const m = street.trim().match(/^(.*?)[,\s]+(\d[\w/-]*)$/)
  if (m) return { name: m[1].trim(), number: m[2] }
  return { name: street.trim(), number: '' }
}

export interface ByrdShipmentPayload {
  destination_address: {
    name: string
    company_name: string
    email: string
    street_name: string
    street_number: string
    city: string
    postal_code: string
    country_code: string
    phone: string
  }
  items: Array<{
    sku: string
    name: string
    quantity: number
    price: { value: number; currency: string }
  }>
  service: 'standard'
  options: { auto_release: boolean }
  shop: { order_number: string; order_id: string }
  cash_on_delivery?: { price: { value: number; currency: string } }
}

export function toByrdShipmentPayload(order: QuanteOrder): ByrdShipmentPayload {
  const street = splitStreet(order.address.street)
  return {
    destination_address: {
      name: order.address.name,
      company_name: order.address.companyName ?? '',
      email: order.address.email ?? '',
      street_name: street.name,
      street_number: street.number,
      city: order.address.city,
      postal_code: order.address.postalCode,
      country_code: order.address.countryCode.toUpperCase(),
      phone: order.address.phone ?? '',
    },
    items: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      price: { value: i.unitPriceCents / 100, currency: order.currency.toUpperCase() },
    })),
    service: 'standard',
    // auto_release: !testMode — a test-mode shipment still gets created in byrd (visible in
    // the dashboard) but stays in `new` status for manual release instead of going straight
    // to the warehouse. See docs/creating-a-shipment#options.
    options: { auto_release: !order.testMode },
    shop: { order_number: order.orderNumber, order_id: order.id },
    // docs/creating-a-shipment#cash-on-delivery documents currency as accepting only "EUR" —
    // Quante stores are frequently priced in CZK. Send the order's real currency anyway
    // (byrd may support more than the docs table lists) rather than silently mis-converting;
    // if byrd rejects it, that surfaces as a normal API error to the merchant.
    ...(order.isCashOnDelivery && order.totalCents > 0
      ? { cash_on_delivery: { price: { value: order.totalCents / 100, currency: order.currency.toUpperCase() } } }
      : {}),
  }
}

interface ByrdShipmentResponseData {
  byrd_id?: string
  id?: string
  status?: string
  sub_status?: string
  units?: Array<{ carrier?: { tracking_number?: string; tracking_url?: string; name?: string } }>
  // legacy/defensive: some responses may carry tracking at top level instead of units[]
  tracking?: { carrier?: string; tracking_number?: string; tracking_url?: string }
  warnings?: Array<string | { message?: string }>
  errors?: Array<string | { message?: string; code?: string }>
}

function toMessages(list: Array<string | { message?: string; code?: string }> | undefined): string[] {
  return (list ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? e.code ?? JSON.stringify(e)))
}

export function extractErrors(rawBody: unknown): string[] {
  const body = rawBody as { errors?: Array<string | { message?: string; code?: string }>; message?: string; code?: string } | null
  if (!body) return []
  if (Array.isArray(body.errors) && body.errors.length > 0) return toMessages(body.errors)
  if (body.message) return [body.code ? `${body.code}: ${body.message}` : body.message]
  return []
}

export function fromByrdShipment(rawBody: unknown): ShipmentStatus {
  const data = unwrapData<ByrdShipmentResponseData>(rawBody)
  // Tracking lives under units[0].carrier per docs/get-shipment-details — a shipment can in
  // principle split into multiple units/parcels; we surface the first one, which covers the
  // overwhelmingly common single-parcel case. Falls back to a top-level `tracking` shape
  // defensively in case an older API version or webhook payload still uses it.
  const unit = data.units?.[0]?.carrier
  return {
    externalId: data.byrd_id ?? data.id ?? '',
    status: data.status ?? 'new',
    subStatus: data.sub_status,
    trackingCarrier: unit?.name ?? data.tracking?.carrier,
    trackingNumber: unit?.tracking_number ?? data.tracking?.tracking_number,
    trackingUrl: unit?.tracking_url ?? data.tracking?.tracking_url,
    warnings: toMessages(data.warnings),
  }
}

// docs/creating-a-product: POST /v2/warehouse/products body uses purchasePrice (camelCase,
// unlike the v3 shipments API's snake_case) — byrd's v2 and v3 APIs use different casing
// conventions, this isn't a typo.
export interface ByrdProductPayload {
  sku: string
  name: string
  purchasePrice: { value: number; currency: string }
  dimensions?: { weight?: number }
}

export function toByrdProductPayload(product: QuanteProduct): ByrdProductPayload {
  return {
    sku: product.sku,
    name: product.name,
    purchasePrice: { value: product.priceCents / 100, currency: product.currency.toUpperCase() },
    ...(product.weightKg ? { dimensions: { weight: product.weightKg } } : {}),
  }
}

interface ByrdProductListItem {
  sku?: string
  availableStock?: number
}

export function fromByrdProductList(rawBody: unknown): Array<{ sku: string; available: number }> {
  const list = unwrapData<ByrdProductListItem[]>(rawBody) ?? []
  return list
    .filter((p): p is ByrdProductListItem & { sku: string } => typeof p.sku === 'string')
    .map((p) => ({ sku: p.sku, available: p.availableStock ?? 0 }))
}
