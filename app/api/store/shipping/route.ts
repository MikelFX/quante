// GET /api/store/shipping?projectId=...
// Public, hosted-mode endpoint: lets a deployed store's cart/checkout page fetch
// the merchant's configured shipping methods live, instead of baking them into
// the static build (same pattern as /api/store/legal and /api/store/checkout —
// see lib/store-template/build.ts's LegalPageView.tsx for the calling convention).
//
// Added 2026-08-22 alongside the market/language work: the code-gen checkout page
// previously never read shipping methods at all (flat "calculated at checkout"
// placeholder, no address collection), so a merchant's configured shipping prices
// in the Publish panel had no effect on what a customer actually paid.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface ShippingMethodEntry { id: string; label: string; price: number }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('project_secrets')
    .select('shipping_json')
    .eq('project_id', projectId)
    .maybeSingle()

  const shipping = data?.shipping_json as { methods?: ShippingMethodEntry[]; freeShippingFrom?: number } | null

  // Generic fallback for stores that haven't configured shipping yet — same
  // "don't block checkout on missing config" philosophy as the payments panel.
  const methods: ShippingMethodEntry[] = shipping?.methods?.length
    ? shipping.methods
    : [{ id: 'standard', label: 'Standard shipping', price: 0 }]

  return NextResponse.json(
    { methods, freeShippingFrom: shipping?.freeShippingFrom ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
