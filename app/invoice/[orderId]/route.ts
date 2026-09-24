// Returns a print-ready invoice as HTML. Merchant opens this URL and Ctrl+P.
//
// Access: the project owner (Clerk session), OR anyone holding the HMAC link token
// `?t=` minted by signedInvoiceUrl() (lib/invoice-generator.ts) — that's how the
// customer's "view invoice" email link and the store admin panel open it. (The old
// check used Supabase Auth, which this app never signs into, so it always 401'd.)
//
// SECURITY: the HTML contains shopper-supplied fields and is served on the Quante
// origin — generateInvoiceHtml escapes everything, and the CSP below forbids scripts
// outright as a second layer.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateInvoiceHtml, verifyInvoiceAccessToken } from '@/lib/invoice-generator'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { isUuid } from '@/lib/auth/project'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

interface Context {
  params: Promise<{ orderId: string }>
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}

export async function GET(req: Request, { params }: Context) {
  const { orderId } = await params
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rl = rateLimit(`invoice:${getClientIp(req)}`, 60, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const token = new URL(req.url).searchParams.get('t')
  const tokenOk = verifyInvoiceAccessToken(orderId, token)

  let userId: string | null = null
  if (!tokenOk) {
    try {
      userId = (await auth()).userId
    } catch {
      userId = null
    }
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: order } = await supabaseAdmin
    .from('store_orders')
    .select('*, projects(user_id)')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Without a valid token, only the owner of the order's project may view it.
  // 404 (not 403) so order ids of other tenants can't be probed.
  if (!tokenOk && (order.projects as { user_id: string } | null)?.user_id !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ctx = await loadStoreEmailContext(order.project_id as string)
  if (!ctx?.merchant) {
    return NextResponse.json({ error: 'Merchant data not configured' }, { status: 422 })
  }

  const invoiceNumber = await ensureInvoiceNumber(orderId, order.project_id as string, order.invoice_number as string | null)
  if (!invoiceNumber) return NextResponse.json({ error: 'Could not assign invoice number' }, { status: 500 })

  const issuedAt = new Date(order.created_at as string)
  const dueAt = new Date(issuedAt)
  dueAt.setDate(dueAt.getDate() + 14)

  const html = generateInvoiceHtml({
    invoiceNumber,
    orderNumber: order.order_number as string,
    issuedAt,
    dueAt,
    merchant: ctx.merchant,
    customer: {
      name: (order.customer_name as string) ?? 'Zákazník',
      email: (order.customer_email as string) ?? '',
      address: (order.shipping_address as { ulice: string; mesto: string; psc: string }) ?? undefined,
    },
    items: ((order.items as Array<{ name: string; quantity: number; price: number }>) ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.price,
      vatRate: 21,
    })),
    currency: String(order.currency ?? '').toUpperCase(),
  })

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  })
}

// Assigns the next invoice number exactly once. The write is a compare-and-set
// (`invoice_number IS NULL`), so two concurrent views can't both assign a number; a
// unique-violation (see supabase/migration-security-store-public.sql) means another
// order took that number first, so retry with the next one.
async function ensureInvoiceNumber(orderId: string, projectId: string, existing: string | null): Promise<string | null> {
  if (existing) return existing
  const year = new Date().getFullYear()

  for (let attempt = 0; attempt < 5; attempt++) {
    const { count } = await supabaseAdmin
      .from('store_orders')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('invoice_number', 'is', null)
    const candidate = `${year}-F${String((count ?? 0) + 1 + attempt).padStart(4, '0')}`

    const { error } = await supabaseAdmin
      .from('store_orders')
      .update({ invoice_number: candidate })
      .eq('id', orderId)
      .is('invoice_number', null)

    if (error && (error as { code?: string }).code !== '23505') {
      console.error('[invoice] assign failed:', error.message)
      return null
    }

    const { data: row } = await supabaseAdmin
      .from('store_orders')
      .select('invoice_number')
      .eq('id', orderId)
      .maybeSingle()
    const assigned = (row as { invoice_number?: string | null } | null)?.invoice_number
    if (assigned) return assigned
  }
  return null
}
