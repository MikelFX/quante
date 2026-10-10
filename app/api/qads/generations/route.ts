// GET /api/qads/generations — list the signed-in user's generations, newest
// first. Includes a lightweight item-count summary per generation for the
// history list, without dragging every item + copy row over the wire.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingCommunityColumn } from '@/lib/qads/community'

interface GenRow {
  id: string; product_name: string; output_types: string[]; formats: string[]; style: string
  variants_per_format: number; total_credits_reserved: number; status: string
  created_at: string; completed_at: string | null; share_community?: boolean
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const COLS = 'id, product_name, output_types, formats, style, variants_per_format, total_credits_reserved, status, created_at, completed_at'
  const list = (cols: string) => supabaseAdmin
    .from('qads_generations')
    .select(cols)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  let { data: rows, error } = await list(COLS + ', share_community')
  // Before supabase/migration-qads-community.sql there is no share flag — nothing is shared.
  if (error && isMissingCommunityColumn(error)) ({ data: rows, error } = await list(COLS))
  if (error) return NextResponse.json({ error: 'Failed to load generations' }, { status: 500 })
  const gens = (rows ?? []) as unknown as GenRow[]

  // Per-generation counts of completed vs total items, so the history row
  // can render "12 / 16 completed" without another round-trip per row.
  const ids = gens.map(r => r.id)
  const counts: Record<string, { total: number; completed: number; failed: number }> = {}
  if (ids.length) {
    const { data: itemAgg } = await supabaseAdmin
      .from('qads_items')
      .select('generation_id, status')
      .in('generation_id', ids)
    for (const it of itemAgg ?? []) {
      const gid = it.generation_id as string
      const c = counts[gid] ?? { total: 0, completed: 0, failed: 0 }
      c.total += 1
      if (it.status === 'completed') c.completed += 1
      if (it.status === 'failed' || it.status === 'nsfw' || it.status === 'canceled') c.failed += 1
      counts[gid] = c
    }
  }

  return NextResponse.json({
    generations: gens.map(r => ({
      id: r.id,
      productName: r.product_name,
      outputTypes: r.output_types,
      formats: r.formats,
      style: r.style,
      variantsPerFormat: r.variants_per_format,
      totalCredits: r.total_credits_reserved,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      itemCounts: counts[r.id] ?? { total: 0, completed: 0, failed: 0 },
      shareCommunity: r.share_community === true,
    })),
  })
}
