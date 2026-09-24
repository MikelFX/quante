// Called by deployed stores' admin panel — returns all orders for this project.
// Authenticated by QUANTE_API_KEY (per-project secret injected at deploy time),
// verified by hash + constant-time compare (see ../_lib/store-auth.ts).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { signedInvoiceUrlOrNull } from '@/lib/invoice-generator'
import { authenticateStoreKey } from '../_lib/store-auth'

export async function GET(request: Request) {
  // Rate-limit by IP: max 60 requests per minute
  const ip = getClientIp(request)
  const rl = rateLimit(`store-orders:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    })
  }

  const secret = await authenticateStoreKey(request)
  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const { data: rows } = await supabaseAdmin
    .from('store_orders')
    .select('id, order_number, customer_email, customer_name, total_cents, currency, status, payment_status, payment_method, invoice_number, created_at')
    .eq('project_id', secret.project_id)
    .order('created_at', { ascending: false })
    .limit(200)

  const orders = (rows ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    customerEmail: o.customer_email ?? '—',
    customerName: o.customer_name ?? '—',
    amount: o.total_cents / 100,
    currency: (o.currency as string).toUpperCase(),
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    // Signed link: the store admin isn't signed into Quante (see app/invoice/[orderId]).
    invoiceUrl: o.invoice_number ? signedInvoiceUrlOrNull(o.id as string) : null,
    createdAt: o.created_at,
  }))

  const revenue = orders.filter((o) => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.amount, 0)
  return NextResponse.json({ orders, revenue })
}
