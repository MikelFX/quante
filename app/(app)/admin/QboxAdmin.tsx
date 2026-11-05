'use client'

// Admin → Qbox beta (/api/admin/qbox): who asked for access (qbox_waitlist), one click to
// invite, and the invited members with their keys and usage this month. Pause / resume / remove
// only stop new API calls; nothing here spends credits or starts sandboxes.

import { useEffect, useState } from 'react'

const mono = 'var(--q-mono)'

interface Request { userId: string; email: string | null; useCase: string | null; requestedAt: string; invited: boolean }
interface Member {
  userId: string; email: string | null; invitedAt: string; paused: boolean
  maxConcurrent: number; monthlyMinutes: number; keys: number; lastUsed: string | null
  sandboxesThisMonth: number; running: number; minutesThisMonth: number
}
interface Data { setUp: boolean; requests: Request[]; members: Member[] }

const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  background: primary ? 'var(--q-acc)' : 'none',
  color: primary ? 'var(--q-acc-ink)' : 'var(--q-fg3)',
  border: primary ? 'none' : '1px solid rgb(var(--q-ink-rgb) / .12)',
  borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: primary ? 600 : 500,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
})
const box: React.CSSProperties = { borderRadius: 10, border: '1px solid rgb(var(--q-ink-rgb) / .07)', overflow: 'hidden' }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)' }
const small: React.CSSProperties = { fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)' }
const h2: React.CSSProperties = { fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--q-fg)' }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')

export function QboxAdmin() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [manualId, setManualId] = useState('')

  useEffect(() => {
    let off = false
    fetch('/api/admin/qbox', { cache: 'no-store' })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (off) return
        if (!res.ok || !body) setError(body?.error ?? `Could not load (${res.status}).`)
        else setData(body as Data)
      })
      .catch(() => { if (!off) setError('Could not load.') })
    return () => { off = true }
  }, [tick])

  async function act(userId: string, action: 'invite' | 'pause' | 'resume' | 'remove') {
    if (action === 'remove' && !window.confirm('Remove this account from the beta? Its keys stop working.')) return
    setBusy(userId + action); setError(null)
    const res = await fetch('/api/admin/qbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, action }) })
    const body = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setError(body?.error ?? 'Could not save.'); return }
    if (action === 'invite') setManualId('')
    setTick((t) => t + 1)
  }

  const waiting = data?.requests.filter((r) => !r.invited) ?? []

  return (
    <section style={{ margin: '0 0 2.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em', margin: 0 }}>Qbox beta</h1>
        {data?.setUp && (
          <span style={{ ...small, padding: '3px 8px', borderRadius: 5, background: 'rgb(var(--q-ink-rgb) / .05)' }}>
            {waiting.length} waiting · {data.members.length} invited
          </span>
        )}
      </div>

      {!data && !error && <p style={small}>Loading…</p>}
      {data && !data.setUp && (
        <p style={{ fontSize: 13, color: 'var(--q-warn-text)' }}>Not set up: run <code>supabase/migration-qbox-beta.sql</code> in Supabase first.</p>
      )}

      {data?.setUp && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div>
            <h2 style={h2}>Asked for access</h2>
            <div style={box}>
              {waiting.length === 0 && <p style={{ ...row, ...small, margin: 0 }}>Nobody is waiting.</p>}
              {waiting.map((r) => (
                <div key={r.userId} style={row}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--q-fg)' }}>{r.email ?? r.userId}</p>
                    <p style={{ ...small, margin: '2px 0 0' }}>{day(r.requestedAt)} · {r.userId}</p>
                    {r.useCase && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--q-fg2)' }}>“{r.useCase}”</p>}
                  </div>
                  <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={() => void act(r.userId, 'invite')}>
                    {busy === r.userId + 'invite' ? 'Inviting…' : 'Invite'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 style={h2}>Invited</h2>
            <div style={box}>
              {data.members.length === 0 && <p style={{ ...row, ...small, margin: 0 }}>No one yet.</p>}
              {data.members.map((m) => (
                <div key={m.userId} style={row}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <p style={{ margin: 0, fontSize: 13, color: m.paused ? 'var(--q-fg3)' : 'var(--q-fg)' }}>
                      {m.email ?? m.userId}{m.paused && <span style={{ ...small, color: 'var(--q-warn-text)' }}> · paused</span>}
                    </p>
                    <p style={{ ...small, margin: '2px 0 0' }}>
                      invited {day(m.invitedAt)} · {m.keys} key{m.keys === 1 ? '' : 's'} · last API call {day(m.lastUsed)} ·{' '}
                      {m.sandboxesThisMonth} sandboxes, {m.minutesThisMonth}/{m.monthlyMinutes} min this month · {m.running} running
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" style={btn(false, !!busy)} disabled={!!busy} onClick={() => void act(m.userId, m.paused ? 'resume' : 'pause')}>
                      {m.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" style={btn(false, !!busy)} disabled={!!busy} onClick={() => void act(m.userId, 'remove')}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            onSubmit={(e) => { e.preventDefault(); if (manualId.trim()) void act(manualId.trim(), 'invite') }}
          >
            <label htmlFor="qbox-manual" style={{ fontSize: 12, color: 'var(--q-fg3)' }}>Invite by Clerk user id</label>
            <input
              id="qbox-manual" value={manualId} onChange={(e) => setManualId(e.currentTarget.value)} placeholder="user_…"
              style={{ flex: 1, minWidth: 200, padding: '7px 10px', borderRadius: 8, border: '1px solid rgb(var(--q-ink-rgb) / .12)', background: 'transparent', color: 'var(--q-fg)', fontFamily: mono, fontSize: 12 }}
            />
            <button type="submit" style={btn(false, !!busy || !manualId.trim())} disabled={!!busy || !manualId.trim()}>Invite</button>
          </form>
        </div>
      )}

      {error && <p role="alert" style={{ fontSize: 12.5, color: 'var(--q-danger-text)', marginTop: 10 }}>{error}</p>}
    </section>
  )
}
