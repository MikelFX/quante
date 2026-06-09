// Called by deployed stores' admin panel — returns earnings records for this project.
// Authenticated by QUANTE_API_KEY (per-project secret injected at deploy time).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') ?? ''
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('project_id')
    .eq('quante_api_key', apiKey)
    .maybeSingle()

  if (!secret) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const { data: earnings } = await supabaseAdmin
    .from('store_earnings')
    .select('id, stripe_session_id, gross_amount_cents, net_amount_cents, currency, customer_email, customer_name, created_at')
    .eq('project_id', secret.project_id)
    .order('created_at', { ascending: false })
    .limit(200)

  const orders = (earnings ?? []).map((e) => ({
    id: e.stripe_session_id,
    customerEmail: e.customer_email ?? '—',
    customerName: e.customer_name ?? '—',
    amount: e.gross_amount_cents / 100,
    netAmount: e.net_amount_cents / 100,
    currency: e.currency.toUpperCase(),
    createdAt: e.created_at,
  }))

  const revenue = orders.reduce((sum, o) => sum + o.amount, 0)
  return NextResponse.json({ orders, revenue })
}
