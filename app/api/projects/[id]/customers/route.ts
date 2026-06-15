// GET /api/projects/[id]/customers
// Aggregates unique customers from store_orders for this project.
// Authenticated via Clerk (merchant's own session).

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

  const { data: rows } = await supabaseAdmin
    .from('store_orders')
    .select('customer_email, customer_name, customer_phone, total_cents, currency, payment_status, created_at')
    .eq('project_id', projectId)
    .not('customer_email', 'is', null)
    .order('created_at', { ascending: false })

  // Aggregate by email
  const map = new Map<string, {
    email: string
    name: string
    phone: string | null
    orderCount: number
    totalSpent: number
    currency: string
    firstOrderAt: string
    lastOrderAt: string
  }>()

  for (const row of rows ?? []) {
    const email = row.customer_email as string
    const existing = map.get(email)
    const paid = row.payment_status === 'paid'
    if (existing) {
      existing.orderCount += 1
      if (paid) existing.totalSpent += (row.total_cents as number) / 100
      if (row.created_at < existing.firstOrderAt) existing.firstOrderAt = row.created_at as string
      if (row.created_at > existing.lastOrderAt) existing.lastOrderAt = row.created_at as string
      if (!existing.name && row.customer_name) existing.name = row.customer_name as string
    } else {
      map.set(email, {
        email,
        name: (row.customer_name as string) ?? '',
        phone: (row.customer_phone as string) ?? null,
        orderCount: 1,
        totalSpent: paid ? (row.total_cents as number) / 100 : 0,
        currency: ((row.currency as string) ?? 'czk').toUpperCase(),
        firstOrderAt: row.created_at as string,
        lastOrderAt: row.created_at as string,
      })
    }
  }

  const customers = Array.from(map.values()).sort(
    (a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime()
  )

  return NextResponse.json({ customers, total: customers.length })
}
