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
//
// 2026-11-25: also returns `payments` — the methods the shopper may pick (card,
// a gateway with the merchant's own credentials, bank transfer, cash on delivery
// with its fee). The code-gen cart had no payment picker, so bank transfer / COD /
// Comgate / GoPay saved in the Studio were never offered and every order went to
// card. Same rules as the checkout (../_lib/pricing.ts) and /api/store/agent.
//
// The checkout (/api/store/checkout) recomputes shipping from the same
// project_secrets.shipping_json server-side (../_lib/pricing.ts), so what this
// returns is display-only — the client can't change what is actually charged.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import { loadStorePricing } from '../_lib/pricing'
import { offeredPayments, usableOnlineMethods, type OfferedPayment } from '@/lib/agent-shops/store-info'
import { getProjectPaymentCreds, comgateForProject, gopayForProject, paypalForProject } from '@/lib/payments/project-providers'

interface ShippingMethodEntry { id: string; label: string; price: number }

async function paymentsFor(projectId: string): Promise<OfferedPayment[]> {
  try {
    const [pricing, creds] = await Promise.all([loadStorePricing(projectId), getProjectPaymentCreds(projectId)])
    if (!pricing) return []
    const onlineMethods = usableOnlineMethods(pricing.onlineMethods, {
      comgate: !!comgateForProject(creds), gopay: !!gopayForProject(creds), paypal: !!paypalForProject(creds),
    })
    return offeredPayments({ ...pricing, onlineMethods })
  } catch (err) {
    // Without the list the cart falls back to card, as before.
    console.error('[store/shipping] payment methods lookup failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!isUuid(projectId)) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const [{ data }, payments] = await Promise.all([
    supabaseAdmin
      .from('project_secrets')
      .select('shipping_json')
      .eq('project_id', projectId)
      .maybeSingle(),
    paymentsFor(projectId),
  ])

  const shipping = data?.shipping_json as { methods?: ShippingMethodEntry[]; freeShippingFrom?: number } | null

  // Generic fallback for stores that haven't configured shipping yet — same
  // "don't block checkout on missing config" philosophy as the payments panel.
  // Only the public fields, normalised (the JSON blob is merchant-written).
  const configured = Array.isArray(shipping?.methods)
    ? shipping!.methods
        .map((m) => ({ id: String(m?.id ?? ''), label: String(m?.label ?? '').slice(0, 200), price: Number(m?.price) }))
        .filter((m) => m.id && Number.isFinite(m.price) && m.price >= 0)
    : []
  const methods: ShippingMethodEntry[] = configured.length
    ? configured
    : [{ id: 'standard', label: 'Standard shipping', price: 0 }]
  const freeFrom = Number(shipping?.freeShippingFrom)

  return NextResponse.json(
    {
      methods,
      freeShippingFrom: Number.isFinite(freeFrom) && freeFrom > 0 ? freeFrom : 0,
      payments: payments.map((p) => ({ id: p.id, kind: p.kind, fee: p.fee })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
