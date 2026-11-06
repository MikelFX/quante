'use client'

// Admin → Qbox services (/api/admin/qbox/services): what agents sell, their sales and reports, and
// one click to block a service (it leaves the directory and the gateway stops calling it). Unblock
// puts it back as paused; the seller switches it live again.

import { useEffect, useState } from 'react'

const mono = 'var(--q-mono)'

interface Service {
  slug: string; name: string; sellerId: string; priceUsd: string; status: string; wallet: string; network: string
  blockedReason: string | null; listedAt: string; upstream: string
  stats: { paidCalls: number; failedCalls: number; earnedUsd: string; buyers: number }
  reports: Array<{ reason: string; reporter: string | null; at: string }>
}
interface Data {
  setUp: boolean; services: Service[]
  stats: { servicesLive: number; sellers: number; buyers: number; paidCalls: number; volumeUsd: string } | null
}

const small: React.CSSProperties = { fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)' }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)' }
const btn: React.CSSProperties = { background: 'none', color: 'var(--q-fg3)', border: '1px solid rgb(var(--q-ink-rgb) / .12)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }

export function QboxServicesAdmin() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let off = false
    fetch('/api/admin/qbox/services', { cache: 'no-store' })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (off) return
        if (!res.ok || !body) setError(body?.error ?? `Could not load (${res.status}).`)
        else setData(body as Data)
      })
      .catch(() => { if (!off) setError('Could not load.') })
    return () => { off = true }
  }, [tick])

  async function act(slug: string, action: 'block' | 'unblock') {
    let reason: string | null = null
    if (action === 'block') {
      reason = window.prompt('Block this service? It leaves the directory and stops answering. Reason (shown to the seller):', '')
      if (reason === null) return
    }
    setBusy(slug); setError(null)
    const res = await fetch('/api/admin/qbox/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, action, reason }) })
    const body = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setError(body?.error ?? 'Could not save.'); return }
    setTick((t) => t + 1)
  }

  return (
    <div>
      <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--q-fg)' }}>Services agents sell</h2>
      {!data && !error && <p style={small}>Loading…</p>}
      {data && !data.setUp && <p style={{ fontSize: 13, color: 'var(--q-warn-text)' }}>Not set up: run <code>supabase/migration-qbox-services.sql</code>.</p>}
      {data?.stats && (
        <p style={{ ...small, margin: '0 0 8px' }}>
          {data.stats.servicesLive} live · {data.stats.sellers} sellers · {data.stats.buyers} buyers · {data.stats.paidCalls} paid calls · ${data.stats.volumeUsd} paid to sellers
        </p>
      )}
      {data?.setUp && (
        <div style={{ borderRadius: 10, border: '1px solid rgb(var(--q-ink-rgb) / .07)', overflow: 'hidden' }}>
          {data.services.length === 0 && <p style={{ ...row, ...small, margin: 0 }}>No services yet.</p>}
          {data.services.map((s) => (
            <div key={s.slug} style={row}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={{ margin: 0, fontSize: 13, color: s.status === 'live' ? 'var(--q-fg)' : 'var(--q-fg3)' }}>
                  {s.name} <span style={small}>/{s.slug} · ${s.priceUsd} · {s.status}</span>
                  {s.reports.length > 0 && <span style={{ ...small, color: 'var(--q-warn-text)' }}> · {s.reports.length} report{s.reports.length === 1 ? '' : 's'}</span>}
                </p>
                <p style={{ ...small, margin: '2px 0 0' }}>
                  {s.sellerId} · {s.stats.paidCalls} paid calls · ${s.stats.earnedUsd} · {s.stats.buyers} buyers · → {s.upstream}
                </p>
                {s.blockedReason && <p style={{ ...small, margin: '2px 0 0', color: 'var(--q-danger-text)' }}>Blocked: {s.blockedReason}</p>}
                {s.reports.slice(0, 3).map((r, i) => (
                  <p key={i} style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--q-fg2)' }}>“{r.reason}”{r.reporter ? ` — ${r.reporter}` : ''}</p>
                ))}
              </div>
              {s.status === 'blocked'
                ? <button type="button" style={btn} disabled={!!busy} onClick={() => void act(s.slug, 'unblock')}>Unblock</button>
                : s.status !== 'removed' && <button type="button" style={btn} disabled={!!busy} onClick={() => void act(s.slug, 'block')}>Block</button>}
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--q-danger-text)', marginTop: 10 }}>{error}</p>}
    </div>
  )
}
