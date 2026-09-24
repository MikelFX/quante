// Pure transition rules for the "shipped" move of a store order (no DB, no mail), shared
// by the Studio carrier routes through ./ship-guard.ts and importable by tests and by any
// other ship path (e.g. the fulfillment-tracking cron). See ./ship-guard.ts for why.

import { safeHttpUrl } from '@/lib/html'

// Payment methods whose orders may ship before they are paid (cash on delivery / bank
// transfer — the merchant confirms the money).
const OFFLINE_METHODS = new Set(['dobirka', 'prevod'])

export interface ShippableOrder {
  status: string
  payment_status: string | null
  payment_method: string | null
}

/** null when the order may move to shipped, otherwise the reason it may not. */
export function shipRefusal(order: ShippableOrder): string | null {
  const offline = OFFLINE_METHODS.has(order.payment_method ?? '')
  const confirmed = order.payment_status === 'paid'
  if (order.status === 'paid' && (offline || confirmed)) return null
  if (order.status === 'pending' && offline) return null
  if (order.status === 'shipped') return 'Order already shipped'
  if (order.status === 'paid' || order.status === 'pending') {
    return 'The payment for this order has not been confirmed by the payment provider'
  }
  return `Order cannot be shipped from status ${order.status}`
}

/** https-only tracking link, or undefined. */
export function safeTrackingUrl(u: unknown): string | undefined {
  const url = safeHttpUrl(u)
  return url && url.startsWith('https://') ? url : undefined
}
