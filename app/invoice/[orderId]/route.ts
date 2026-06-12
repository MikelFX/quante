// Returns a print-ready invoice as HTML. Merchant opens this URL and Ctrl+P.
// Auth-gated: only the project owner can view their own invoices.

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateInvoiceHtml } from '@/lib/invoice-generator'
import type { ShopManifest } from '@/types/manifest'

interface Context {
  params: Promise<{ orderId: string }>
}

export async function GET(_req: Request, { params }: Context) {
  const { orderId } = await params
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*, projects(user_id)')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((order.projects as { user_id: string } | null)?.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', order.project_id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest?.merchant) {
    return NextResponse.json({ error: 'Merchant data not configured' }, { status: 422 })
  }

  // Assign invoice number on first view (idempotent)
  let invoiceNumber = order.invoice_number as string | null
  if (!invoiceNumber) {
    const { count } = await supabaseAdmin
      .from('store_orders')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', order.project_id)
      .not('invoice_number', 'is', null)
    const year = new Date().getFullYear()
    invoiceNumber = `${year}-F${String((count ?? 0) + 1).padStart(4, '0')}`
    await supabaseAdmin.from('store_orders').update({ invoice_number: invoiceNumber }).eq('id', orderId)
  }

  const issuedAt = new Date(order.created_at as string)
  const dueAt = new Date(issuedAt)
  dueAt.setDate(dueAt.getDate() + 14)

  const html = generateInvoiceHtml({
    invoiceNumber,
    orderNumber: order.order_number as string,
    issuedAt,
    dueAt,
    merchant: manifest.merchant,
    customer: {
      name: (order.customer_name as string) ?? 'Zákazník',
      email: (order.customer_email as string) ?? '',
      address: (order.shipping_address as { ulice: string; mesto: string; psc: string }) ?? undefined,
    },
    items: (order.items as Array<{ name: string; quantity: number; price: number }>).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.price,
      vatRate: 21,
    })),
    currency: (order.currency as string).toUpperCase(),
  })

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
