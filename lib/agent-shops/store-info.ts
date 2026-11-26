// What /api/store/agent returns to a hosted store's agent layer (pure, tested in
// __tests__/agent-shops.test.mjs). Payment ids are the checkout's own (stripe, comgate, gopay,
// paypal, dobirka, prevod) so the store can pass them straight to /api/checkout.

export interface PricingView {
  currency: string
  shippingMethods: Array<{ id: string; label: string; cents: number }>
  freeShippingFromCents: number
  cod: { enabled: boolean; feeCents: number }
  bankTransferEnabled: boolean
  onlineMethods: ReadonlySet<string>
}

const ONLINE_LABEL: Record<string, string> = {
  stripe: 'Card',
  comgate: 'Card or bank button (Comgate)',
  gopay: 'Card or bank button (GoPay)',
  paypal: 'PayPal',
}
const ONLINE_ORDER = ['stripe', 'comgate', 'gopay', 'paypal']

/** Stock caps what we tell the world (exact large numbers are the merchant's business). */
export const PUBLIC_STOCK_CAP = 999

export interface OfferedPayment { id: string; kind: 'online' | 'cash_on_delivery' | 'bank_transfer'; label: string; fee: number }

/**
 * The online methods a store can really take: card through the platform's Stripe is always
 * there, a gateway (Comgate / GoPay / PayPal) only once the merchant saved its own
 * credentials — the checkout answers 503 for one without them (lib/payments/project-providers.ts).
 */
export function usableOnlineMethods(
  offered: ReadonlySet<string>,
  configured: { comgate: boolean; gopay: boolean; paypal: boolean },
): Set<string> {
  const out = new Set<string>()
  for (const id of offered) {
    if (id === 'stripe' || (id in configured && configured[id as keyof typeof configured])) out.add(id)
  }
  return out
}

/**
 * Payment methods a shopper (or an agent) may pick, in checkout order: online first, then bank
 * transfer, then cash on delivery with its fee in major units. Ids are the checkout's own.
 * Shared by /api/store/agent and /api/store/shipping (the store's cart page).
 */
export function offeredPayments(p: Pick<PricingView, 'onlineMethods' | 'bankTransferEnabled' | 'cod'>): OfferedPayment[] {
  const payments: OfferedPayment[] = []
  for (const id of ONLINE_ORDER) if (p.onlineMethods.has(id)) payments.push({ id, kind: 'online', label: ONLINE_LABEL[id], fee: 0 })
  if (p.bankTransferEnabled) payments.push({ id: 'prevod', kind: 'bank_transfer', label: 'Bank transfer', fee: 0 })
  if (p.cod.enabled) payments.push({ id: 'dobirka', kind: 'cash_on_delivery', label: 'Cash on delivery', fee: Math.max(0, p.cod.feeCents) / 100 })
  return payments
}

export function storeAgentInfo(
  p: PricingView,
  inventory: Array<{ product_id: string; variant_id: string | null; stock_qty: number }>,
  live: boolean,
) {
  const payments = offeredPayments(p)

  const stock: Record<string, number> = {}
  for (const r of inventory) {
    const q = Number(r.stock_qty)
    if (!r.product_id || !Number.isFinite(q)) continue
    stock[r.variant_id ? `${r.product_id}::${r.variant_id}` : r.product_id] = Math.max(0, Math.min(PUBLIC_STOCK_CAP, Math.floor(q)))
  }

  return {
    currency: p.currency,
    ordering: live && payments.length > 0,
    shipping: {
      methods: p.shippingMethods.map((m) => ({ id: m.id, label: m.label, price: m.cents / 100 })),
      freeShippingFrom: p.freeShippingFromCents > 0 ? p.freeShippingFromCents / 100 : 0,
    },
    payments,
    stock,
  }
}
