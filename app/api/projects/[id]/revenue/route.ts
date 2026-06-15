// GET /api/projects/[id]/revenue?days=30
// Returns daily revenue breakdown for the past N days.
// Authenticated via Clerk (merchant's own session).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const url = new URL(request.url)
  const days = Math.min(parseInt(url.searchParams.get('days') ?? '30', 10), 365)

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const since = new Date()
  since.setDate(since.getDate() - days + 1)
  since.setHours(0, 0, 0, 0)

  const { data: rows } = await supabaseAdmin
    .from('store_orders')
    .select('total_cents, currency, payment_status, created_at')
    .eq('project_id', projectId)
    .eq('payment_status', 'paid')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })

  // Build day-indexed map
  const dayMap = new Map<string, { revenue: number; orders: number }>()
  for (let i = 0; i < days; i++) {
    const d = new Date(since)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { revenue: 0, orders: 0 })
  }

  const currency = (rows?.[0]?.currency as string ?? 'czk').toUpperCase()

  for (const row of rows ?? []) {
    const key = (row.created_at as string).slice(0, 10)
    const existing = dayMap.get(key)
    if (existing) {
      existing.revenue += (row.total_cents as number) / 100
      existing.orders += 1
    }
  }

  const chartData = Array.from(dayMap.entries()).map(([date, v]) => ({
    date,
    revenue: Math.round(v.revenue * 100) / 100,
    orders: v.orders,
  }))

  const totalRevenue = chartData.reduce((s, d) => s + d.revenue, 0)
  const totalOrders = chartData.reduce((s, d) => s + d.orders, 0)

  return NextResponse.json({ chartData, totalRevenue, totalOrders, currency, days })
}
