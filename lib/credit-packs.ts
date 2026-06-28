export interface CreditPack {
  id: string
  credits: number
  label: string
  description: string
  priceCents: number
  priceDisplay: string
  perCreditDisplay: string
  popular?: boolean
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: '20',
    credits: 20,
    label: '20 credits',
    description: '2 full store generations',
    priceCents: 999,
    priceDisplay: '$9.99',
    perCreditDisplay: '$0.50 / credit',
  },
  {
    id: '45',
    credits: 45,
    label: '45 credits',
    description: '4 generations or 45 iterations',
    priceCents: 2499,
    priceDisplay: '$24.99',
    perCreditDisplay: '$0.56 / credit',
    popular: true,
  },
  {
    id: '100',
    credits: 100,
    label: '100 credits',
    description: 'Best value — 10 full generations',
    priceCents: 6999,
    priceDisplay: '$69.99',
    perCreditDisplay: '$0.70 / credit',
  },
]
