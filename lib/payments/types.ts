export type PaymentMethodType = 'stripe' | 'comgate' | 'gopay' | 'paypal' | 'dobirka' | 'prevod'

export interface CreatePaymentParams {
  orderId: string
  amount: number      // in smallest currency unit (haléře for CZK)
  currency: string    // e.g. 'CZK'
  label: string       // short product description
  customerEmail: string
  customerName?: string
  returnUrl: string   // on success
  cancelUrl: string
  notifyUrl: string   // webhook URL
  testMode?: boolean
  brandName?: string  // store's own brand shown on the gateway page (white-label) — omitted when unset
}

export interface CreatePaymentResult {
  transactionId: string
  redirectUrl: string
}

export interface PaymentStatusResult {
  transactionId: string
  // 'partially_refunded': some money went back but the order is still (partly) paid —
  // never treated as a full refund.
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'partially_refunded' | 'expired'
  paidAmount?: number   // smallest currency unit, as reported by the gateway
  currency?: string     // as reported by the gateway
  paidAt?: string
  refId?: string        // our order reference as the gateway recorded it (Comgate refId / GoPay order_number)
  test?: boolean        // gateway reports a sandbox/test transaction
  merchantRef?: string  // gateway account the payment belongs to (Comgate merchant / GoPay goid)
}

export interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>
  getStatus(transactionId: string): Promise<PaymentStatusResult>
}
