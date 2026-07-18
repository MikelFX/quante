// byrd fulfillment provider (https://developers.getbyrd.com)
// Auth: POST /v2/login with API key + secret → JWT (default 7 days validity).
// The login endpoint is rate-limited to 5 calls/min, so tokens are cached
// per API key and reused until shortly before expiry.
// Shipments: POST /v3/shipments, GET /v3/shipments/{id}.

import type {
  CreateFulfillmentShipmentInput,
  FulfillmentProvider,
  FulfillmentShipment,
} from './provider'

const BYRD_API_BASE = 'https://api.getbyrd.com'
const USER_AGENT = 'Quante (info@quantecode.com) - 1.0'
const TOKEN_VALIDITY_SECONDS = 6 * 60 * 60

interface ByrdConfig {
  apiKey: string
  apiSecret: string
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function getToken(cfg: ByrdConfig): Promise<string> {
  const cached = tokenCache.get(cfg.apiKey)
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token

  const res = await fetch(`${BYRD_API_BASE}/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      username: cfg.apiKey,
      password: cfg.apiSecret,
      validity: TOKEN_VALIDITY_SECONDS,
    }),
  })

  if (!res.ok) {
    throw new Error(`byrd login failed (${res.status}) — check API key & secret`)
  }

  const data = await res.json() as { token?: string; access_token?: string; jwt?: string }
  const token = data.token ?? data.access_token ?? data.jwt
  if (!token) throw new Error('byrd login response did not contain a token')

  tokenCache.set(cfg.apiKey, { token, expiresAt: Date.now() + TOKEN_VALIDITY_SECONDS * 1000 })
  return token
}

async function byrdFetch(cfg: ByrdConfig, path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken(cfg)
  return fetch(`${BYRD_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

interface ByrdShipmentResponse {
  byrd_id?: string
  id?: string
  status?: string
  sub_status?: string
  tracking?: {
    carrier?: string
    tracking_number?: string
    tracking_url?: string
  }
  carrier?: string
  tracking_number?: string
  tracking_url?: string
  warnings?: Array<string | { message?: string }>
  errors?: Array<string | { message?: string }>
}

function toMessages(list: Array<string | { message?: string }> | undefined): string[] {
  return (list ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? JSON.stringify(e)))
}

function toShipment(data: ByrdShipmentResponse): FulfillmentShipment {
  return {
    id: data.byrd_id ?? data.id ?? '',
    status: data.status ?? 'new',
    subStatus: data.sub_status,
    trackingCarrier: data.tracking?.carrier ?? data.carrier ?? undefined,
    trackingNumber: data.tracking?.tracking_number ?? data.tracking_number ?? undefined,
    trackingUrl: data.tracking?.tracking_url ?? data.tracking_url ?? undefined,
    warnings: toMessages(data.warnings),
  }
}

// byrd requires street name and number as separate fields; storefront checkout
// collects a single "ulice" line, so split a trailing house number when present.
export function splitStreet(street: string): { name: string; number: string } {
  const m = street.trim().match(/^(.*?)[,\s]+(\d[\w/-]*)$/)
  if (m) return { name: m[1].trim(), number: m[2] }
  return { name: street.trim(), number: '' }
}

export function createByrdProvider(cfg: ByrdConfig): FulfillmentProvider {
  return {
    name: 'byrd',

    async createShipment(input: CreateFulfillmentShipmentInput): Promise<FulfillmentShipment> {
      const payload = {
        destination_address: {
          name: input.address.name,
          company_name: input.address.companyName ?? '',
          email: input.address.email ?? '',
          street_name: input.address.streetName,
          street_number: input.address.streetNumber ?? '',
          address_addition: input.address.addressAddition ?? '',
          city: input.address.city,
          postal_code: input.address.postalCode,
          country_code: input.address.countryCode.toUpperCase(),
          phone: input.address.phone ?? '',
        },
        items: input.items.map((i) => ({
          sku: i.sku,
          name: i.name,
          quantity: i.quantity,
          price: { value: i.priceValue, currency: i.currency.toUpperCase() },
        })),
        service: input.service ?? 'standard',
        options: { auto_release: !input.testMode },
        shop: { order_number: input.orderNumber, order_id: input.orderId },
        ...(input.cod && input.cod.value > 0
          ? { cash_on_delivery: { price: { value: input.cod.value, currency: input.cod.currency.toUpperCase() } } }
          : {}),
      }

      const res = await byrdFetch(cfg, '/v3/shipments', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({})) as ByrdShipmentResponse
      const errors = toMessages(data.errors)

      if (!res.ok || errors.length > 0) {
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }

      const shipment = toShipment(data)
      if (!shipment.id) throw new Error('byrd did not return a shipment id')
      return shipment
    },

    async getShipment(shipmentId: string): Promise<FulfillmentShipment> {
      const res = await byrdFetch(cfg, `/v3/shipments/${encodeURIComponent(shipmentId)}`)
      const data = await res.json().catch(() => ({})) as ByrdShipmentResponse
      if (!res.ok) {
        const errors = toMessages(data.errors)
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }
      const shipment = toShipment(data)
      if (!shipment.id) shipment.id = shipmentId
      return shipment
    },
  }
}
