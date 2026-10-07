'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface BalanceData {
  balance: number | null
  tier?: string
  // Set by /api/credits/balance when the welcome grant is waiting on a verified email.
  verificationRequired?: boolean
}

const VERIFY_HINT = 'Verify your email to receive your free credits'

export function CreditPill({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<BalanceData | null>(null)

  useEffect(() => {
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d: BalanceData) => setData(d))
      .catch(() => setData({ balance: 0 }))
  }, [])

  const isAgency = data?.tier === 'agency'

  if (isAgency) {
    return (
      <Link href="/billing" style={{ textDecoration: 'none' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: compact ? '3px 8px' : '5px 10px',
          borderRadius: 6,
          background: 'rgb(var(--q-ok-rgb) / .08)',
          border: '1px solid rgb(var(--q-ok-rgb) / .2)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'rgb(var(--q-ok-rgb) / .13)'
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgb(var(--q-ok-rgb) / .35)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'rgb(var(--q-ok-rgb) / .08)'
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgb(var(--q-ok-rgb) / .2)'
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--q-ok)',
            boxShadow: '0 0 6px rgb(var(--q-ok-rgb) / .65)',
            flexShrink: 0,
            animation: 'dot-pulse 2.4s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--q-mono)',
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            color: 'var(--q-ok-text)',
            letterSpacing: '.03em',
            textTransform: 'uppercase',
          }}>
            Agency
          </span>
        </div>
      </Link>
    )
  }

  const needsVerification = data?.verificationRequired === true

  return (
    <Link
      href="/billing"
      style={{ textDecoration: 'none' }}
      title={needsVerification ? VERIFY_HINT : undefined}
      aria-label={needsVerification ? `${data?.balance ?? 0} credits. ${VERIFY_HINT}.` : undefined}
    >
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: compact ? '3px 8px' : '5px 10px',
        borderRadius: 6,
        background: 'rgb(var(--q-acc-rgb) / .08)',
        border: '1px solid rgb(var(--q-acc-rgb) / .18)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgb(var(--q-acc-rgb) / .13)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgb(var(--q-acc-rgb) / .3)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgb(var(--q-acc-rgb) / .08)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgb(var(--q-acc-rgb) / .18)'
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--q-acc)',
          boxShadow: '0 0 6px rgb(var(--q-acc-rgb) / .65)',
          flexShrink: 0,
          animation: 'dot-pulse 2.4s ease-in-out infinite',
        }} />
        <span style={{
          fontFamily: 'var(--q-mono)',
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          color: data === null ? 'var(--q-fg3)' : 'var(--q-acc-hi)',
          letterSpacing: '-.01em',
          minWidth: 20,
        }}>
          {data === null ? '…' : (data.balance ?? 0)}
        </span>
        {needsVerification && (
          <span style={{
            fontSize: compact ? 10 : 11,
            color: 'var(--q-warn-text)',
            whiteSpace: 'nowrap',
          }}>
            {compact ? 'verify email' : 'Verify email for free credits'}
          </span>
        )}
      </div>
    </Link>
  )
}
