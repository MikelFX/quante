// byrd FulfillmentProvider implementation. HTTP/auth in client.ts, Quante<->byrd mapping in
// mapper.ts — this file just wires the two together against the FulfillmentProvider contract.

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { FulfillmentProvider, QuanteOrder, QuanteProduct, ShipmentStatus, ReturnItem } from '../../types'
import { byrdRequest, type ByrdClientConfig } from './client'
import {
  toByrdShipmentPayload,
  fromByrdShipment,
  toByrdProductPayload,
  fromByrdProductList,
  extractErrors,
  unwrapData,
} from './mapper'

export interface ByrdCredentials {
  apiKey: string
  apiSecret: string
  projectId: string
}

// Reconciliation support (quante-fulfillment-byrd-spec.md section 6) — NOT part of the
// FulfillmentProvider interface, since "look up a shipment you're not sure you created" is
// inherently provider-specific (byrd: search by shop.order_id via the list endpoint; a future
// provider might have a dedicated idempotency-key lookup instead). The reconciliation cron
// (app/api/cron/fulfillment-reconcile) special-cases byrd today; generalize this once a second
// provider needs the same capability.
//
// docs/listing-shipments documents `q` (free-text search) + `fields` (which fields `q`
// searches) as query params, but doesn't give a worked example of searching by order id/number
// specifically — the exact dot-path for `fields` (e.g. "shop.order_id") is inferred, not
// confirmed. To stay safe even if that guess is wrong, this always verifies the match
// client-side against shop.order_id / shop.order_number on every candidate returned, rather
// than trusting the server-side filter to have narrowed correctly.
export async function findByrdShipmentByOrderId(
  creds: ByrdCredentials,
  orderId: string,
  orderNumber: string,
): Promise<{ externalId: string; status: string } | null> {
  const cfg: ByrdClientConfig = { apiKey: creds.apiKey, apiSecret: creds.apiSecret, projectId: creds.projectId }
  const res = await byrdRequest(supabaseAdmin, cfg, `/v3/shipments?q=${encodeURIComponent(orderId)}&fields=shop.order_id&per_page=250`, { retryable: true })
  if (!res.ok) return null
  const body = await res.json().catch(() => null) as { data?: Array<{ id?: string; byrd_id?: string; status?: string; shop?: { order_id?: string; order_number?: string } }> } | null
  const candidates = body?.data ?? []
  const match = candidates.find((c) => c.shop?.order_id === orderId || c.shop?.order_number === orderNumber)
  if (!match) return null
  const externalId = match.byrd_id ?? match.id
  if (!externalId) return null
  return { externalId, status: match.status ?? 'new' }
}

export function createByrdProvider(creds: ByrdCredentials): FulfillmentProvider {
  const cfg: ByrdClientConfig = { apiKey: creds.apiKey, apiSecret: creds.apiSecret, projectId: creds.projectId }

  return {
    slug: 'byrd',

    async testConnection() {
      try {
        // GET /v2/auth ("get details of your own user", confirmed at
        // developers.getbyrd.com/reference/authapiv2_get) forces a real login and returns the
        // logged-in user — side-effect-free, exactly fits "does auth work". The reference page
        // didn't include an example response body/field list, so accountName extraction below
        // is defensive (tries a few plausible field names, falls back to undefined) rather than
        // asserting a shape that was never actually confirmed — testConnection() still reports
        // ok:true correctly either way, only the accountName label may be blank.
        const res = await byrdRequest(supabaseAdmin, cfg, '/v2/auth', { method: 'GET', retryable: true })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const errors = extractErrors(body)
          return { ok: false, error: errors.length > 0 ? errors.join('; ') : `byrd API error (${res.status})` }
        }
        const user = unwrapData<{ company_name?: string; first_name?: string; last_name?: string }>(body)
        const accountName = user?.company_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || undefined
        return { ok: true, accountName }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'byrd connection failed' }
      }
    },

    async syncProduct(product: QuanteProduct): Promise<{ externalId: string }> {
      const payload = toByrdProductPayload(product)
      // POST /v2/warehouse/products has no documented upsert/"create or update by SKU"
      // semantics — repeated syncs of the same SKU would 409/error rather than update.
      // lib/fulfillment/auto-ship.ts and the sync API route are responsible for the
      // create-vs-update decision (checking fulfillment_product_links first); this method
      // always creates. If byrd returns a "SKU already exists" style error, the caller should
      // treat that as "already synced" rather than a hard failure — see the spec's idempotent
      // sync requirement.
      const res = await byrdRequest(supabaseAdmin, cfg, '/v2/warehouse/products', {
        method: 'POST',
        body: JSON.stringify(payload),
        retryable: false, // creation — do not blindly retry, same reasoning as shipments
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errors = extractErrors(body)
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }
      const data = unwrapData<{ id?: string }>(body)
      if (!data?.id) throw new Error('byrd did not return a product id')
      return { externalId: data.id }
    },

    async getStock(skus?: string[]) {
      // GET /v2/warehouse/products?sku=<value> filters to a single SKU (docs/listing-products
      // query params). No documented "sku in [...]" batch filter, so without a sku list we
      // fetch everything (paginated at per_page=250 default) and filter client-side; with a
      // short list we call per-SKU to avoid pulling the whole catalog unnecessarily.
      if (skus && skus.length > 0 && skus.length <= 20) {
        const results = await Promise.all(skus.map(async (sku) => {
          const res = await byrdRequest(supabaseAdmin, cfg, `/v2/warehouse/products?sku=${encodeURIComponent(sku)}`, { retryable: true })
          if (!res.ok) return []
          const body = await res.json().catch(() => ({}))
          return fromByrdProductList(body)
        }))
        return results.flat()
      }

      const res = await byrdRequest(supabaseAdmin, cfg, '/v2/warehouse/products?per_page=250', { retryable: true })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errors = extractErrors(body)
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }
      const all = fromByrdProductList(body)
      return skus && skus.length > 0 ? all.filter((s) => skus.includes(s.sku)) : all
    },

    async createShipment(order: QuanteOrder, idempotencyKey: string) {
      const payload = toByrdShipmentPayload(order)
      // ensure_unique_order_id=true is byrd's own server-side dedup on shop.order_id — a
      // second safety net on top of (never instead of) the DB unique(order_id) constraint in
      // fulfillment_shipments; see docs/creating-a-shipment query args and
      // lib/fulfillment/auto-ship.ts for the primary idempotency mechanism.
      // idempotencyKey is expected to equal order.id (enforced by auto-ship.ts) — asserted
      // defensively here since a mismatch would mean the DB-level guard and byrd's own dedup
      // are protecting two different identifiers.
      if (idempotencyKey !== order.id) {
        throw new Error('createShipment: idempotencyKey must equal order.id')
      }
      const res = await byrdRequest(
        supabaseAdmin,
        cfg,
        '/v3/shipments?ensure_unique_order_id=true',
        { method: 'POST', body: JSON.stringify(payload), retryable: false }, // NEVER retry shipment creation — see client.ts / spec section 6
      )
      const body = await res.json().catch(() => ({}))
      const errors = extractErrors(body)
      if (!res.ok || errors.length > 0) {
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }
      const shipment = fromByrdShipment(body)
      if (!shipment.externalId) throw new Error('byrd did not return a shipment id')
      return { externalId: shipment.externalId, status: shipment.status, subStatus: shipment.subStatus, warnings: shipment.warnings }
    },

    async getShipment(externalId: string): Promise<ShipmentStatus> {
      const res = await byrdRequest(supabaseAdmin, cfg, `/v3/shipments/${encodeURIComponent(externalId)}`, { retryable: true })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errors = extractErrors(body)
        throw new Error(errors.length > 0 ? `byrd: ${errors.join('; ')}` : `byrd API error (${res.status})`)
      }
      const shipment = fromByrdShipment(body)
      if (!shipment.externalId) shipment.externalId = externalId
      return shipment
    },

    async announceReturn(orderId: string, items: ReturnItem[]): Promise<{ externalId: string }> {
      // byrd's announce-return endpoint takes a shipment_id, not an order id (docs/announcing-
      // returns) — the caller (API route) is responsible for resolving orderId ->
      // fulfillment_shipments.external_shipment_id before calling this; `orderId` is accepted
      // here only to match the FulfillmentProvider interface signature and is not sent to byrd
      // directly. This is documented explicitly since it's a real, easy-to-miss mismatch
      // between "Quante's order id" and "byrd's shipment id".
      throw new Error(
        `announceReturn(orderId=${orderId}) not wired yet: byrd's /v3/returns/announce needs the byrd ` +
        `shipment_id + send_documents_to_email + per-item shipment_item_id (see docs/announcing-returns), ` +
        `none of which the current ReturnItem/orderId signature carries. Needs a small interface extension ` +
        `(shipment_id + notify email) once returns become a priority — deliberately left unimplemented ` +
        `rather than guessing field values, per the "don't invent fields" rule for this integration. ` +
        `items requested: ${items.map((i) => `${i.shipmentItemId}x${i.quantity}`).join(', ')}`,
      )
    },
  }
}
