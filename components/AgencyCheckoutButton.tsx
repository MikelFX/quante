'use client'

import { useState } from 'react'

export function AgencyCheckoutButton({ label = 'Start Agency →', style: extraStyle }: { label?: string; style?: React.CSSProperties }) {
  const [loading, setLoading] = useState(false)

  async function handleCheckout() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/agency-checkout', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else alert(data.error ?? 'Something went wrong.')
    } catch {
      alert('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      style={{
        fontSize: 14, fontWeight: 700, textDecoration: 'none',
        color: '#070709', background: '#3ecf8e',
        padding: '0.75rem 2rem', borderRadius: 8,
        border: 'none', cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.7 : 1,
        transition: 'opacity 0.15s, transform 0.15s',
        display: 'inline-block',
        ...extraStyle,
      }}
    >
      {loading ? 'Redirecting…' : label}
    </button>
  )
}
