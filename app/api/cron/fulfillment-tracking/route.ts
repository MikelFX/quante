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
// Protect with CRON_SECRET (Vercel sends it automatically as "Authorization: Bearer <secret>"
// when the env var is set) — same convention as /api/cron/hosting.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createFulfillmentProvider } from '@/lib/fulfillment/registry'
import { shippingEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

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
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization') ?? ''
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
          .select('id, order_number, customer_name, customer_email, status')
          .eq('id', row.order_id)
          .maybeSingle()
        if (!order) continue

        const justShipped = !!shipment.trackingNumber && order.status !== 'shipped'

        await supabaseAdmin.from('fulfillment_shipments').update({
          status: shipment.status,
          tracking_number: shipment.trackingNumber ?? null,
          tracking_url: shipment.trackingUrl ?? null,
          carrier: shipment.trackingCarrier ?? null,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)

        await supabaseAdmin.from('store_orders').update({
          fulfillment_status: shipment.status,
          ...(justShipped ? {
            status: 'shipped',
            tracking_code: shipment.trackingNumber,
            tracking_url: shipment.trackingUrl ?? null,
          } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', row.order_id)

        updated++

        // Notify exactly once: only if this poll is the one that found tracking, AND we
        // haven't already recorded a successful notification for this shipment.
        if (justShipped && !row.customer_notified_at && order.customer_email) {
          const { data: versionRow } = await supabaseAdmin
            .from('manifest_versions')
            .select('manifest')
            .eq('project_id', projectId)
            .order('version_no', { ascending: false })
            .limit(1)
            .maybeSingle()

          const manifest = versionRow?.manifest as ShopManifest | undefined
          if (manifest) {
            const { subject, html } = shippingEmail({
              orderNumber: order.order_number,
              customerName: order.customer_name ?? 'zákazníku',
              storeName: manifest.brand.name,
              accentColor: manifest.design.palette.accent,
              merchantEmail: manifest.merchant?.kontakt.email ?? 'info@quantecode.com',
              merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
              trackingCode: shipment.trackingNumber as string,
              trackingUrl: shipment.trackingUrl ?? '',
              carrier: shipment.trackingCarrier || 'byrd fulfillment',
            })
            await sendEmail(order.customer_email, subject, html)
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
