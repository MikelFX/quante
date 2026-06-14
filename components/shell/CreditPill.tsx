'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export function CreditPill({ compact = false }: { compact?: boolean }) {
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => setBalance(d.balance ?? 0))
      .catch(() => setBalance(0))
  }, [])

  return (
    <Link href="/billing" style={{ textDecoration: 'none' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: compact ? '3px 8px' : '5px 10px',
        borderRadius: 6,
        background: 'rgba(111,120,230,.08)',
        border: '1px solid rgba(111,120,230,.18)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(111,120,230,.13)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(111,120,230,.3)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(111,120,230,.08)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(111,120,230,.18)'
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#6f78e6',
          boxShadow: '0 0 6px rgba(111,120,230,.65)',
          flexShrink: 0,
          animation: 'dot-pulse 2.4s ease-in-out infinite',
        }} />
        <span style={{
          fontFamily: 'var(--font-geist-mono)',
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          color: balance === null ? '#8a8a93' : '#a8afff',
          letterSpacing: '-.01em',
          minWidth: 20,
        }}>
          {balance === null ? '…' : balance}
        </span>
      </div>
    </Link>
  )
}
