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
    id: '50',
    credits: 50,
    label: '50 credits',
    description: '5 full store generations',
    priceCents: 999,
    priceDisplay: '$9.99',
    perCreditDisplay: '$0.20 / credit',
  },
  {
    id: '100',
    credits: 100,
    label: '100 credits',
    description: '10 generations or 100 iterations',
    priceCents: 2499,
    priceDisplay: '$24.99',
    perCreditDisplay: '$0.25 / credit',
    popular: true,
  },
  {
    id: '200',
    credits: 200,
    label: '200 credits',
    description: '20 full store generations',
    priceCents: 6999,
    priceDisplay: '$69.99',
    perCreditDisplay: '$0.35 / credit',
  },
]
