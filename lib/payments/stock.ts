// Stock decrement on payment capture (hosted stores, store_inventory).
//
// Checkout only does a read-only stock check (app/api/store/_lib/pricing.ts
// findOutOfStock) — nothing is reserved, so an abandoned card checkout never locks
// stock. The decrement happens here, once the money has actually arrived.
//
// EXACTLY-ONCE: callers must invoke this ONLY after an atomic conditional update of
// the order (payment_status 'pending' → 'paid') reported that it changed a row. That
// transition happens once per order, so webhook/notify retries never decrement twice.
//
// NEVER BLOCKS A PAYMENT: the payment has already been taken when this runs. A line
// whose stock is insufficient (decrement_stock() returns false — the SQL function never
// lets stock_qty go negative) is logged as an oversell for the merchant to resolve;
// errors are logged, never thrown.

import { supabaseAdmin } from '@/lib/supabase/admin'

type OrderLine = { id?: unknown; variantId?: unknown; quantity?: unknown }

function normaliseLines(items: unknown): Array<{ productId: string; variantId: string | null; quantity: number }> {
  if (!Array.isArray(items)) return []
  // Merge duplicate lines so each inventory row is decremented once with the total.
  const merged = new Map<string, { productId: string; variantId: string | null; quantity: number }>()
  for (const raw of items as OrderLine[]) {
    if (!raw || typeof raw !== 'object') continue
    const productId = typeof raw.id === 'string' ? raw.id : null
    const variantId = typeof raw.variantId === 'string' && raw.variantId ? raw.variantId : null
    const quantity = Number(raw.quantity)
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) continue
    const key = `${productId}\u0000${variantId ?? ''}`
    const prev = merged.get(key)
    if (prev) prev.quantity += quantity
    else merged.set(key, { productId, variantId, quantity })
  }
  return [...merged.values()]
}

export async function decrementStockForOrder(order: { id: string; project_id: string; items?: unknown }): Promise<void> {
  try {
    const lines = normaliseLines(order.items)
    if (lines.length === 0) return

    // Only tracked lines (an existing store_inventory row) are decremented; untracked
    // products have unlimited stock. This also tells an oversell apart from "untracked"
    // when decrement_stock() returns false.
    const { data: rows, error } = await supabaseAdmin
      .from('store_inventory')
      .select('product_id, variant_id')
      .eq('project_id', order.project_id)
      .in('product_id', [...new Set(lines.map((l) => l.productId))])
    if (error) {
      // Table missing (migration not run) → inventory isn't tracked.
      console.warn(`[stock] inventory lookup failed for order ${order.id}: ${error.message}`)
      return
    }
    const tracked = new Set(
      ((rows ?? []) as Array<{ product_id: string; variant_id: string | null }>)
        .map((r) => `${r.product_id}\u0000${r.variant_id ?? ''}`),
    )

    for (const line of lines) {
      if (!tracked.has(`${line.productId}\u0000${line.variantId ?? ''}`)) continue
      const { data: ok, error: rpcErr } = await supabaseAdmin.rpc('decrement_stock', {
        p_project_id: order.project_id,
        p_product_id: line.productId,
        p_variant_id: line.variantId,
        p_qty: line.quantity,
      })
      if (rpcErr) {
        console.error(`[stock] decrement_stock failed for order ${order.id} (${line.productId}/${line.variantId ?? '-'}): ${rpcErr.message}`)
      } else if (ok !== true) {
        console.error(
          `[stock] OVERSELL: order ${order.id} (project ${order.project_id}) paid for ${line.quantity}× ` +
          `${line.productId}/${line.variantId ?? '-'} but stock is insufficient — stock left unchanged, merchant must resolve.`,
        )
      }
    }
  } catch (err) {
    console.error(`[stock] decrement for order ${order.id} failed:`, err)
  }
}
