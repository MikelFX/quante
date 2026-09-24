// GET /api/cron/fulfillment-tracking — hourly Vercel cron (see vercel.json).
// byrd has no webhook for tracking updates (confirmed: nothing in developers.getbyrd.com's
// docs describes a tracking webhook, only polling — see docs/tracking-data) — this cron is the
// only way tracking numbers and delivery status ever reach Quante and the customer.
//
// Per quante-fulfillment-byrd-spec.md section 7: shipments in status created/sent, younger
// than 30 days, get polled; on a transition to a tracking-number-bearing status the order is
// marked shipped and the customer gets the tracking email — customer_notified_at is set ONLY
// after the send succeeds, so a transient email failure means "try again next hour", not
// silence forever, and a successful send is never repeated.
//
// Protected by CRON_SECRET via lib/cron-auth (Vercel sends "Authorization: Bearer <secret>"
// automatically once the env var is set). Fails closed when the secret is missing.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { decryptSecret } from '@/lib/crypto'
import { createFulfillmentProvider } from '@/lib/fulfillment/registry'
import { claimShipped, sendGuardedShippingMail, shipRefusal, safeTrackingUrl, type ShippableOrder } from '@/app/api/projects/[id]/store-orders/_lib/ship-guard'

export const maxDuration = 300

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

interface ShipmentRow {
  id: string
  project_id: string
  order_id: string
  provider: string
  external_shipment_id: string | null
  status: string
  customer_notified_at: string | null
  created_at: string
}

export async function GET(request: Request) {
  // Fail closed: a missing CRON_SECRET must not leave this route public.
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()

  const { data: shipments, error } = await supabaseAdmin
    .from('fulfillment_shipments')
    .select('id, project_id, order_id, provider, external_shipment_id, status, customer_notified_at, created_at')
    .in('status', ['created', 'sent'])
    .gte('created_at', cutoff)
    .not('external_shipment_id', 'is', null)

  if (error) {
    // 42P01 = undefined_table — migration-fulfillment-v2.sql not run yet. Not an error worth
    // alerting on; just nothing to do until the migration runs.
    if ((error as { code?: string }).code === '42P01') {
      return NextResponse.json({ ok: true, skipped: 'fulfillment_shipments table does not exist yet' })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (shipments ?? []) as ShipmentRow[]
  if (rows.length === 0) return NextResponse.json({ ok: true, checked: 0 })

  // Group by project so we only decrypt credentials and build a provider once per project,
  // not once per shipment.
  const byProject = new Map<string, ShipmentRow[]>()
  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? []
    list.push(row)
    byProject.set(row.project_id, list)
  }

  let checked = 0
  let updated = 0
  let notified = 0
  let failed = 0

  for (const [projectId, projectShipments] of byProject) {
    const { data: secrets } = await supabaseAdmin
      .from('project_secrets')
      .select('byrd_api_key, byrd_api_secret')
      .eq('project_id', projectId)
      .maybeSingle()
    if (!secrets?.byrd_api_key || !secrets?.byrd_api_secret) continue // credentials removed/never set — nothing to poll

    const provider = createFulfillmentProvider('byrd', {
      apiKey: decryptSecret(secrets.byrd_api_key as string) as string,
      apiSecret: decryptSecret(secrets.byrd_api_secret as string) as string,
      projectId,
    })

    for (const row of projectShipments) {
      checked++
      try {
        const shipment = await provider.getShipment(row.external_shipment_id as string)

        const { data: order } = await supabaseAdmin
          .from('store_orders')
          .select('id, order_number, customer_name, customer_email, status, payment_status, payment_method')
          .eq('id', row.order_id)
          .eq('project_id', projectId)
          .maybeSingle()
        if (!order) continue

        await supabaseAdmin.from('fulfillment_shipments').update({
          status: shipment.status,
          tracking_number: shipment.trackingNumber ?? null,
          tracking_url: shipment.trackingUrl ?? null,
          carrier: shipment.trackingCarrier ?? null,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)

        // SECURITY (final audit F3 follow-up): the move to 'shipped' follows the same
        // transition rules and compare-and-set as the Studio / store-key routes, and the
        // customer mail goes through the same guarded sender (per-recipient slot, unpaid
        // offline budget, store branding, carrier-host tracking links only).
        const trackingFields = {
          fulfillment_status: shipment.status,
          ...(shipment.trackingNumber ? {
            tracking_code: shipment.trackingNumber,
            tracking_url: safeTrackingUrl(shipment.trackingUrl) ?? null,
          } : {}),
        }
        const wantsShipped = !!shipment.trackingNumber && order.status !== 'shipped'
        const shippable = order as ShippableOrder
        let claimed = false
        if (wantsShipped && shipRefusal(shippable) === null) {
          claimed = await claimShipped(projectId, row.order_id, shippable, trackingFields)
        }
        if (!claimed) {
          await supabaseAdmin.from('store_orders')
            .update({ ...trackingFields, updated_at: new Date().toISOString() })
            .eq('id', row.order_id)
            .eq('project_id', projectId)
        }

        updated++

        // Notify at most once: only the poll whose claim moved the order to shipped, and
        // only if no notification was recorded for this shipment yet.
        if (claimed && !row.customer_notified_at && order.customer_email) {
          const sent = await sendGuardedShippingMail({
            projectId,
            orderId: row.order_id,
            customerEmail: order.customer_email as string,
            order: shippable,
            orderNumber: order.order_number as string,
            customerName: order.customer_name as string | null,
            trackingCode: shipment.trackingNumber ?? null,
            trackingUrl: shipment.trackingUrl ?? null,
            carrier: shipment.trackingCarrier || 'byrd fulfillment',
          })
          if (sent) {
            // Set ONLY after the send succeeds — see module header.
            await supabaseAdmin.from('fulfillment_shipments').update({
              customer_notified_at: new Date().toISOString(),
            }).eq('id', row.id)
            notified++
          }
        }
      } catch (err) {
        failed++
        console.error(`[cron/fulfillment-tracking] shipment ${row.id} (order ${row.order_id}) poll failed:`, err)
        // Don't touch the row's status on a transient poll failure — next hour retries.
      }
    }
  }

  return NextResponse.json({ ok: true, checked, updated, notified, failed })
}
