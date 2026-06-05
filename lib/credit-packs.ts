export interface CreditPack {
  id: string
  credits: number
  label: string
  description: string
  priceEurCents: number
  priceDisplay: string
  perCreditDisplay: string
  popular?: boolean
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: '100',
    credits: 100,
    label: '100 credits',
    description: '10 full store generations',
    priceEurCents: 999,
    priceDisplay: '€9.99',
    perCreditDisplay: '€0.10 / credit',
  },
  {
    id: '300',
    credits: 300,
    label: '300 credits',
    description: '30 generations or 300 iterations',
    priceEurCents: 2499,
    priceDisplay: '€24.99',
    perCreditDisplay: '€0.083 / credit',
    popular: true,
  },
  {
    id: '1000',
    credits: 1000,
    label: '1,000 credits',
    description: 'Best value — 100 full generations',
    priceEurCents: 6999,
    priceDisplay: '€69.99',
    perCreditDisplay: '€0.07 / credit',
  },
]
