// Admin → Suppliers (CLAUDE.md §13r): the dropship partners whose feeds make the catalog.
//   GET   → { setUp, suppliers: [...settings, product_count, last import] }
//   POST  { action: 'save', id?, ...settings }  create / update (lib/suppliers/model.ts parseSupplierInput)
//         { action: 'import', id }              import that supplier's feed now
//         { action: 'pause' | 'resume', id }    paused = out of the catalog; paid orders still go out
// Admin only (lib/admin.ts requireAdmin; fails closed). Nothing here charges anyone.
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/qbox/store'
import { parseSupplierInput, type Supplier } from '@/lib/suppliers/model'
import { importSupplier, SUPPLIER_COLUMNS } from '@/lib/suppliers/import'

export const maxDuration = 300

const err = (status: number, error: string) => NextResponse.json({ error }, { status })
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

export async function GET() {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .select(`${SUPPLIER_COLUMNS}, product_count, last_import_at, last_import_error, created_at`)
    .order('created_at', { ascending: false })
  if (isMissingTable(error)) return NextResponse.json({ setUp: false, suppliers: [] })
  if (error) return err(500, 'Could not load suppliers.')
  const ids = (data ?? []).map((s) => s.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: links } = await supabaseAdmin.from('store_supplier_links').select('supplier_id').in('supplier_id', ids).limit(10000)
    for (const l of links ?? []) counts.set(l.supplier_id as string, (counts.get(l.supplier_id as string) ?? 0) + 1)
  }
  return NextResponse.json({ setUp: true, suppliers: (data ?? []).map((s) => ({ ...s, linked: counts.get(s.id as string) ?? 0 })) })
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const now = new Date().toISOString()

  if (body.action === 'save') {
    const parsed = parseSupplierInput(body)
    if (!parsed.ok) return err(400, parsed.error)
    const q = isId(body.id)
      ? supabaseAdmin.from('suppliers').update({ ...parsed.value, updated_at: now }).eq('id', body.id)
      : supabaseAdmin.from('suppliers').insert(parsed.value)
    const { data, error } = await q.select('id').single()
    if (isMissingTable(error)) return err(503, 'Run supabase/migration-supplier-catalog.sql first.')
    if (error?.code === '23505') return err(409, 'That slug is taken.')
    if (error || !data) return err(500, 'Could not save.')
    return NextResponse.json({ ok: true, id: data.id })
  }

  if (!isId(body.id)) return err(400, 'id required')

  if (body.action === 'pause' || body.action === 'resume') {
    const { error } = await supabaseAdmin.from('suppliers').update({ status: body.action === 'pause' ? 'paused' : 'active', updated_at: now }).eq('id', body.id)
    if (error) return err(500, 'Could not save.')
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'import') {
    const { data } = await supabaseAdmin.from('suppliers').select(SUPPLIER_COLUMNS).eq('id', body.id).maybeSingle()
    if (!data) return err(404, 'Not found')
    return NextResponse.json(await importSupplier(data as Supplier))
  }

  return err(400, 'Unknown action')
}
