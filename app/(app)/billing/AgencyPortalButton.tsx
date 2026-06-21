'use client'

import { useState } from 'react'

export function AgencyPortalButton({ stripeReady }: { stripeReady: boolean }) {
  const [loading, setLoading] = useState(false)

  async function handlePortal() {
    if (!stripeReady || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else alert(data.error ?? 'Could not open billing portal.')
    } catch {
      alert('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (!stripeReady) return null

  return (
    <button
      onClick={handlePortal}
      disabled={loading}
      style={{
        fontSize: 12, fontWeight: 600,
        color: '#f4f4f6', background: 'rgba(255,255,255,.07)',
        border: '1px solid rgba(255,255,255,.12)',
        padding: '7px 14px', borderRadius: 7,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
        transition: 'background 0.15s',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {loading ? 'Opening…' : 'Manage subscription'}
    </button>
  )
}
