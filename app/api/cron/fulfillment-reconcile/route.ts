// GET /api/cron/fulfillment-reconcile — every 15 min Vercel cron (see vercel.json).
//
// quante-fulfillment-byrd-spec.md section 6: a shipment-creation attempt that fails ambiguously
// (timeout, connection drop, unclear response) is NEVER retried automatically inline — see
// lib/fulfillment/auto-ship.ts and providers/byrd/client.ts (createShipment always passes
// retryable: false). Instead the fulfillment_shipments row is left in 'creating' status, and
// this cron is the only thing that ever resolves it, by asking byrd directly whether a
// shipment actually exists for that order:
//
//   - Found in byrd -> we DID create it, the error was purely in receiving/processing our own
//     response. Adopt the real external_shipment_id, mark 'created'. No duplicate risk.
//   - Not found in byrd (after this row has been sitting in 'creating' for >10 minutes, which
//     is generously longer than any real byrd API call takes) -> the original attempt almost
//     certainly never reached byrd. Mark 'failed' so it shows up in the admin UI's "failed
//     shipments, retry manually" list (spec section 8) — deliberately NOT auto-retried here,
//     since an automatic retry immediately after a "not found" read is exactly the small race
//     window where a slow-but-actually-successful original request could still land right
//     after this check and produce a real duplicate. A human clicking "retry" goes through
//     POST .../fulfillment again, which is safe because THAT insert would now fail on the
//     unique(order_id) constraint if the row is still 'creating' — it only proceeds once this
//     cron has moved the row to 'failed'.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { findByrdShipmentByOrderId } from '@/lib/fulfillment/providers/byrd'

export const maxDuration = 120

const TEN_MINUTES_MS = 10 * 60 * 1000

interface StuckRow {
  id: string
  project_id: string
  order_id: string
  provider: string
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

  const cutoff = new Date(Date.now() - TEN_MINUTES_MS).toISOString()

  const { data: stuck, error } = await supabaseAdmin
    .from('fulfillment_shipments')
    .select('id, project_id, order_id, provider, created_at')
    .eq('status', 'creating')
    .lt('created_at', cutoff)

  if (error) {
    if ((error as { code?: string }).code === '42P01') {
      return NextResponse.json({ ok: true, skipped: 'fulfillment_shipments table does not exist yet' })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (stuck ?? []) as StuckRow[]
  if (rows.length === 0) return NextResponse.json({ ok: true, checked: 0 })

  let adopted = 0
  let markedFailed = 0
  let errors = 0

  for (const row of rows) {
    if (row.provider !== 'byrd') continue // only byrd supports order-id lookup today — see providers/byrd/index.ts

    try {
      const { data: order } = await supabaseAdmin
        .from('store_orders')
        .select('order_number')
        .eq('id', row.order_id)
        .maybeSingle()
      if (!order) continue

      const { data: secrets } = await supabaseAdmin
        .from('project_secrets')
        .select('byrd_api_key, byrd_api_secret')
        .eq('project_id', row.project_id)
        .maybeSingle()
      if (!secrets?.byrd_api_key || !secrets?.byrd_api_secret) continue

      const creds = {
        apiKey: decryptSecret(secrets.byrd_api_key as string) as string,
        apiSecret: decryptSecret(secrets.byrd_api_secret as string) as string,
        projectId: row.project_id,
      }

      const found = await findByrdShipmentByOrderId(creds, row.order_id, order.order_number as string)

      if (found) {
        await supabaseAdmin.from('fulfillment_shipments').update({
          status: 'created',
          external_shipment_id: found.externalId,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        await supabaseAdmin.from('store_orders').update({
          fulfillment_provider: 'byrd',
          fulfillment_ref: found.externalId,
          fulfillment_status: found.status,
          updated_at: new Date().toISOString(),
        }).eq('id', row.order_id)
        adopted++
      } else {
        await supabaseAdmin.from('fulfillment_shipments').update({
          status: 'failed',
          error: 'Reconciliation: no matching shipment found in byrd after 10+ minutes — original creation attempt likely never reached byrd. Retry from the admin order list.',
          attempts: 1,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        markedFailed++
      }
    } catch (err) {
      errors++
      console.error(`[cron/fulfillment-reconcile] shipment ${row.id} (order ${row.order_id}) reconciliation failed:`, err)
      // Leave in 'creating' — next run tries again. Never guess here.
    }
  }

  return NextResponse.json({ ok: true, checked: rows.length, adopted, markedFailed, errors })
}
