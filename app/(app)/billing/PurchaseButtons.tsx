'use client'

import { useState } from 'react'
import type { CreditPack } from '@/lib/stripe'
import { getGenerationsCaption, getPerCreditDisplay } from '@/lib/pricing'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {packs.map((pack) => (
          <div
            key={pack.id}
            style={{
              position: 'relative',
              borderRadius: 12,
              border: pack.popular ? '1px solid rgb(var(--q-acc-rgb) / .4)' : '1px solid rgb(var(--q-ink-rgb) / .07)',
              background: pack.popular ? 'rgb(var(--q-acc-rgb) / .06)' : 'var(--q-s1)',
              padding: '16px 18px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            {pack.popular && (
              <span style={{
                position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                padding: '2px 10px', borderRadius: 20,
                background: 'var(--q-acc)', color: 'var(--q-acc-ink)',
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
                whiteSpace: 'nowrap',
              }}>
                Popular
              </span>
            )}

            <div>
              <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--q-mono)', letterSpacing: '-.04em', color: 'var(--q-fg)', margin: '0 0 2px' }}>{pack.credits}</p>
              <p style={{ fontSize: 11, color: 'var(--q-fg3)', margin: 0 }}>credits</p>
            </div>

            <p style={{ fontSize: 12, color: 'var(--q-fg3)', flex: 1, lineHeight: 1.45, margin: 0 }}>{getGenerationsCaption(pack)} · {getPerCreditDisplay(pack)}</p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--q-mono)', color: 'var(--q-fg)' }}>{pack.priceDisplay}</span>
              <button
                onClick={() => handlePurchase(pack.id)}
                disabled={!stripeReady || loading !== null}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7, border: 'none',
                  cursor: !stripeReady || loading !== null ? 'not-allowed' : 'pointer',
                  background: pack.popular ? 'var(--q-acc)' : 'rgb(var(--q-ink-rgb) / .1)',
                  color: pack.popular ? 'var(--q-acc-ink)' : 'var(--q-fg)',
                  opacity: !stripeReady || loading !== null ? 0.5 : 1,
                  transition: 'opacity 0.12s',
                  flexShrink: 0,
                }}
              >
                {loading === pack.id ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg style={{ width: 12, height: 12, animation: 'spin 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity={0.25} />
                      <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" opacity={0.75} />
                    </svg>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </span>
                ) : 'Buy'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--q-danger-text)', margin: 0 }}>{error}</p>}
    </div>
  )
}
