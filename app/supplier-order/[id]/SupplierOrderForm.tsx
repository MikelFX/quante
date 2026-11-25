'use client'

// The supplier's form on /supplier-order/<id> (CLAUDE.md §13r): tracking number, or why it can't ship.

import { useState } from 'react'

const input: React.CSSProperties = {
  width: '100%', fontSize: 15, padding: '11px 12px', borderRadius: 9, border: '1px solid rgb(var(--q-ink-rgb) / .15)',
  background: 'rgb(var(--q-ink-rgb) / .03)', color: 'var(--q-fg)', boxSizing: 'border-box',
}
const button = (primary: boolean): React.CSSProperties => ({
  minHeight: 44, padding: '0 18px', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : '1px solid rgb(var(--q-ink-rgb) / .15)',
  background: primary ? 'var(--q-acc)' : 'none', color: primary ? 'var(--q-acc-ink)' : 'var(--q-fg2)',
})

export function SupplierOrderForm({ id, token }: { id: string; token: string }) {
  const [mode, setMode] = useState<'ship' | 'cannot'>('ship')
  const [code, setCode] = useState('')
  const [carrier, setCarrier] = useState('')
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const body = mode === 'ship' ? { t: token, trackingCode: code, carrier, trackingUrl: url } : { t: token, action: 'cannot', reason }
    const res = await fetch(`/api/supplier-orders/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'Nepodařilo se uložit.'); return }
    setDone(mode === 'ship' ? 'Uloženo. Zákazník dostane odkaz na sledování zásilky.' : 'Uloženo. Obchodník dostal zprávu.')
  }

  if (done) return <p style={{ color: 'var(--q-ok-text)', fontSize: 15 }}>{done}</p>

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {mode === 'ship' ? (
        <>
          <label style={{ fontSize: 13 }}>Číslo zásilky
            <input style={input} value={code} onChange={(e) => setCode(e.target.value)} required minLength={4} maxLength={80} autoComplete="off" />
          </label>
          <label style={{ fontSize: 13 }}>Dopravce (nepovinné)
            <input style={input} value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={60} placeholder="PPL, Zásilkovna, DPD…" />
          </label>
          <label style={{ fontSize: 13 }}>Odkaz na sledování (nepovinné)
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" inputMode="url" />
          </label>
        </>
      ) : (
        <label style={{ fontSize: 13 }}>Proč zboží nemůžete odeslat?
          <textarea style={{ ...input, minHeight: 90 }} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} />
        </label>
      )}
      {error && <p style={{ color: 'var(--q-danger-text)', margin: 0, fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="submit" style={button(true)} disabled={busy}>{busy ? 'Ukládám…' : mode === 'ship' ? 'Odesláno' : 'Odeslat zprávu'}</button>
        <button type="button" style={button(false)} onClick={() => { setMode(mode === 'ship' ? 'cannot' : 'ship'); setError(null) }}>
          {mode === 'ship' ? 'Nemůžeme odeslat' : 'Zpět, zadat číslo zásilky'}
        </button>
      </div>
    </form>
  )
}
