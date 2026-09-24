// /api/payments/paypal/notify
// PayPal's return_url (GET) — the buyer lands here after approving the payment; we
// capture the order and send them on to the store's own success / cart page. POST is
// kept for a client-side capture call ({ orderID }).
//
// Security: the request is never trusted — see lib/payments/paypal-capture.ts. A forged
// request cannot mark anything paid without a real completed PayPal capture of the
// right amount. Redirect targets come only from the signed `ret` / `back` params that
// lib/payments/paypal.ts attached to the return_url at payment creation (HMAC with the
// merchant's PayPal client secret over our order id), so this is no open redirect —
// and the buyer never lands on a Quante page (white-label).

import { NextResponse } from 'next/server'
import { getProjectPaymentCreds } from '@/lib/payments/project-providers'
import { captureAndMarkPaid, findPayPalOrder } from '@/lib/payments/paypal-capture'
import { verifyPayPalReturn } from '@/lib/payments/paypal'

export async function POST(request: Request) {
  let body: { orderID?: string; token?: string } = {}
  try { body = await request.json() } catch { /* PayPal may send form-encoded */ }

  const orderId = body.orderID ?? body.token
  if (!orderId) return NextResponse.json({ error: 'Missing order ID' }, { status: 400 })

  try {
    const result = await captureAndMarkPaid(orderId)
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.pending ? { pending: true } : {}) }, { status: result.status ?? 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[paypal/notify] capture failed:', err)
    return NextResponse.json({ error: 'Capture failed' }, { status: 500 })
  }
}

// Neutral, unbranded fallback when there's no verified store URL to go back to.
function plainPage(message: string, status: number): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${message}</p></body>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function withParam(target: string, key: string, value: string): string {
  const u = new URL(target)
  u.searchParams.set(key, value)
  return u.toString()
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// PayPal redirects the buyer here: ?ret=…&back=…&sig=…&token=<PayPal order id>&PayerID=…
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return plainPage('Missing payment reference.', 400)

  const order = await findPayPalOrder(token).catch(() => null)
  if (!order) return plainPage('Unknown payment.', 404)

  // Resolve where to send the buyer — only URLs we signed for THIS order.
  const ret = url.searchParams.get('ret') ?? ''
  const back = url.searchParams.get('back') ?? ''
  const sig = url.searchParams.get('sig') ?? ''
  let verified = false
  if (ret && back && sig && isHttpUrl(ret) && isHttpUrl(back)) {
    const creds = await getProjectPaymentCreds(order.project_id).catch(() => null)
    verified = !!creds?.paypalClientSecret && verifyPayPalReturn(creds.paypalClientSecret, order.id, ret, back, sig)
  }

  let outcome: 'paid' | 'pending' | 'failed'
  try {
    const result = await captureAndMarkPaid(token)
    outcome = result.ok ? 'paid' : result.pending ? 'pending' : 'failed'
  } catch (err) {
    console.error('[paypal/notify GET] capture failed:', err)
    outcome = 'failed'
  }

  if (!verified) {
    // Payment state is recorded either way; there's just nowhere safe to redirect.
    return plainPage(
      outcome === 'failed'
        ? 'The payment could not be completed. Please return to the store and try again.'
        : 'Thank you — your payment has been received. You can close this window.',
      outcome === 'failed' ? 409 : 200,
    )
  }

  // Paid, or captured-but-pending (PayPal is reviewing; the reconcile cron marks it paid
  // once the money arrives) → the store's success page. Failed → back to the cart.
  if (outcome === 'failed') return NextResponse.redirect(withParam(back, 'payment', 'failed'), 303)
  return NextResponse.redirect(outcome === 'pending' ? withParam(ret, 'payment', 'pending') : ret, 303)
}
