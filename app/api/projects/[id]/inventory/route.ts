// GET  /api/projects/[id]/inventory          — list all inventory rows for a project
// PUT  /api/projects/[id]/inventory          — upsert stock for a product/variant
// body: { productId, variantId?, stockQty, lowStockThreshold? }

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: rows, error } = await supabaseAdmin
    .from('store_inventory')
    .select('id, product_id, variant_id, stock_qty, low_stock_threshold, updated_at')
    .eq('project_id', projectId)
    .order('product_id')
    .order('variant_id', { nullsFirst: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const lowStock = (rows ?? []).filter((r) => r.stock_qty <= r.low_stock_threshold)

  return NextResponse.json({ inventory: rows ?? [], lowStock })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params

  const body: { productId: string; variantId?: string; stockQty: number; lowStockThreshold?: number } =
    await request.json()

  if (!body.productId || typeof body.stockQty !== 'number') {
    return NextResponse.json({ error: 'productId and stockQty are required' }, { status: 400 })
  }
  if (body.stockQty < 0) {
    return NextResponse.json({ error: 'stockQty must be >= 0' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('store_inventory')
    .upsert(
      {
        project_id: projectId,
        product_id: body.productId,
        variant_id: body.variantId ?? null,
        stock_qty: body.stockQty,
        ...(typeof body.lowStockThreshold === 'number'
          ? { low_stock_threshold: body.lowStockThreshold }
          : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,product_id,variant_id' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ row: data })
}
