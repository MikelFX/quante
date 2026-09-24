// GET /api/payments/paypal/reconcile — cron.
// Settles hosted-store PayPal orders still 'pending': a capture that was PENDING (eCheck,
// risk review) and has since completed, or a buyer who approved the payment but never
// made it back to the return URL. Each order goes through the same verified,
// idempotent capture path as the buyer's return (lib/payments/paypal-capture.ts).
//
// Auth: CRON_SECRET bearer (fails closed — lib/cron-auth.ts).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { reconcilePayPalOrder } from '@/lib/payments/paypal-capture'

export const maxDuration = 60

// Orders younger than this are still in the buyer's hands; older than the window,
// PayPal has long expired an unapproved order and an eCheck has settled or failed.
const MIN_AGE_MS = 15 * 60 * 1000
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const BATCH = 40

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = Date.now()
  const { data, error } = await supabaseAdmin
    .from('store_orders')
    .select('payment_ref')
    .eq('payment_method', 'paypal')
    .eq('payment_status', 'pending')
    .not('payment_ref', 'is', null)
    .lt('created_at', new Date(now - MIN_AGE_MS).toISOString())
    .gt('created_at', new Date(now - MAX_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('[paypal/reconcile] query failed:', error.message)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const counts: Record<string, number> = { paid: 0, pending: 0, cancelled: 0, skipped: 0, error: 0 }
  for (const row of (data ?? []) as Array<{ payment_ref: string }>) {
    try {
      counts[await reconcilePayPalOrder(row.payment_ref)]++
    } catch (err) {
      counts.error++
      console.error(`[paypal/reconcile] ${row.payment_ref} failed:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, checked: (data ?? []).length, ...counts })
}
