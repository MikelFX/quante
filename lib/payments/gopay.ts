import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, PaymentStatusResult } from './types'

const GOPAY_API = 'https://gw.sandbox.gopay.com/api'
const GOPAY_LIVE_API = 'https://gate.gopay.cz/api'

interface GopayConfig {
  clientId: string
  clientSecret: string
  goId: string
  testMode?: boolean
}

export class GopayProvider implements PaymentProvider {
  private apiBase: string

  constructor(private cfg: GopayConfig) {
    this.apiBase = cfg.testMode ? GOPAY_API : GOPAY_LIVE_API
  }

  private async getToken(): Promise<string> {
    const credentials = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')
    const res = await fetch(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&scope=payment-all',
    })
    if (!res.ok) throw new Error(`GoPay auth failed: ${res.status}`)
    const data = await res.json()
    return data.access_token as string
  }

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    const token = await this.getToken()

    const body = {
      payer: { contact: { email: p.customerEmail } },
      target: { type: 'ACCOUNT', goid: Number(this.cfg.goId) },
      amount: p.amount,
      currency: p.currency,
      order_number: p.orderId.slice(0, 64),
      order_description: p.label.slice(0, 256),
      callback: {
        return_url: p.returnUrl,
        notification_url: p.notifyUrl,
      },
      lang: 'CS',
    }

    const res = await fetch(`${this.apiBase}/payments/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`GoPay createPayment failed: ${res.status} ${err}`)
    }

    const data = await res.json()
    return {
      transactionId: String(data.id),
      redirectUrl: data.gw_url as string,
    }
  }

  async getStatus(transactionId: string): Promise<PaymentStatusResult> {
    const token = await this.getToken()

    const res = await fetch(`${this.apiBase}/payments/payment/${transactionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`GoPay getStatus failed: ${res.status}`)
    const data = await res.json()

    const statusMap: Record<string, PaymentStatusResult['status']> = {
      PAID: 'paid',
      PAYMENT_METHOD_CHOSEN: 'pending',
      CREATED: 'pending',
      AUTHORIZED: 'pending',
      CANCELED: 'cancelled',
      TIMEOUTED: 'expired',
      REFUNDED: 'refunded',
      PARTIALLY_REFUNDED: 'refunded',
    }

    return {
      transactionId,
      status: statusMap[data.state as string] ?? 'pending',
      paidAmount: data.amount as number | undefined,
      paidAt: data.payment_instrument_details?.bank_transfer?.transaction_date ?? undefined,
    }
  }
}

export function createGopayProvider(): GopayProvider | null {
  const clientId = process.env.GOPAY_CLIENT_ID
  const clientSecret = process.env.GOPAY_CLIENT_SECRET
  const goId = process.env.GOPAY_GO_ID
  if (!clientId || !clientSecret || !goId) return null
  return new GopayProvider({
    clientId,
    clientSecret,
    goId,
    testMode: process.env.GOPAY_TEST_MODE !== 'false',
  })
}
