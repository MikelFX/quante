import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, INTAKE_MODEL } from '@/lib/claude'
import { parseProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 120

const INSIGHTS_COST = 1
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour between paid refreshes

export interface InsightCard {
  category: 'finance' | 'ux'
  severity: 'good' | 'suggestion' | 'warning'
  title: string
  body: string
}

interface Params { params: Promise<{ id: string }> }

async function ownProject(projectId: string, userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects').select('id, name').eq('id', projectId).eq('user_id', userId).maybeSingle()
  return data
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await ownProject(id, userId)
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const { data: row } = await supabaseAdmin
    .from('store_insights').select('insights, updated_at').eq('project_id', id).maybeSingle()

  if (!row) return Response.json({ insights: null, updatedAt: null, stale: false })

  const ageMs = Date.now() - new Date(row.updated_at as string).getTime()
  return Response.json({
    insights: row.insights,
    updatedAt: row.updated_at,
    stale: ageMs > 7 * 24 * 3600 * 1000,
  })
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await ownProject(id, userId)
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  // Cooldown — protect against accidental double-spend
  const { data: existing } = await supabaseAdmin
    .from('store_insights').select('updated_at').eq('project_id', id).maybeSingle()
  if (existing && Date.now() - new Date(existing.updated_at as string).getTime() < REFRESH_COOLDOWN_MS) {
    return Response.json({ error: 'Insights were refreshed less than an hour ago. Try again later.' }, { status: 429 })
  }

  // Credits
  const { data: ledger } = await supabaseAdmin
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const balance = ledger?.balance_after ?? 0
  if (balance < INSIGHTS_COST) {
    return Response.json({ error: `Insufficient credits. Need ${INSIGHTS_COST}, have ${balance}.` }, { status: 402 })
  }

  // ── Gather store data ────────────────────────────────────────────────────
  const [versionResult, ordersResult, earningsResult] = await Promise.all([
    supabaseAdmin.from('code_versions').select('files')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('store_orders')
      .select('status, payment_status, payment_method, shipping_method, items, total_cents, currency, created_at')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('store_earnings')
      .select('gross_amount_cents, currency, created_at')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(200),
  ])

  const files = (versionResult.data?.files ?? {}) as CodeVersionFiles
  const products = files[PRODUCTS_FILE] ? parseProductsFile(files[PRODUCTS_FILE]) : null
  const configContent = files['data/config.ts'] ?? ''
  const currencyMatch = configContent.match(/currency:\s*['"]([A-Za-z]{3})['"]/)
  const currency = currencyMatch?.[1] ?? 'CZK'

  const orders = ordersResult.data ?? []
  const paidOrders = orders.filter(o => o.payment_status === 'paid')
  const revenue = (earningsResult.data ?? []).reduce((s, e) => s + (e.gross_amount_cents ?? 0), 0) / 100

  // Per-product sales from order items
  const salesByProduct: Record<string, number> = {}
  for (const o of paidOrders) {
    for (const item of (o.items as Array<{ id?: string; name?: string; quantity?: number }> ?? [])) {
      const key = item.name ?? item.id ?? '?'
      salesByProduct[key] = (salesByProduct[key] ?? 0) + (item.quantity ?? 1)
    }
  }

  const productSummary = (products ?? []).map(p => ({
    name: p.name,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    imagesCount: p.images.length,
    descriptionLength: p.description?.length ?? 0,
    available: p.available,
    sku: p.sku ?? null,
    tags: p.tags ?? [],
    unitsSold: salesByProduct[p.name] ?? 0,
  }))

  const storeData = {
    storeName: project.name,
    currency,
    products: productSummary,
    totals: {
      orders: orders.length,
      paidOrders: paidOrders.length,
      pendingOrders: orders.filter(o => o.payment_status === 'pending').length,
      grossRevenue: revenue,
      avgOrderValue: paidOrders.length
        ? Math.round(paidOrders.reduce((s, o) => s + (o.total_cents ?? 0), 0) / paidOrders.length) / 100
        : 0,
    },
    paymentMethodsUsed: [...new Set(orders.map(o => o.payment_method))],
    shippingMethodsUsed: [...new Set(orders.map(o => o.shipping_method).filter(Boolean))],
  }

  // ── Ask Claude for insight cards ─────────────────────────────────────────
  let insights: InsightCard[]
  try {
    const response = await anthropic.messages.create({
      model: INTAKE_MODEL,
      max_tokens: 2000,
      system: `You are an e-commerce analyst. Given store data (products, prices, sales), produce 4-8 concise, actionable insight cards as a JSON array. Each card: {"category":"finance"|"ux","severity":"good"|"suggestion"|"warning","title":"...","body":"..."}.
- finance: pricing gaps, sale opportunities (compareAtPrice), revenue concentration, average order value, unsold products.
- ux: missing product images, short/missing descriptions, missing SKUs, unavailable products, thin catalog.
- title max 60 chars, body max 220 chars, plain language, specific to the data (name real products).
- If the store has no orders yet, focus on catalog readiness instead of sales.
Output ONLY the JSON array — no prose, no markdown fences.`,
      messages: [{ role: 'user', content: JSON.stringify(storeData) }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    const parsed: unknown = JSON.parse(text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim())
    if (!Array.isArray(parsed)) throw new Error('Not an array')
    insights = parsed
      .filter((c): c is InsightCard =>
        typeof c === 'object' && c !== null &&
        ['finance', 'ux'].includes((c as InsightCard).category) &&
        ['good', 'suggestion', 'warning'].includes((c as InsightCard).severity) &&
        typeof (c as InsightCard).title === 'string' &&
        typeof (c as InsightCard).body === 'string')
      .slice(0, 10)
      .map(c => ({ category: c.category, severity: c.severity, title: c.title.slice(0, 80), body: c.body.slice(0, 300) }))
    if (insights.length === 0) throw new Error('No valid cards')
  } catch (err) {
    console.error('[insights]', err)
    return Response.json({ error: 'Analysis failed — no credits were charged. Please try again.' }, { status: 500 })
  }

  // ── Persist + debit (only after success) ─────────────────────────────────
  const now = new Date().toISOString()
  const [upsertResult] = await Promise.all([
    supabaseAdmin.from('store_insights').upsert(
      { project_id: id, user_id: userId, insights, updated_at: now },
      { onConflict: 'project_id' },
    ),
    supabaseAdmin.from('credit_ledger').insert({
      user_id: userId,
      delta: -INSIGHTS_COST,
      reason: 'insights',
      ref_id: id,
      balance_after: balance - INSIGHTS_COST,
    }),
  ])
  if (upsertResult.error) console.error('[insights upsert]', upsertResult.error)

  return Response.json({ insights, updatedAt: now, balance: balance - INSIGHTS_COST })
}
