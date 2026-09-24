import { createHmac, timingSafeEqual } from 'crypto'
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, PaymentStatusResult } from './types'

const PAYPAL_LIVE_BASE = 'https://api-m.paypal.com'
const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'

// PayPal takes no decimals for these currencies; our amounts are always sent (and
// checked in the notify handler) as 2-decimal values, so they are refused outright.
// (Checkout only allows two-decimal currencies anyway — app/api/store/_lib/pricing.ts.)
const PAYPAL_ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD'])

// ─── Return-URL routing ──────────────────────────────────────────────────────
// Nothing captures a PayPal order unless our server is called after the buyer
// approves it, so PayPal's return_url is our notify endpoint (GET captures), not the
// store's success page. The store URLs to send the buyer on to ride along as query
// params, HMAC-signed with the merchant's own PayPal client secret over our order id —
// the notify handler only redirects to URLs it signed itself (no open redirect).

function returnSignature(secret: string, orderId: string, ret: string, back: string): string {
  return createHmac('sha256', secret).update(`quante-paypal-return\n${orderId}\n${ret}\n${back}`).digest('hex')
}

export function verifyPayPalReturn(secret: string, orderId: string, ret: string, back: string, sig: string): boolean {
  const expected = Buffer.from(returnSignature(secret, orderId, ret, back), 'hex')
  let got: Buffer
  try { got = Buffer.from(sig, 'hex') } catch { return false }
  return got.length === expected.length && timingSafeEqual(got, expected)
}

interface PayPalConfig {
  clientId: string
  clientSecret: string
  testMode?: boolean
}

export class PayPalProvider implements PaymentProvider {
  private base: string

  constructor(private cfg: PayPalConfig) {
    this.base = cfg.testMode ? PAYPAL_SANDBOX_BASE : PAYPAL_LIVE_BASE
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`)
    const data = await res.json()
    return data.access_token as string
  }

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    const currency = p.currency.toUpperCase()
    if (PAYPAL_ZERO_DECIMAL.has(currency)) throw new Error(`PayPal: zero-decimal currency ${currency} is not supported`)
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new Error('PayPal: invalid amount')
    const amountDecimal = (p.amount / 100).toFixed(2)

    // Buyer returns to our notify endpoint (which captures), then on to the store.
    const returnUrl = new URL(p.notifyUrl)
    returnUrl.searchParams.set('ret', p.returnUrl)
    returnUrl.searchParams.set('back', p.cancelUrl)
    returnUrl.searchParams.set('sig', returnSignature(this.cfg.clientSecret, p.orderId, p.returnUrl, p.cancelUrl))

    // White-label: the store's own name, or nothing (PayPal then shows the merchant's
    // PayPal business name) — never a Quante brand.
    const brandName = p.brandName?.trim().slice(0, 127)

    const token = await this.getAccessToken()

    const res = await fetch(`${this.base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'PayPal-Request-Id': `quante-${p.orderId}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: p.orderId,
          description: p.label.slice(0, 127),
          amount: { currency_code: currency, value: amountDecimal },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: returnUrl.toString(),
              cancel_url: p.cancelUrl,
              user_action: 'PAY_NOW',
              ...(brandName ? { brand_name: brandName } : {}),
            },
          },
        },
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`PayPal create order failed: ${(err as { message?: string }).message ?? res.status}`)
    }

    const order = await res.json()
    const approveLink = (order.links as Array<{ rel: string; href: string }>).find(l => l.rel === 'payer-action')
    if (!approveLink) throw new Error('PayPal: no payer-action link in response')

    return { transactionId: order.id as string, redirectUrl: approveLink.href }
  }

  async getStatus(transactionId: string): Promise<PaymentStatusResult> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.base}/v2/checkout/orders/${transactionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`PayPal get order failed: ${res.status}`)
    const order = await res.json()

    let status: PaymentStatusResult['status'] = 'pending'
    const ps = order.status as string
    if (ps === 'COMPLETED') status = 'paid'
    else if (ps === 'VOIDED' || ps === 'CANCELLED') status = 'cancelled'

    return { transactionId, status }
  }

  // Raw PayPal order status (CREATED / APPROVED / PAYER_ACTION_REQUIRED / COMPLETED /
  // VOIDED …), or null when PayPal no longer knows the order (expired, never approved).
  async getOrderState(transactionId: string): Promise<string | null> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.base}/v2/checkout/orders/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`PayPal get order failed: ${res.status}`)
    const order = await res.json()
    return typeof order.status === 'string' ? order.status : null
  }

  // Captures an approved order and returns the authoritative result so the
  // caller can verify status + amount before marking anything as paid.
  // `status` is the ORDER status; `captureStatus` the status of the capture itself — an
  // order can be COMPLETED while its capture is still PENDING (eCheck, risk review), in
  // which case no money has arrived yet.
  async captureOrder(transactionId: string): Promise<{ status: string; captureStatus: string | null; amountValue: number | null; currency: string | null; referenceId: string | null }> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.base}/v2/checkout/orders/${transactionId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-JSON error body */ }

    // ORDER_ALREADY_CAPTURED → fetch the order to get its real state (idempotent retry)
    if (!res.ok) {
      const issue = (data as { details?: Array<{ issue?: string }> }).details?.[0]?.issue
      if (issue !== 'ORDER_ALREADY_CAPTURED') throw new Error(`PayPal capture failed: ${res.status}`)
      const orderRes = await fetch(`${this.base}/v2/checkout/orders/${transactionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!orderRes.ok) throw new Error(`PayPal get order failed: ${orderRes.status}`)
      data = await orderRes.json()
    }

    const unit = (data.purchase_units as Array<{
      reference_id?: string
      amount?: { value?: string; currency_code?: string }
      payments?: { captures?: Array<{ status?: string; amount?: { value?: string; currency_code?: string } }> }
    }> | undefined)?.[0]
    const firstCapture = unit?.payments?.captures?.[0]
    // Only the capture's own amount counts as paid — never the order's requested amount.
    const captureAmount = firstCapture?.amount

    return {
      status: (data.status as string) ?? 'UNKNOWN',
      captureStatus: firstCapture?.status ?? null,
      amountValue: captureAmount?.value ? parseFloat(captureAmount.value) : null,
      currency: captureAmount?.currency_code ?? null,
      referenceId: unit?.reference_id ?? null,
    }
  }
}

export function createPayPalProvider(overrides?: Partial<PayPalConfig>): PayPalProvider | null {
  const clientId = overrides?.clientId ?? process.env.PAYPAL_CLIENT_ID
  const clientSecret = overrides?.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return new PayPalProvider({
    clientId,
    clientSecret,
    testMode: overrides?.testMode ?? process.env.PAYPAL_TEST_MODE === 'true',
  })
}
