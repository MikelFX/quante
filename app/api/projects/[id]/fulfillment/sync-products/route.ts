// POST /api/projects/[id]/fulfillment/sync-products
// Manual, merchant-triggered product sync (Quante -> byrd) — quante-fulfillment-byrd-spec.md
// section 4: "Manuální akce z adminu, ne automat při každém uložení produktu." Not wired to
// any admin UI yet (see the note in docs/update-log.md about section 8 / admin UI being out of
// scope for this pass) — callable directly today, ready for a UI to POST to once built.
//
// Body: { products: [{ productId, variantId?, name, priceCents, currency, weightKg? }] }
// productId/variantId must match an existing store_inventory row (lib/fulfillment/types.ts
// QuanteProduct doc comment explains why product_id doubles as the SKU). name/priceCents come
// from the caller rather than being looked up here, because product name/price live in each
// store's generated data/products.ts source file (parsed client-side today via
// lib/store-products.ts), not in a DB column this route could read directly.
//
// Idempotent: re-syncing an already-linked product updates the existing
// fulfillment_product_links row (and re-POSTs to byrd, since byrd's create-product endpoint
// has no documented update-by-SKU semantics — see providers/byrd/index.ts syncProduct() doc
// comment) rather than creating a duplicate link row.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { createFulfillmentProvider } from '@/lib/fulfillment/registry'

interface SyncProductInput {
  productId: string
  variantId?: string | null
  name: string
  priceCents: number
  currency: string
  weightKg?: number
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params

  const { data: project } = await supabaseAdmin
    .from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('byrd_api_key, byrd_api_secret')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!secrets?.byrd_api_key || !secrets?.byrd_api_secret) {
    return NextResponse.json({ error: 'byrd API credentials not configured. Add them in Admin → Settings.' }, { status: 422 })
  }

  const body = await request.json().catch(() => ({})) as { products?: SyncProductInput[] }
  const products = body.products ?? []
  if (products.length === 0) {
    return NextResponse.json({ error: 'products array is required and must be non-empty' }, { status: 400 })
  }
  const withoutSku = products.filter((p) => !p.productId)
  if (withoutSku.length > 0) {
    // Spec section 4: "Produkt bez SKU sync neprojde — vrať srozumitelnou chybu."
    return NextResponse.json({ error: `${withoutSku.length} product(s) missing productId (used as SKU) — cannot sync.` }, { status: 422 })
  }

  const provider = createFulfillmentProvider('byrd', {
    apiKey: decryptSecret(secrets.byrd_api_key as string) as string,
    apiSecret: decryptSecret(secrets.byrd_api_secret as string) as string,
    projectId,
  })

  const results: Array<{ productId: string; variantId: string | null; ok: boolean; externalId?: string; error?: string }> = []

  for (const p of products) {
    const variantId = p.variantId ?? null
    const sku = variantId ? `${p.productId}-${variantId}` : p.productId
    try {
      const { externalId } = await provider.syncProduct({
        sku,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        weightKg: p.weightKg,
      })

      // See migration-fulfillment-v2.sql header re: expression-based unique index — check-
      // then-write rather than .upsert({onConflict}) for the same reason as the stock-sync cron.
      let existingQuery = supabaseAdmin
        .from('fulfillment_product_links')
        .select('id')
        .eq('project_id', projectId)
        .eq('provider', 'byrd')
        .eq('product_id', p.productId)
      existingQuery = variantId ? existingQuery.eq('variant_id', variantId) : existingQuery.is('variant_id', null)
      const { data: existingLink } = await existingQuery.maybeSingle()

      if (existingLink) {
        await supabaseAdmin.from('fulfillment_product_links').update({
          sku, external_product_id: externalId, synced_at: new Date().toISOString(),
        }).eq('id', existingLink.id)
      } else {
        await supabaseAdmin.from('fulfillment_product_links').insert({
          project_id: projectId, provider: 'byrd', product_id: p.productId, variant_id: variantId,
          sku, external_product_id: externalId,
        })
      }

      results.push({ productId: p.productId, variantId, ok: true, externalId })
    } catch (err) {
      results.push({ productId: p.productId, variantId, ok: false, error: err instanceof Error ? err.message : 'sync failed' })
    }
  }

  const failedCount = results.filter((r) => !r.ok).length
  return NextResponse.json({ ok: failedCount === 0, results })
}
