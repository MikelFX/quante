import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const supabase = await createClient()

  // Ownership check + get Stripe key
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('stripe_secret_key')
    .eq('project_id', projectId)
    .maybeSingle()

  const key = secrets?.stripe_secret_key
  if (!key || key.startsWith('sk_live_replace') || key.startsWith('sk_test_replace')) {
    return NextResponse.json({ error: 'NO_STRIPE_KEY' }, { status: 400 })
  }

  try {
    const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' as '2026-05-27.dahlia' })

    const [sessions, balance] = await Promise.all([
      stripe.checkout.sessions.list({ limit: 50, expand: ['data.line_items'] }),
      stripe.balance.retrieve(),
    ])

    const orders = sessions.data
      .filter((s) => s.payment_status === 'paid')
      .map((s) => ({
        id: s.id,
        customerEmail: s.customer_details?.email ?? '—',
        customerName: s.customer_details?.name ?? '—',
        amount: s.amount_total ? s.amount_total / 100 : 0,
        currency: (s.currency ?? 'usd').toUpperCase(),
        status: s.payment_status,
        items: s.line_items?.data.map((li) => ({
          name: li.description ?? li.price?.nickname ?? '—',
          qty: li.quantity ?? 1,
          amount: li.amount_total ? li.amount_total / 100 : 0,
        })) ?? [],
        createdAt: new Date(s.created * 1000).toISOString(),
      }))

    const revenue = orders.reduce((sum, o) => sum + o.amount, 0)

    const available = balance.available.reduce((sum, b) => sum + b.amount / 100, 0)
    const pending   = balance.pending.reduce((sum, b) => sum + b.amount / 100, 0)

    return NextResponse.json({ orders, revenue, available, pending })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
