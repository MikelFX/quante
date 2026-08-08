// GET /api/cron/fulfillment-stock — every 15 min Vercel cron (see vercel.json), per
// quante-fulfillment-byrd-spec.md section 5.
//
// For every project with byrd credentials configured AND at least one synced product
// (fulfillment_product_links row — see POST /api/projects/[id]/fulfillment/sync-products),
// pulls current stock levels from byrd and writes them into store_inventory.stock_qty, which
// is what the storefront's checkout/cart already reads (see migration-inventory.sql's
// decrement_stock() — same table, same column, no storefront changes needed for this to take
// effect: an out-of-stock byrd SKU makes checkout reject it the same way manually-set stock
// does today).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createFulfillmentProvider } from '@/lib/fulfillment/registry'

export const maxDuration = 120

interface LinkRow {
  project_id: string
  product_id: string
  variant_id: string | null
  sku: string
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization') ?? ''
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { data: links, error } = await supabaseAdmin
    .from('fulfillment_product_links')
    .select('project_id, product_id, variant_id, sku')
    .eq('provider', 'byrd')

  if (error) {
    if ((error as { code?: string }).code === '42P01') {
      return NextResponse.json({ ok: true, skipped: 'fulfillment_product_links table does not exist yet' })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (links ?? []) as LinkRow[]
  if (rows.length === 0) return NextResponse.json({ ok: true, projectsSynced: 0, skusUpdated: 0 })

  const byProject = new Map<string, LinkRow[]>()
  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? []
    list.push(row)
    byProject.set(row.project_id, list)
  }

  let projectsSynced = 0
  let skusUpdated = 0
  let failedProjects = 0

  for (const [projectId, projectLinks] of byProject) {
    const { data: secrets } = await supabaseAdmin
      .from('project_secrets')
      .select('byrd_api_key, byrd_api_secret')
      .eq('project_id', projectId)
      .maybeSingle()
    if (!secrets?.byrd_api_key || !secrets?.byrd_api_secret) continue // credentials removed since sync — skip, don't error

    const provider = createFulfillmentProvider('byrd', {
      apiKey: decryptSecret(secrets.byrd_api_key as string) as string,
      apiSecret: decryptSecret(secrets.byrd_api_secret as string) as string,
      projectId,
    })

    try {
      const skus = projectLinks.map((l) => l.sku)
      const stock = await provider.getStock(skus)
      const stockBySku = new Map(stock.map((s) => [s.sku, s.available]))

      for (const link of projectLinks) {
        const available = stockBySku.get(link.sku)
        if (available === undefined) continue // SKU not found in byrd's response this round — leave existing stock_qty untouched rather than zeroing it

        // store_inventory's real uniqueness is the expression index
        // (project_id, product_id, COALESCE(variant_id, '')) from migration-inventory.sql —
        // NOT a plain (project_id, product_id, variant_id) constraint, so a Supabase
        // .upsert({...}, { onConflict: '...' }) can't target it directly (ON CONFLICT
        // requires an exact constraint match, and Postgres treats NULL variant_id as
        // distinct from every other NULL under a plain unique index anyway). Select-then-
        // update-or-insert instead — safe under this cron's single-writer-at-a-time usage.
        let existingQuery = supabaseAdmin
          .from('store_inventory')
          .select('id')
          .eq('project_id', link.project_id)
          .eq('product_id', link.product_id)
        existingQuery = link.variant_id ? existingQuery.eq('variant_id', link.variant_id) : existingQuery.is('variant_id', null)
        const { data: existing } = await existingQuery.maybeSingle()

        if (existing) {
          await supabaseAdmin.from('store_inventory').update({
            stock_qty: available,
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
        } else {
          await supabaseAdmin.from('store_inventory').insert({
            project_id: link.project_id,
            product_id: link.product_id,
            variant_id: link.variant_id,
            stock_qty: available,
          })
        }
        skusUpdated++
      }

      await supabaseAdmin.from('project_secrets').update({
        byrd_last_stock_sync_at: new Date().toISOString(),
      }).eq('project_id', projectId).then(() => {}, () => {}) // best-effort — column added by migration-fulfillment-v2.sql's optional companion, see note below

      projectsSynced++
    } catch (err) {
      failedProjects++
      console.error(`[cron/fulfillment-stock] project ${projectId} stock sync failed:`, err)
    }
  }

  return NextResponse.json({ ok: true, projectsSynced, skusUpdated, failedProjects })
}
