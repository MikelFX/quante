// GET /api/store/agent?projectId=… — what a hosted store's agent layer (lib/agent-shop-data.ts in
// the store, lib/store-template/agent-shop.ts here) needs beyond its own files: shipping methods,
// the payment methods the merchant offers (with the cash-on-delivery fee), tracked stock and
// whether the store takes orders at all. Public, like /api/store/shipping: display data only —
// the checkout re-prices everything server-side (../_lib/pricing.ts). Pure mapping in
// lib/agent-shops/store-info.ts.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import { getHostingGate } from '@/lib/hosting/gate'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { loadStorePricing } from '../_lib/pricing'
import { storeAgentInfo } from '@/lib/agent-shops/store-info'

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!isUuid(projectId)) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!rateLimit(`store-agent:${getClientIp(request)}`, 600, 60_000).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const [pricing, gate, inv] = await Promise.all([
    loadStorePricing(projectId),
    getHostingGate(projectId),
    supabaseAdmin.from('store_inventory').select('product_id, variant_id, stock_qty').eq('project_id', projectId).limit(5000),
  ])
  if (!pricing) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  const live = gate.everLive === true && gate.canDeployProduction === true
  // A missing store_inventory table (migration not run) = stock is not tracked.
  const rows = inv.error ? [] : (inv.data ?? []) as Array<{ product_id: string; variant_id: string | null; stock_qty: number }>
  return NextResponse.json(storeAgentInfo(pricing, rows, live), {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' },
  })
}
