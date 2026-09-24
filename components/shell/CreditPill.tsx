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
          background: 'rgba(62,207,142,.08)',
          border: '1px solid rgba(62,207,142,.2)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(62,207,142,.13)'
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(62,207,142,.35)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(62,207,142,.08)'
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(62,207,142,.2)'
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#3ecf8e',
            boxShadow: '0 0 6px rgba(62,207,142,.65)',
            flexShrink: 0,
            animation: 'dot-pulse 2.4s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--font-geist-mono)',
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            color: '#3ecf8e',
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
        background: 'rgba(212,255,63,.08)',
        border: '1px solid rgba(212,255,63,.18)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(212,255,63,.13)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(212,255,63,.3)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(212,255,63,.08)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(212,255,63,.18)'
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#D4FF3F',
          boxShadow: '0 0 6px rgba(212,255,63,.65)',
          flexShrink: 0,
          animation: 'dot-pulse 2.4s ease-in-out infinite',
        }} />
        <span style={{
          fontFamily: 'var(--font-geist-mono)',
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          color: data === null ? '#8a8a93' : '#E8FF9E',
          letterSpacing: '-.01em',
          minWidth: 20,
        }}>
          {data === null ? '…' : (data.balance ?? 0)}
        </span>
        {needsVerification && (
          <span style={{
            fontSize: compact ? 10 : 11,
            color: '#e0a04f',
            whiteSpace: 'nowrap',
          }}>
            {compact ? 'verify email' : 'Verify email for free credits'}
          </span>
        )}
      </div>
    </Link>
  )
}
