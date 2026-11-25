'use client'

// Admin → Suppliers (/api/admin/suppliers, CLAUDE.md §13r): add a dropship partner (feed address,
// order e-mail, how the wholesale price is read), import its feed now, pause / resume it.

import { useEffect, useState } from 'react'

const mono = 'var(--q-mono)'

interface Row {
  id: string; slug: string; name: string; status: 'active' | 'paused'; feed_url: string; feed_format: string
  wholesale_field: string | null; wholesale_discount_pct: number | null; currency: string; order_email: string
  dispatch_days: number; ships_to: string[]; note: string | null; product_count: number
  last_import_at: string | null; last_import_error: string | null; linked: number
}

const EMPTY = { id: '', name: '', slug: '', feedUrl: '', feedFormat: 'auto', wholesaleField: '', wholesaleDiscountPct: '', currency: 'CZK', orderEmail: '', dispatchDays: '2', shipsTo: 'CZ', note: '' }
type Form = typeof EMPTY

const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  background: primary ? 'var(--q-acc)' : 'none', color: primary ? 'var(--q-acc-ink)' : 'var(--q-fg3)',
  border: primary ? 'none' : '1px solid rgb(var(--q-ink-rgb) / .12)', borderRadius: 8, padding: '6px 12px',
  fontSize: 12, fontWeight: primary ? 600 : 500, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
})
const input: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '7px 9px', borderRadius: 7, border: '1px solid rgb(var(--q-ink-rgb) / .12)',
  background: 'rgb(var(--q-ink-rgb) / .03)', color: 'var(--q-fg)',
}
const small: React.CSSProperties = { fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)' }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never')

export function SuppliersAdmin() {
  const [data, setData] = useState<{ setUp: boolean; suppliers: Row[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let off = false
    fetch('/api/admin/suppliers', { cache: 'no-store' })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (off) return
        if (!res.ok || !body) setError(body?.error ?? `Could not load (${res.status}).`)
        else setData(body)
      })
      .catch(() => { if (!off) setError('Could not load.') })
    return () => { off = true }
  }, [tick])

  async function post(payload: Record<string, unknown>, key: string): Promise<Record<string, unknown> | null> {
    setBusy(key); setError(null); setNote(null)
    const res = await fetch('/api/admin/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setError(body?.error ?? 'Failed.'); return null }
    return body
  }

  async function save() {
    if (!form) return
    const r = await post({ action: 'save', ...form, id: form.id || undefined }, 'save')
    if (r) { setForm(null); setTick((t) => t + 1) }
  }

  async function runImport(id: string) {
    const r = await post({ action: 'import', id }, id + 'import')
    if (r) {
      setNote(r.ok ? `Imported ${r.imported} products (${r.skipped} skipped, ${r.gone} no longer in the feed, ${r.linkedUpdated} store products updated).` : `Import failed: ${r.error}`)
      setTick((t) => t + 1)
    }
  }

  const edit = (s: Row) => setForm({
    id: s.id, name: s.name, slug: s.slug, feedUrl: s.feed_url, feedFormat: s.feed_format, wholesaleField: s.wholesale_field ?? '',
    wholesaleDiscountPct: s.wholesale_discount_pct === null ? '' : String(s.wholesale_discount_pct), currency: s.currency,
    orderEmail: s.order_email, dispatchDays: String(s.dispatch_days), shipsTo: s.ships_to.join(', '), note: s.note ?? '',
  })

  const field = (key: keyof Form, label: string, hint?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--q-fg3)' }}>
      {label}
      {key === 'feedFormat' ? (
        <select style={input} value={form![key]} onChange={(e) => setForm({ ...form!, [key]: e.target.value })}>
          <option value="auto">Detect</option><option value="heureka">Heureka / Zboží XML</option><option value="google">Google Merchant XML</option><option value="csv">CSV</option>
        </select>
      ) : (
        <input style={input} value={form![key]} onChange={(e) => setForm({ ...form!, [key]: e.target.value })} />
      )}
      {hint && <span style={{ fontSize: 10, color: 'var(--q-fg4)' }}>{hint}</span>}
    </label>
  )

  return (
    <section style={{ margin: '0 0 2.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em', margin: 0 }}>Suppliers (catalog)</h1>
        {data?.setUp && !form && <button style={btn(true)} onClick={() => setForm({ ...EMPTY })}>Add supplier</button>}
      </div>
      {!data && !error && <p style={small}>Loading…</p>}
      {data && !data.setUp && <p style={{ fontSize: 13, color: 'var(--q-warn-text)' }}>Not set up: run <code>supabase/migration-supplier-catalog.sql</code> in Supabase first.</p>}
      {error && <p style={{ fontSize: 12, color: 'var(--q-danger-text)' }}>{error}</p>}
      {note && <p style={{ fontSize: 12, color: 'var(--q-ok-text)' }}>{note}</p>}

      {form && (
        <div style={{ borderRadius: 10, border: '1px solid rgb(var(--q-ink-rgb) / .1)', padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {field('name', 'Name')}
          {field('slug', 'Slug', 'Empty = from the name')}
          {field('feedUrl', 'Feed URL', 'The supplier’s product feed (with its access key in the query if it has one)')}
          {field('feedFormat', 'Feed format')}
          {field('wholesaleField', 'Wholesale price tag / column', 'Empty = common names (NAKUPNI_CENA, VOC, PRICE_WHOLESALE…)')}
          {field('wholesaleDiscountPct', 'Or: discount off retail, %', 'Used only when the feed has no wholesale price')}
          {field('orderEmail', 'Order e-mail', 'Paid orders go here')}
          {field('currency', 'Currency')}
          {field('dispatchDays', 'Dispatch days')}
          {field('shipsTo', 'Ships to', 'Country codes, e.g. CZ, SK')}
          {field('note', 'Note (internal)')}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button style={btn(true, busy === 'save')} disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button style={btn(false)} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {data?.setUp && (
        <div style={{ borderRadius: 10, border: '1px solid rgb(var(--q-ink-rgb) / .07)', overflow: 'hidden' }}>
          {data.suppliers.length === 0 && <p style={{ ...small, padding: '14px' }}>No suppliers yet.</p>}
          {data.suppliers.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--q-fg)' }}>
                  {s.name} {s.status === 'paused' && <span style={{ ...small, color: 'var(--q-warn-text)' }}>paused</span>}
                </p>
                <p style={{ ...small, margin: '2px 0 0' }}>
                  {s.product_count} products · {s.linked} in stores · {s.currency} · import {when(s.last_import_at)} · orders → {s.order_email}
                </p>
                {s.last_import_error && <p style={{ fontSize: 11, color: 'var(--q-danger-text)', margin: '2px 0 0' }}>{s.last_import_error}</p>}
              </div>
              <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => runImport(s.id)}>{busy === s.id + 'import' ? 'Importing…' : 'Import now'}</button>
              <button style={btn(false)} onClick={() => edit(s)}>Edit</button>
              <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => post({ action: s.status === 'paused' ? 'resume' : 'pause', id: s.id }, s.id).then((r) => r && setTick((t) => t + 1))}>
                {s.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
