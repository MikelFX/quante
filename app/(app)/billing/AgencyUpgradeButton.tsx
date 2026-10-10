'use client'

import { useState } from 'react'

// Starts the Agency subscription checkout (POST /api/stripe/agency-checkout). It lives here in the
// app because the website (another host, no sign-in) can only link to Billing — see lib/domains.ts.
export function AgencyUpgradeButton({ stripeReady }: { stripeReady: boolean }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  async function start() {
    if (!stripeReady || loading) return
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/stripe/agency-checkout', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (data.url) {
        window.location.assign(data.url)
        return
      }
      setMsg(data.error ?? 'Could not open the payment. Please try again.')
    } catch {
      setMsg('Could not open the payment. Please try again.')
    }
    setLoading(false)
  }

  if (!stripeReady) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={start}
        disabled={loading}
        style={{
          fontSize: 12, fontWeight: 600,
          color: 'var(--q-acc-ink)', background: 'var(--q-acc)',
          border: 0, padding: '7px 14px', borderRadius: 999, minHeight: 32,
          cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {loading ? 'Opening payment…' : 'Upgrade to Agency'}
      </button>
      <span aria-live="polite" style={{ fontSize: 12, color: 'var(--q-danger-text)' }}>{msg}</span>
    </div>
  )
}
