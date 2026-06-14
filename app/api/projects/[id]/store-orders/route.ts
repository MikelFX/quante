// GET /api/projects/[id]/store-orders
// Returns Supabase store_orders for this project (Comgate, Zásilkovna, bank transfer).
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
    .select('id, order_number, customer_email, customer_name, customer_phone, total_cents, currency, status, payment_status, payment_method, shipping_method, zasilkovna_branch_id, zasilkovna_branch_country, tracking_code, tracking_url, invoice_number, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)

  const QUANTE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'

  const orders = (rows ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    customerEmail: o.customer_email ?? '—',
    customerName: o.customer_name ?? '—',
    customerPhone: o.customer_phone ?? null,
    amount: o.total_cents / 100,
    currency: (o.currency as string).toUpperCase(),
    status: o.status as string,
    paymentStatus: o.payment_status as string,
    paymentMethod: o.payment_method as string,
    shippingMethod: o.shipping_method as string | null,
    zasilkovnaBranchId: o.zasilkovna_branch_id as string | null,
    zasilkovnaBranchCountry: o.zasilkovna_branch_country as string | null,
    trackingCode: o.tracking_code as string | null,
    trackingUrl: o.tracking_url as string | null,
    invoiceUrl: o.invoice_number ? `${QUANTE_URL}/invoice/${o.id}` : null,
    createdAt: o.created_at,
  }))

  const revenue = orders.filter((o) => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.amount, 0)

  return NextResponse.json({ orders, revenue })
}
