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
}

export interface CreatePaymentResult {
  transactionId: string
  redirectUrl: string
}

export interface PaymentStatusResult {
  transactionId: string
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired'
  paidAmount?: number
  paidAt?: string
}

export interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>
  getStatus(transactionId: string): Promise<PaymentStatusResult>
}
