import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, PaymentStatusResult } from './types'

const COMGATE_API = 'https://payments.comgate.cz/v1.0'

interface ComgateConfig {
  merchantId: string
  secret: string
  testMode?: boolean
}

export class ComgateProvider implements PaymentProvider {
  constructor(private cfg: ComgateConfig) {}

  async createPayment(p: CreatePaymentParams): Promise<CreatePaymentResult> {
    const body = new URLSearchParams({
      merchant: this.cfg.merchantId,
      secret: this.cfg.secret,
      test: (p.testMode ?? this.cfg.testMode ?? false) ? 'true' : 'false',
      country: 'CZ',
      price: String(p.amount),
      curr: p.currency,
      label: p.label.slice(0, 50),
      refId: p.orderId,
      method: 'ALL',
      email: p.customerEmail,
      prepareOnly: 'true',
      returnUrl: p.returnUrl,
      notifUrl: p.notifyUrl,
    })

    const res = await fetch(`${COMGATE_API}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const text = await res.text()
    const params = new URLSearchParams(text)

    if (params.get('code') !== '0') {
      throw new Error(`Comgate error ${params.get('code')}: ${params.get('message')}`)
    }

    const transId = params.get('transId')!
    const redirect = params.get('redirect')!
    return { transactionId: transId, redirectUrl: redirect }
  }

  async getStatus(transactionId: string): Promise<PaymentStatusResult> {
    const body = new URLSearchParams({
      merchant: this.cfg.merchantId,
      secret: this.cfg.secret,
      transId: transactionId,
    })

    const res = await fetch(`${COMGATE_API}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const text = await res.text()
    const params = new URLSearchParams(text)

    const statusMap: Record<string, PaymentStatusResult['status']> = {
      PAID: 'paid',
      CANCELLED: 'cancelled',
      REFUNDED: 'refunded',
      AUTHORIZED: 'pending',
      PENDING: 'pending',
    }

    return {
      transactionId,
      status: statusMap[params.get('status') ?? ''] ?? 'pending',
      paidAmount: params.get('price') ? Number(params.get('price')) : undefined,
    }
  }
}

export function createComgateProvider(override?: { merchantId?: string; secret?: string }): ComgateProvider | null {
  const merchantId = override?.merchantId ?? process.env.COMGATE_MERCHANT_ID
  const secret = override?.secret ?? process.env.COMGATE_SECRET
  if (!merchantId || !secret) return null
  return new ComgateProvider({
    merchantId,
    secret,
    testMode: process.env.COMGATE_TEST_MODE === 'true',
  })
}
