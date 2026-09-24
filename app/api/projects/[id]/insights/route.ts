import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { anthropic, INTAKE_MODEL } from '@/lib/claude'
import { parseProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 120

const INSIGHTS_COST = 1
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour between paid refreshes
// SECURITY (audit F1): failed analyses are refunded, so the success-only cooldown above
// could be dodged forever by making the model fail (e.g. prompt injection in product
// names). Every ATTEMPT is now counted, refunded ones included:
//   - per user: 'insights' debits in the last hour (the debit row stays after a refund),
//     checked before debiting and re-counted after our own debit (race-safe on its own),
//   - per project: attempt rows in quante_request_attempts (route 'insights', ref_id =
//     project id), inserted BEFORE the Claude call and counted including our own row, so
//     concurrent requests can't all pass. One retry after a failure is allowed within
//     the cooldown window; a success still starts the full 1-hour cooldown.
const MAX_INSIGHTS_PER_USER_HOUR = 5
const MAX_ATTEMPTS_PER_PROJECT_WINDOW = 2
const ATTEMPT_ROUTE = 'insights'
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

// 42P01 = undefined_table (Postgres); PGRST205 = table not in PostgREST's schema cache.
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export interface InsightCard {
  category: 'finance' | 'ux'
  severity: 'good' | 'suggestion' | 'warning'
  title: string
  body: string
}

interface Params { params: Promise<{ id: string }> }

async function ownProject(projectId: string, userId: string) {
  return getOwnedProject<{ id: string; name: string }>(projectId, userId, 'id, name')
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

  // Per-user cap over every attempt in the last hour — refunded ones included, since the
  // debit row stays in the ledger after refundDebit. Fails closed on a lookup error.
  const windowStart = new Date(Date.now() - REFRESH_COOLDOWN_MS).toISOString()
  const { count: recentDebits, error: ledgerErr } = await supabaseAdmin
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reason', 'insights')
    .lt('delta', 0)
    .gte('created_at', windowStart)
  if (ledgerErr) {
    console.error('[insights] rate-limit lookup failed:', ledgerErr.message)
    return Response.json({ error: 'Could not start the analysis right now. Please try again.' }, { status: 503 })
  }
  if ((recentDebits ?? 0) >= MAX_INSIGHTS_PER_USER_HOUR) {
    return Response.json(
      { error: `Rate limit reached — max ${MAX_INSIGHTS_PER_USER_HOUR} store analyses per hour.` },
      { status: 429 },
    )
  }

  // Per-project attempt stamp, written BEFORE the paid Claude call (success or not).
  // Insert first, then count including our own row: the k-th concurrent insert sees
  // >= k rows, so at most the cap gets through. A refused request deletes its own row so
  // repeated clicks don't keep extending the window (passing rows are never deleted).
  const { data: attemptRow, error: attemptErr } = await supabaseAdmin
    .from('quante_request_attempts')
    .insert({ user_id: userId, route: ATTEMPT_ROUTE, ref_id: id })
    .select('id')
    .single()
  let attemptId: string | null = null
  if (attemptErr || !attemptRow) {
    if (!isMissingTable(attemptErr)) {
      console.error('[insights] attempt stamp failed:', attemptErr?.message)
      return Response.json({ error: 'Could not start the analysis right now. Please try again.' }, { status: 503 })
    }
    // Table missing (supabase/migration-security-iterate-fix-section.sql not run): the
    // per-user ledger cap (pre-check + post-debit re-count below) still bounds attempts.
    console.warn('[insights] quante_request_attempts missing — per-project attempt cap disabled')
  } else {
    attemptId = (attemptRow as { id: string }).id
    const countAttempts = (byProject: boolean) => {
      let q = supabaseAdmin
        .from('quante_request_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('route', ATTEMPT_ROUTE)
        .gte('created_at', windowStart)
      if (byProject) q = q.eq('ref_id', id)
      return q
    }
    const [projectRes, userRes] = await Promise.all([countAttempts(true), countAttempts(false)])
    const refuse = async (status: number, error: string) => {
      await supabaseAdmin.from('quante_request_attempts').delete().eq('id', attemptId as string)
      return Response.json({ error }, { status })
    }
    if (projectRes.error || userRes.error) {
      console.error('[insights] attempt count failed:', (projectRes.error ?? userRes.error)?.message)
      return refuse(503, 'Could not start the analysis right now. Please try again.')
    }
    if ((projectRes.count ?? 0) > MAX_ATTEMPTS_PER_PROJECT_WINDOW) {
      return refuse(429, 'Too many analysis attempts for this store in the last hour. Try again later.')
    }
    if ((userRes.count ?? 0) > MAX_INSIGHTS_PER_USER_HOUR) {
      return refuse(429, `Rate limit reached — max ${MAX_INSIGHTS_PER_USER_HOUR} store analyses per hour.`)
    }
  }

  // Credits — debit atomically BEFORE the paid Claude call; refunded on any failure
  // below. (Previously a read-then-insert that computed balance_after in app code,
  // which raced and could mint/lose credits.)
  const debitRef = randomUUID()
  const debit = await debitCredits(userId, INSIGHTS_COST, 'insights', debitRef)
  if (!debit.ok) {
    // Nothing was debited and Claude is not called — don't let this use up an attempt.
    if (attemptId) await supabaseAdmin.from('quante_request_attempts').delete().eq('id', attemptId)
    if (debit.error === 'insufficient_credits') {
      const have = debit.balance ?? 0
      return Response.json({ error: `Insufficient credits. Need ${INSIGHTS_COST}, have ${have}.` }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return Response.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return Response.json({ error: 'Could not reserve credits. Please try again.' }, { status: 500 })
  }
  const balance = debit.balance

  // Re-count AFTER our own debit row exists (it is included). The pre-check above is
  // check-then-debit, so concurrent POSTs across projects could all pass it; the k-th
  // concurrent debit here sees >= k rows, so at most the cap proceed to Claude even when
  // quante_request_attempts is missing. Over the cap → refund and refuse (the refunded
  // debit row stays counted, like any other refunded attempt).
  const { count: debitsNow, error: recountErr } = await supabaseAdmin
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reason', 'insights')
    .lt('delta', 0)
    .gte('created_at', windowStart)
  if (recountErr || (debitsNow ?? 0) > MAX_INSIGHTS_PER_USER_HOUR) {
    if (recountErr) console.error('[insights] rate-limit recount failed:', recountErr.message)
    await refundDebit(userId, debitRef, 'insights', 'insights_failed')
    if (attemptId) await supabaseAdmin.from('quante_request_attempts').delete().eq('id', attemptId)
    return recountErr
      ? Response.json({ error: 'Could not start the analysis right now. Please try again.' }, { status: 503 })
      : Response.json(
          { error: `Rate limit reached — max ${MAX_INSIGHTS_PER_USER_HOUR} store analyses per hour.` },
          { status: 429 },
        )
  }

  try {
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
      await refundDebit(userId, debitRef, 'insights', 'insights_failed')
      return Response.json({ error: 'Analysis failed — no credits were charged. Please try again.' }, { status: 500 })
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const now = new Date().toISOString()
    const upsertResult = await supabaseAdmin.from('store_insights').upsert(
      { project_id: id, user_id: userId, insights, updated_at: now },
      { onConflict: 'project_id' },
    )
    if (upsertResult.error) console.error('[insights upsert]', upsertResult.error)

    return Response.json({ insights, updatedAt: now, balance })
  } catch (err) {
    // Unexpected failure anywhere after the debit — give the credit back.
    console.error('[insights] unexpected', err)
    await refundDebit(userId, debitRef, 'insights', 'insights_failed')
    return Response.json({ error: 'Analysis failed — no credits were charged. Please try again.' }, { status: 500 })
  }
}
