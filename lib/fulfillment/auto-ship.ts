// The idempotent order -> shipment path (quante-fulfillment-byrd-spec.md section 6, "the most
// important part"). Any caller that might fire more than once for the same order — a Stripe
// webhook retry, a merchant double-clicking "Send to fulfillment", a reconciliation retry
// crossing paths with a real-time trigger — goes through attemptAutoCreateShipment() so at
// most one shipment is ever created per order, enforced by the DB, not by application logic
// alone (unique(order_id) on fulfillment_shipments — see supabase/migration-fulfillment-v2.sql).
//
// Sequence, matching the spec exactly:
//   1. INSERT a 'creating' row FIRST.
//   2. Unique violation (23505) on that insert -> another attempt already owns this order.
//      Return { outcome: 'duplicate' } — this is success, not an error. Callers (webhook
//      handlers especially) must still respond 200/OK on this outcome.
//   3. Only after the insert succeeds, call provider.createShipment() — and never retry that
//      call automatically on timeout/ambiguous response (client.ts enforces this at the HTTP
//      layer too: shipment creation always passes retryable: false). An ambiguous outcome is
//      left in 'creating' status for the reconciliation cron to resolve by asking byrd whether
//      the shipment actually exists, rather than risking a second physical shipment.
//   4. Update to 'created' + external id, or 'failed' + error, based on the real outcome.
//
// This function does NOT decide *when* to auto-ship — it's called by whichever trigger the
// product decides on (currently: none automatically; see the module-level note in
// app/api/projects/[id]/store-orders/[orderId]/fulfillment/route.ts for why wiring this into
// the live Stripe webhook was deliberately left as a follow-up decision rather than done here).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FulfillmentProvider, QuanteOrder } from './types'

export type AutoShipResult =
  | { outcome: 'duplicate' }
  | { outcome: 'created'; externalId: string; status: string; subStatus?: string; warnings?: string[] }
  | { outcome: 'failed'; error: string }
  | { outcome: 'migration_missing' } // fulfillment_shipments table doesn't exist yet

export function isDuplicateOrderError(error: unknown): boolean {
  return (error as { code?: string } | null | undefined)?.code === '23505'
}

// 42P01 = undefined_table (Postgres) — the clean signal that migration-fulfillment-v2.sql
// hasn't been run yet. Treated distinctly from other DB errors so callers can surface a clear
// "run the migration" message instead of a generic failure.
function isMissingTableError(error: unknown): boolean {
  return (error as { code?: string } | null | undefined)?.code === '42P01'
}

export async function attemptAutoCreateShipment(
  db: SupabaseClient,
  params: { projectId: string; order: QuanteOrder; provider: FulfillmentProvider },
): Promise<AutoShipResult> {
  const { projectId, order, provider } = params

  const { error: insertError } = await db.from('fulfillment_shipments').insert({
    project_id: projectId,
    order_id: order.id,
    provider: provider.slug,
    status: 'creating',
  })

  if (insertError) {
    if (isDuplicateOrderError(insertError)) return { outcome: 'duplicate' }
    if (isMissingTableError(insertError)) return { outcome: 'migration_missing' }
    return { outcome: 'failed', error: insertError.message }
  }

  // Insert succeeded — we, and only we, now own this order's shipment creation. Never retried
  // automatically (see module header); a failure here leaves the row in 'creating', to be
  // resolved by the reconciliation cron rather than retried inline.
  try {
    const shipment = await provider.createShipment(order, order.id)

    await db.from('fulfillment_shipments').update({
      status: 'created',
      external_shipment_id: shipment.externalId,
      updated_at: new Date().toISOString(),
    }).eq('order_id', order.id)

    await syncOrderDenormalizedColumns(db, order.id, provider.slug, shipment.externalId, shipment.status)

    return { outcome: 'created', externalId: shipment.externalId, status: shipment.status, subStatus: shipment.subStatus, warnings: shipment.warnings }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fulfillment error'
    // Deliberately left in a state the reconciliation cron can act on rather than guessing here
    // whether the call actually succeeded on byrd's side before the error surfaced locally
    // (network timeout, etc.) — see docs/update-log.md and migration header for the
    // 'creating' -> reconcile-after-10-minutes flow.
    await db.from('fulfillment_shipments').update({
      status: 'failed',
      error: message,
      updated_at: new Date().toISOString(),
    }).eq('order_id', order.id)
    return { outcome: 'failed', error: message }
  }
}

// Fallback used ONLY when fulfillment_shipments doesn't exist yet (attemptAutoCreateShipment
// returned { outcome: 'migration_missing' }) — i.e. supabase/migration-fulfillment-v2.sql has
// not been run against this database yet. Reproduces the exact behavior the fulfillment route
// had before this idempotency work: a single, never-retried createShipment() call, no DB-level
// duplicate guard. The caller's own order.fulfillment_ref check (see the route) is the only
// protection here, which is fine for the manual "click to fulfill" button this route serves
// today, but would NOT be safe against concurrent/duplicate webhook delivery — that protection
// only exists once the migration has run and attemptAutoCreateShipment() takes over
// automatically, with no further code changes needed.
export async function createShipmentDirectFallback(
  db: SupabaseClient,
  params: { order: QuanteOrder; provider: FulfillmentProvider },
): Promise<{ externalId: string; status: string; subStatus?: string; warnings?: string[] }> {
  const { order, provider } = params
  const shipment = await provider.createShipment(order, order.id)
  await syncOrderDenormalizedColumns(db, order.id, provider.slug, shipment.externalId, shipment.status)
  return shipment
}

// Keeps store_orders.fulfillment_provider/fulfillment_ref/fulfillment_status (added by the
// original migration-byrd.sql, F5) in sync so the existing Studio order-list UI keeps working
// unchanged — fulfillment_shipments is the new source of truth / audit trail, these three
// columns remain the fast denormalized read.
async function syncOrderDenormalizedColumns(
  db: SupabaseClient,
  orderId: string,
  provider: string,
  externalId: string,
  status: string,
): Promise<void> {
  await db.from('store_orders').update({
    fulfillment_provider: provider,
    fulfillment_ref: externalId,
    fulfillment_status: status,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId)
}
