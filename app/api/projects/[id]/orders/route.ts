// GET /api/projects/[id]/orders — legacy "Stripe orders" panel in the Studio.
//
// SECURITY: this route used to read the merchant's own Stripe secret key from
// project_secrets.stripe_secret_key (stored in PLAINTEXT by the old admin panel) and
// call their Stripe account with it. Payments are now managed and every order lands in
// store_orders, so the route serves paid store_orders in the legacy response shape and
// never touches merchant Stripe keys. See supabase/migration-security-projects-misc.sql
// for the migration that wipes the legacy plaintext key columns.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'

interface OrderItem { name?: unknown; quantity?: unknown; price?: unknown }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = await getOwnedProject(projectId, userId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: rows, error } = await supabaseAdmin
    .from('store_orders')
    .select('id, customer_email, customer_name, total_cents, currency, payment_status, items, created_at')
    .eq('project_id', projectId)
    .eq('payment_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[projects/orders] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load orders.' }, { status: 500 })
  }

  const orders = (rows ?? []).map((o) => {
    const items = Array.isArray(o.items) ? (o.items as OrderItem[]) : []
    return {
      id: o.id as string,
      customerEmail: (o.customer_email as string | null) ?? '—',
      customerName: (o.customer_name as string | null) ?? '—',
      amount: ((o.total_cents as number | null) ?? 0) / 100,
      currency: ((o.currency as string | null) ?? 'czk').toUpperCase(),
      status: o.payment_status as string,
      items: items.map((li) => {
        const qty = typeof li.quantity === 'number' ? li.quantity : 1
        const price = typeof li.price === 'number' ? li.price : 0
        return { name: typeof li.name === 'string' ? li.name : '—', qty, amount: price * qty }
      }),
      createdAt: o.created_at as string,
    }
  })

  const revenue = orders.reduce((sum, o) => sum + o.amount, 0)

  // Balances lived in the merchant's own Stripe account; they are no longer queried.
  return NextResponse.json({ orders, revenue, available: 0, pending: 0 })
}
