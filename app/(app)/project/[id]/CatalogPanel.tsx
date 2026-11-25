'use client'

// Studio → Products → Catalog (CLAUDE.md §13r): find products from Quante's dropship suppliers and
// add them to the store. The supplier ships every paid order with these products straight to the
// customer; the merchant never holds the goods. Adding writes a new draft version (live after
// Publish). "In your store" lists the catalog products, price alerts and what went to suppliers.

import { useCallback, useEffect, useState } from 'react'
import { Package, Search, X } from 'lucide-react'
import type { StoreProduct } from '@/types/store-code'

interface Card {
  id: string; name: string; brand: string; category: string; image: string | null
  wholesale: number; suggested: number; margin: number; currency: string
  stock: number | null; available: boolean; dispatchDays: number | null
  supplier: { id: string; name: string; shipsTo: string[] }
}
interface Link { productId: string; supplier: string; wholesale: number; wholesaleNow: number; priceAlert: boolean; available: boolean; stock: number | null }
interface SupOrder { id: string; orderId: string; supplier: string; status: string; trackingCode: string | null; trackingUrl: string | null; error: string | null; createdAt: string }

const mono = 'var(--q-mono)'
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 7, whiteSpace: 'nowrap',
  border: primary ? '1px solid rgb(var(--q-acc-rgb) / .45)' : '1px solid rgb(var(--q-ink-rgb) / .12)',
  background: primary ? 'rgb(var(--q-acc-rgb) / .12)' : 'transparent', color: primary ? 'var(--q-acc-text)' : 'var(--q-fg3)',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
})
const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid rgb(var(--q-ink-rgb) / .12)',
  background: 'rgb(var(--q-ink-rgb) / .03)', color: 'var(--q-fg)', minWidth: 0,
}
const STATUS: Record<string, string> = { creating: 'sending…', sent: 'sent to supplier', failed: 'not sent (retrying)', shipped: 'shipped', cannot: 'supplier cannot ship' }

const money = (n: number, c: string) => `${n.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${c === 'CZK' ? 'Kč' : c}`

export function CatalogPanel({ projectId, currency, onClose, onAdded }: {
  projectId: string
  currency: string
  onClose: () => void
  onAdded: (product: StoreProduct) => void
}) {
  const [tab, setTab] = useState<'find' | 'mine'>('find')
  const [q, setQ] = useState('')
  const [supplier, setSupplier] = useState('')
  const [inStock, setInStock] = useState(true)
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{ setUp: boolean; items: Card[]; total: number; suppliers: Array<{ id: string; name: string; products: number }> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<Card | null>(null)
  const [price, setPrice] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [mine, setMine] = useState<{ setUp: boolean; links: Link[]; orders: SupOrder[] } | null>(null)

  const search = useCallback(async (nextPage: number) => {
    setLoading(true); setError(null)
    const p = new URLSearchParams({ q, page: String(nextPage), currency })
    if (supplier) p.set('supplier', supplier)
    if (inStock) p.set('inStock', '1')
    try {
      const res = await fetch(`/api/catalog?${p}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Search failed.')
      setResult(body); setPage(nextPage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }, [q, supplier, inStock, currency])

  // First page on open (deferred: the search sets state as it starts).
  useEffect(() => {
    const t = setTimeout(() => { search(0) }, 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'mine') return
    fetch(`/api/projects/${projectId}/catalog`).then((r) => r.json()).then(setMine).catch(() => setMine({ setUp: true, links: [], orders: [] }))
  }, [tab, projectId])

  async function add() {
    if (!pick) return
    setAdding(true); setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/catalog`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierProductId: pick.id, price }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not add the product.')
      onAdded(body.product as StoreProduct)
      setAdded((s) => new Set(s).add(pick.id))
      setPick(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the product.')
    } finally {
      setAdding(false)
    }
  }

  async function ackPrice(productId: string) {
    await fetch(`/api/projects/${projectId}/catalog`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, action: 'ack-price' }) })
    setMine((m) => (m ? { ...m, links: m.links.map((l) => (l.productId === productId ? { ...l, priceAlert: false, wholesale: l.wholesaleNow } : l)) } : m))
  }

  const pickedPrice = Number(price.replace(',', '.'))
  const pickedMargin = pick && Number.isFinite(pickedPrice) && pickedPrice > 0 ? pickedPrice - pick.wholesale : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Product catalog" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgb(0 0 0 / .45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(920px, 100%)', maxHeight: 'min(88vh, 900px)', display: 'flex', flexDirection: 'column', background: 'var(--q-bg)', border: '1px solid rgb(var(--q-ink-rgb) / .1)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .08)' }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0, flex: 1 }}>Product catalog</p>
          <button style={btn(tab === 'find')} onClick={() => setTab('find')}>Find products</button>
          <button style={btn(tab === 'mine')} onClick={() => setTab('mine')}>In your store</button>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--q-fg3)', cursor: 'pointer', padding: 4, display: 'flex' }}><X size={16} /></button>
        </div>

        {tab === 'find' ? (
          <>
            <form onSubmit={(e) => { e.preventDefault(); search(0) }} style={{ display: 'flex', gap: 8, padding: '12px 16px', flexWrap: 'wrap', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .06)' }}>
              <input style={{ ...inputStyle, flex: '1 1 220px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand, product, EAN…" aria-label="Search the catalog" />
              <select style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier">
                <option value="">All suppliers</option>
                {result?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.products})</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--q-fg3)' }}>
                <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock
              </label>
              <button type="submit" style={btn(true, loading)} disabled={loading}><Search size={12} /> Search</button>
            </form>
            <p style={{ fontSize: 11, color: 'var(--q-fg4)', margin: 0, padding: '8px 16px 0' }}>
              The supplier ships each paid order straight to your customer. You pay the supplier the wholesale price. Showing products sold in {currency}. Cash-on-delivery orders are not sent automatically.
            </p>
            {error && <p style={{ fontSize: 12, color: 'var(--q-danger-text)', margin: '8px 16px 0' }}>{error}</p>}
            <div style={{ overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              {result && !result.setUp && <p style={{ fontSize: 13, color: 'var(--q-fg3)' }}>The catalog is not available yet.</p>}
              {result?.setUp && result.items.length === 0 && !loading && <p style={{ fontSize: 13, color: 'var(--q-fg3)' }}>No products match.</p>}
              {result?.items.map((c) => (
                <div key={c.id} style={{ border: '1px solid rgb(var(--q-ink-rgb) / .08)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {c.image ? (
                    // Supplier's photo, shown here only; the store gets our own copy when the product is added.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', background: 'rgb(var(--q-ink-rgb) / .04)' }} />
                  ) : (
                    <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--q-ink-rgb) / .04)' }}><Package size={22} style={{ color: 'var(--q-fg4)' }} /></div>
                  )}
                  <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                    {c.brand && <p style={{ fontSize: 10, fontFamily: mono, color: 'var(--q-fg4)', margin: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>{c.brand}</p>}
                    <p style={{ fontSize: 12.5, fontWeight: 500, margin: 0, lineHeight: 1.3 }}>{c.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--q-fg3)', margin: '2px 0 0' }}>You pay {money(c.wholesale, c.currency)} · sell {money(c.suggested, c.currency)} · {c.margin} %</p>
                    <p style={{ fontSize: 10.5, color: 'var(--q-fg4)', margin: 0 }}>
                      {c.supplier.name}{c.dispatchDays !== null ? ` · ships in ${c.dispatchDays} d` : ''}{!c.available ? ' · out of stock' : c.stock !== null ? ` · ${c.stock} in stock` : ''}
                    </p>
                    <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                      {added.has(c.id) ? (
                        <span style={{ fontSize: 12, color: 'var(--q-ok-text)' }}>✓ Added</span>
                      ) : (
                        <button style={btn(true, !c.available)} disabled={!c.available} onClick={() => { setPick(c); setPrice(String(c.suggested)); setError(null) }}>Add to store</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {result?.setUp && result.total > 24 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '0 16px 14px' }}>
                <button style={btn(false, page === 0 || loading)} disabled={page === 0 || loading} onClick={() => search(page - 1)}>Previous</button>
                <span style={{ fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)', alignSelf: 'center' }}>page {page + 1}</span>
                <button style={btn(false, loading || (page + 1) * 24 >= result.total)} disabled={loading || (page + 1) * 24 >= result.total} onClick={() => search(page + 1)}>Next</button>
              </div>
            )}
          </>
        ) : (
          <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {!mine && <p style={{ fontSize: 12, color: 'var(--q-fg4)' }}>Loading…</p>}
            {mine && (
              <>
                <section>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>Catalog products in this store</p>
                  {mine.links.length === 0 && <p style={{ fontSize: 12, color: 'var(--q-fg3)' }}>None yet.</p>}
                  {mine.links.map((l) => (
                    <div key={l.productId} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)', fontSize: 12 }}>
                      <span style={{ fontFamily: mono, color: 'var(--q-fg4)' }}>{l.productId}</span>
                      <span style={{ flex: 1, color: 'var(--q-fg3)' }}>{l.supplier} · you pay {money(l.wholesaleNow, currency)}{!l.available ? ' · out of stock at the supplier' : ''}</span>
                      {l.priceAlert && (
                        <span style={{ color: 'var(--q-warn-text)' }}>
                          Wholesale price changed from {money(l.wholesale, currency)} — check your price.{' '}
                          <button style={btn(false)} onClick={() => ackPrice(l.productId)}>OK</button>
                        </span>
                      )}
                    </div>
                  ))}
                </section>
                <section>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>Orders sent to suppliers</p>
                  {mine.orders.length === 0 && <p style={{ fontSize: 12, color: 'var(--q-fg3)' }}>None yet. Paid orders with catalog products are sent automatically.</p>}
                  {mine.orders.map((o) => (
                    <div key={o.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)', fontSize: 12 }}>
                      <span style={{ fontFamily: mono, color: 'var(--q-fg4)' }}>{new Date(o.createdAt).toLocaleDateString('en-GB')}</span>
                      <span style={{ flex: 1 }}>{o.supplier}</span>
                      <span style={{ color: o.status === 'failed' || o.status === 'cannot' || o.status === 'creating' ? 'var(--q-warn-text)' : 'var(--q-fg3)' }}>
                        {STATUS[o.status] ?? o.status}{o.trackingCode ? ` · ${o.trackingCode}` : ''}{o.error && o.status === 'cannot' ? ` · ${o.error}` : ''}
                      </span>
                    </div>
                  ))}
                  {mine.orders.some((o) => o.status === 'creating') && (
                    <p style={{ fontSize: 11, color: 'var(--q-fg4)' }}>“sending…” for more than a few minutes: we could not confirm the e-mail went out. Check with the supplier before sending the order again.</p>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {pick && (
          <div style={{ borderTop: '1px solid rgb(var(--q-ink-rgb) / .1)', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'rgb(var(--q-acc-rgb) / .04)' }}>
            <p style={{ fontSize: 12.5, margin: 0, flex: '1 1 240px' }}><b>{pick.name}</b><br /><span style={{ color: 'var(--q-fg3)' }}>You pay {money(pick.wholesale, pick.currency)}{pickedMargin !== null ? ` · you earn ${money(Math.round(pickedMargin * 100) / 100, pick.currency)} a piece` : ''}</span></p>
            <label style={{ fontSize: 12, color: 'var(--q-fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Your price
              <input style={{ ...inputStyle, width: 110 }} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Your selling price" />
              {pick.currency}
            </label>
            <button style={btn(true, adding)} disabled={adding} onClick={add}>{adding ? 'Adding…' : 'Add to store'}</button>
            <button style={btn(false)} onClick={() => setPick(null)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
