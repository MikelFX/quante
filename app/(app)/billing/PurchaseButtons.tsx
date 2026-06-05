'use client'

import { useState } from 'react'
import type { CreditPack } from '@/lib/stripe'

interface Props {
  packs: CreditPack[]
  stripeReady: boolean
}

export function PurchaseButtons({ packs, stripeReady }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePurchase(packId: string) {
    if (!stripeReady) return
    setLoading(packId)
    setError(null)

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create checkout session.')
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLoading(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className={`relative rounded-lg border px-4 py-4 flex flex-col gap-2 ${
              pack.popular
                ? 'border-white/20 bg-secondary'
                : 'border-border'
            }`}
          >
            {pack.popular && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-semibold uppercase tracking-wider">
                Popular
              </span>
            )}
            <div>
              <p className="text-lg font-bold font-mono">{pack.credits}</p>
              <p className="text-xs text-muted-foreground">credits</p>
            </div>
            <p className="text-sm text-muted-foreground flex-1">{pack.description}</p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm font-semibold">{pack.priceDisplay}</span>
              <button
                onClick={() => handlePurchase(pack.id)}
                disabled={!stripeReady || loading !== null}
                className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading === pack.id ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Redirecting…
                  </span>
                ) : (
                  'Buy'
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="text-xs text-red-400 px-1">{error}</p>
      )}
    </div>
  )
}
