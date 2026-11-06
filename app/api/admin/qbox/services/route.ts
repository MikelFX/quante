// Admin → Qbox services (2026-11-06): every listed service with its sales and reports; the operator
// blocks or unblocks one. Admin only (requireAdmin, fails closed). Blocking only stops the gateway
// and hides the service from the directory; it never moves anyone's money (we hold none).
//
// GET  /api/admin/qbox/services → { setUp, services: [...], stats }
// POST /api/admin/qbox/services { slug, action: 'block' | 'unblock', reason? }

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/qbox/store'
import { parseSlug, statsOf, usdText, type CallRow } from '@/lib/qbox/services/model'
import { serviceStats } from '@/lib/qbox/services/stats'

const err = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  const [svc, reports] = await Promise.all([
    supabaseAdmin.from('qbox_services').select('id, slug, user_id, name, price_units, status, wallet, network, blocked_reason, created_at, upstream')
      .order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('qbox_service_reports').select('service_id, reason, reporter, created_at').order('created_at', { ascending: false }).limit(1000),
  ])
  if (isMissingTable(svc.error) || isMissingTable(reports.error)) return NextResponse.json({ setUp: false, services: [], stats: null })
  if (svc.error || reports.error) return err(500, 'Could not load services.')
  const ids = (svc.data ?? []).map((s) => s.id)
  const calls = ids.length
    ? ((await supabaseAdmin.from('qbox_service_calls').select('service_id, seller_id, payer, price_units, status, created_at').in('service_id', ids).limit(50_000)).data ?? []) as CallRow[]
    : []
  const services = (svc.data ?? []).map((s) => ({
    slug: s.slug, name: s.name, sellerId: s.user_id, priceUsd: usdText(Number(s.price_units)), status: s.status, wallet: s.wallet,
    network: s.network, blockedReason: s.blocked_reason, listedAt: s.created_at,
    upstream: (s.upstream as { kind: string; url?: string; sandboxId?: string })?.url ?? `sandbox ${(s.upstream as { sandboxId?: string })?.sandboxId ?? ''}`,
    stats: statsOf(calls.filter((c) => c.service_id === s.id)),
    reports: (reports.data ?? []).filter((r) => r.service_id === s.id).slice(0, 10).map((r) => ({ reason: r.reason, reporter: r.reporter, at: r.created_at })),
  }))
  return NextResponse.json({ setUp: true, services, stats: await serviceStats() })
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  const body = (await request.json().catch(() => null)) as { slug?: unknown; action?: unknown; reason?: unknown } | null
  let slug: string
  try {
    slug = parseSlug(body?.slug)
  } catch {
    return err(400, 'Unknown service.')
  }
  if (body?.action !== 'block' && body?.action !== 'unblock') return err(400, 'action: block or unblock.')
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null
  const patch = body.action === 'block'
    ? { status: 'blocked', blocked_reason: reason ?? 'blocked by the operator', updated_at: new Date().toISOString() }
    : { status: 'paused', blocked_reason: null, updated_at: new Date().toISOString() }
  const q = supabaseAdmin.from('qbox_services').update(patch).eq('slug', slug)
  const { error } = body.action === 'unblock' ? await q.eq('status', 'blocked') : await q
  if (error) return err(isMissingTable(error) ? 503 : 500, isMissingTable(error) ? 'Run supabase/migration-qbox-services.sql first.' : 'Could not save.')
  return NextResponse.json({ ok: true })
}
