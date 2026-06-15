import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, PaymentStatusResult } from './types'

const PAYPAL_LIVE_BASE = 'https://api-m.paypal.com'
const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'

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
    const token = await this.getAccessToken()
    const amountDecimal = (p.amount / 100).toFixed(2)
    const currency = p.currency.toUpperCase()

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
              return_url: p.returnUrl,
              cancel_url: p.cancelUrl,
              user_action: 'PAY_NOW',
              brand_name: 'Quante Store',
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

  async captureOrder(transactionId: string): Promise<void> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.base}/v2/checkout/orders/${transactionId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`PayPal capture failed: ${res.status}`)
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
