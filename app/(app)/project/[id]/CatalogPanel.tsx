'use client'

// Studio → Products → Catalog (CLAUDE.md §13r): find products from Quante's dropship suppliers and
// add them to the store. The supplier ships every paid order with these products straight to the
// customer; the merchant never holds the goods. Adding writes a new draft version (live after
// Publish). "In your store" lists the catalog products, price alerts and what went to suppliers.
//
// Layout: filter sidebar (categories, brands, suppliers, wholesale price, stock) + product grid +
// a detail drawer with photos, description and a live profit calculator. On narrow screens the
// sidebar becomes a row of category chips and a "Filters" toggle.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Package, Search, SlidersHorizontal, Truck, X } from 'lucide-react'
import type { StoreProduct } from '@/types/store-code'

interface Card {
  id: string; name: string; brand: string; category: string; image: string | null
  wholesale: number; suggested: number; margin: number; currency: string
  stock: number | null; available: boolean; dispatchDays: number | null
  supplier: { id: string; name: string; shipsTo: string[]; demo?: boolean }
}
interface Detail extends Card { description: string; images: string[] }
interface Facet { name: string; count: number }
interface Supplier { id: string; name: string; products: number; demo?: boolean }
interface Result { setUp: boolean; admin?: boolean; items: Card[]; total: number; suppliers: Supplier[]; facets?: { categories: Facet[]; brands: Facet[] } }
interface Link { productId: string; supplierProductId: string; supplier: string; wholesale: number; wholesaleNow: number; priceAlert: boolean; available: boolean; stock: number | null }
interface SupOrder { id: string; orderId: string; supplier: string; status: string; trackingCode: string | null; trackingUrl: string | null; error: string | null; createdAt: string }

const PAGE = 24
const mono = 'var(--q-mono)'
const hair = '1px solid rgb(var(--q-ink-rgb) / .08)'
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap',
  border: primary ? '1px solid rgb(var(--q-acc-rgb) / .45)' : '1px solid rgb(var(--q-ink-rgb) / .12)',
  background: primary ? 'rgb(var(--q-acc-rgb) / .14)' : 'transparent', color: primary ? 'var(--q-acc-text)' : 'var(--q-fg3)',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
})
const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid rgb(var(--q-ink-rgb) / .12)',
  background: 'rgb(var(--q-ink-rgb) / .03)', color: 'var(--q-fg)', minWidth: 0,
}
const label: React.CSSProperties = { fontSize: 10, fontFamily: mono, color: 'var(--q-fg4)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 6px' }
const STATUS: Record<string, string> = { creating: 'sending…', sent: 'sent to supplier', failed: 'not sent (retrying)', shipped: 'shipped', cannot: 'supplier cannot ship' }
const SORTS: Array<[string, string]> = [['relevance', 'Best stocked'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name A–Z']]

const money = (n: number, c: string) => `${n.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${c === 'CZK' ? 'Kč' : c}`
const lastPart = (category: string) => category.split(/[|>]/).map((s) => s.trim()).filter(Boolean).pop() ?? ''

function FacetList({ items, value, onPick, all }: { items: Facet[]; value: string; onPick: (v: string) => void; all: string }) {
  const row = (active: boolean): React.CSSProperties => ({
    display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? 'rgb(var(--q-acc-rgb) / .12)' : 'transparent', color: active ? 'var(--q-acc-text)' : 'var(--q-fg2)', fontWeight: active ? 600 : 400,
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <button style={row(value === '')} onClick={() => onPick('')}>{all}</button>
      {items.map((f) => (
        <button key={f.name} style={row(value === f.name)} onClick={() => onPick(value === f.name ? '' : f.name)}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--q-fg4)' }}>{f.count}</span>
        </button>
      ))}
    </div>
  )
}

export function CatalogPanel({ projectId, currency, onClose, onAdded }: {
  projectId: string
  currency: string
  onClose: () => void
  onAdded: (product: StoreProduct) => void
}) {
  const [tab, setTab] = useState<'find' | 'mine'>('find')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [supplier, setSupplier] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [inStock, setInStock] = useState(true)
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [facets, setFacets] = useState<{ categories: Facet[]; brands: Facet[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [photo, setPhoto] = useState(0)
  const [price, setPrice] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [mine, setMine] = useState<{ setUp: boolean; links: Link[]; orders: SupOrder[] } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const search = useCallback(async (nextPage: number, withFacets = false) => {
    setLoading(true); setError(null)
    const p = new URLSearchParams({ q, page: String(nextPage), currency, sort })
    if (category) p.set('category', category)
    if (brand) p.set('brand', brand)
    if (supplier) p.set('supplier', supplier)
    if (inStock) p.set('inStock', '1')
    if (minPrice.trim()) p.set('minPrice', minPrice.trim())
    if (maxPrice.trim()) p.set('maxPrice', maxPrice.trim())
    if (withFacets) p.set('facets', '1')
    try {
      const res = await fetch(`/api/catalog?${p}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Search failed.')
      setResult(body); setPage(nextPage)
      if (body.facets) setFacets(body.facets)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }, [q, category, brand, supplier, inStock, minPrice, maxPrice, sort, currency])

  // Filters and sort apply at once; the text search on Enter / the button. The first run (on open)
  // also loads the sidebar counts. Deferred: the search sets state as it starts.
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => { search(0, !opened); setOpened(true) }, 0)
    return () => clearTimeout(t)
  }, [category, brand, supplier, inStock, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMine = useCallback(() => {
    fetch(`/api/projects/${projectId}/catalog`).then((r) => r.json()).then(setMine).catch(() => setMine({ setUp: true, links: [], orders: [] }))
  }, [projectId])
  useEffect(() => {
    const t = setTimeout(loadMine, 0)
    return () => clearTimeout(t)
  }, [loadMine])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (detail) setDetail(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, onClose])

  const inStore = useMemo(() => new Set([...(mine?.links ?? []).map((l) => l.supplierProductId), ...added]), [mine, added])

  async function open(c: Card) {
    setDetail({ ...c, description: '', images: c.image ? [c.image] : [] }); setPhoto(0); setPrice(String(c.suggested)); setError(null)
    try {
      const res = await fetch(`/api/catalog/${c.id}`)
      const body = await res.json()
      if (res.ok && body.product) setDetail((d) => (d && d.id === c.id ? { ...d, ...body.product } : d))
    } catch { /* the card's data is enough to add */ }
  }

  async function add() {
    if (!detail) return
    setAdding(true); setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/catalog`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierProductId: detail.id, price }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not add the product.')
      onAdded(body.product as StoreProduct)
      setAdded((s) => new Set(s).add(detail.id))
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
  const profit = detail && Number.isFinite(pickedPrice) && pickedPrice > 0 ? Math.round((pickedPrice - detail.wholesale) * 100) / 100 : null
  const profitShare = profit !== null && pickedPrice > 0 ? Math.round((profit / pickedPrice) * 100) : null
  const demoShown = !!result?.suppliers.some((s) => s.demo)
  const activeFilters = [category, brand, supplier, minPrice, maxPrice].filter(Boolean).length
  const clearFilters = () => { setCategory(''); setBrand(''); setSupplier(''); setMinPrice(''); setMaxPrice('') }

  const sidebar = (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: narrow ? '12px 16px' : '16px 14px 16px 16px', overflowY: 'auto', borderRight: narrow ? 'none' : hair, borderBottom: narrow ? hair : 'none' }}>
      {!narrow && (
        <section>
          <p style={label}>Category</p>
          <FacetList items={facets?.categories ?? []} value={category} onPick={setCategory} all="All products" />
        </section>
      )}
      {(facets?.brands.length ?? 0) > 0 && (
        <section>
          <p style={label}>Brand</p>
          <FacetList items={facets!.brands} value={brand} onPick={setBrand} all="All brands" />
        </section>
      )}
      {(result?.suppliers.length ?? 0) > 1 && (
        <section>
          <p style={label}>Supplier</p>
          <FacetList items={result!.suppliers.map((s) => ({ name: s.name, count: s.products }))} value={result!.suppliers.find((s) => s.id === supplier)?.name ?? ''}
            onPick={(name) => setSupplier(result!.suppliers.find((s) => s.name === name)?.id ?? '')} all="All suppliers" />
        </section>
      )}
      <section>
        <p style={label}>You pay ({currency === 'CZK' ? 'Kč' : currency})</p>
        <form onSubmit={(e) => { e.preventDefault(); search(0) }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input style={{ ...inputStyle, width: '100%', padding: '6px 8px', fontSize: 12 }} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="from" inputMode="decimal" aria-label="Minimum wholesale price" />
          <span style={{ color: 'var(--q-fg4)' }}>–</span>
          <input style={{ ...inputStyle, width: '100%', padding: '6px 8px', fontSize: 12 }} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="to" inputMode="decimal" aria-label="Maximum wholesale price" />
          <button type="submit" style={{ ...btn(false), padding: '6px 8px' }}>OK</button>
        </form>
      </section>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--q-fg2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock only
      </label>
      {activeFilters > 0 && <button style={{ ...btn(false), alignSelf: 'flex-start' }} onClick={clearFilters}>Clear filters</button>}
    </aside>
  )

  return (
    <div role="dialog" aria-modal="true" aria-label="Product catalog" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgb(0 0 0 / .5)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: narrow ? 0 : 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1240px, 100%)', display: 'flex', flexDirection: 'column', background: 'var(--q-bg)', border: narrow ? 'none' : '1px solid rgb(var(--q-ink-rgb) / .1)', borderRadius: narrow ? 0 : 16, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: hair, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 650, margin: 0, letterSpacing: '-.01em' }}>Product catalog</p>
            <p style={{ fontSize: 12, color: 'var(--q-fg3)', margin: '2px 0 0' }}>Sell products from our suppliers. They ship every paid order straight to your customer, you keep the difference.</p>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'rgb(var(--q-ink-rgb) / .05)' }}>
            {(['find', 'mine'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); if (t === 'mine') loadMine() }} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: tab === t ? 'var(--q-bg)' : 'transparent', color: tab === t ? 'var(--q-fg)' : 'var(--q-fg3)', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,.18)' : 'none' }}>
                {t === 'find' ? 'Browse' : `In your store${mine?.links.length ? ` · ${mine.links.length}` : ''}`}
              </button>
            ))}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--q-fg3)', cursor: 'pointer', padding: 6, display: 'flex' }}><X size={18} /></button>
        </div>
        {demoShown && (
          <p style={{ margin: 0, padding: '7px 18px', fontSize: 11.5, color: 'var(--q-warn-text)', background: 'rgb(var(--q-ink-rgb) / .03)', borderBottom: hair }}>
            Demo supplier is on: made-up products marked “Demo”, visible to admins only. Their orders are e-mailed to the admin who added it.
          </p>
        )}

        {tab === 'find' ? (
          <div style={{ flex: 1, minHeight: 0, display: narrow ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: '230px 1fr' }}>
            {(!narrow || filtersOpen) && sidebar}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: 1 }}>
              {/* Search + sort */}
              <form onSubmit={(e) => { e.preventDefault(); search(0) }} style={{ display: 'flex', gap: 8, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', display: 'flex' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--q-fg4)' }} />
                  <input style={{ ...inputStyle, flex: 1, paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, brands, EAN…" aria-label="Search the catalog" />
                </div>
                <select style={inputStyle} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                  {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
                {narrow && <button type="button" style={btn(filtersOpen)} onClick={() => setFiltersOpen((o) => !o)}><SlidersHorizontal size={12} /> Filters{activeFilters ? ` · ${activeFilters}` : ''}</button>}
                <button type="submit" style={btn(true, loading)} disabled={loading}>Search</button>
              </form>
              {narrow && (facets?.categories.length ?? 0) > 0 && (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px 10px' }}>
                  {[{ name: '', count: 0 }, ...facets!.categories].map((c) => (
                    <button key={c.name || 'all'} onClick={() => setCategory(c.name)} style={{ ...btn(category === c.name), borderRadius: 999, fontWeight: 500 }}>{c.name || 'All'}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '0 16px 8px', fontSize: 11.5, color: 'var(--q-fg4)' }}>
                <span>{result?.setUp ? `${result.total.toLocaleString('cs-CZ')} products${category ? ` in ${category}` : ''}${brand ? ` · ${brand}` : ''}` : ''}</span>
                <span>Prices in {currency}. Cash on delivery is not sent to suppliers.</span>
              </div>
              {error && !detail && <p style={{ fontSize: 12, color: 'var(--q-danger-text)', margin: '0 16px 8px' }}>{error}</p>}

              {/* Grid */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px' }}>
                {result && !result.setUp && <p style={{ fontSize: 13, color: 'var(--q-fg3)' }}>The catalog is not available yet.</p>}
                {result?.setUp && result.items.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--q-fg3)' }}>
                    <Package size={28} style={{ color: 'var(--q-fg4)' }} />
                    <p style={{ fontSize: 14, fontWeight: 600, margin: '10px 0 4px', color: 'var(--q-fg2)' }}>{result.suppliers.length === 0 ? 'Suppliers are joining the catalog' : 'No products match'}</p>
                    <p style={{ fontSize: 12.5, margin: 0 }}>{result.suppliers.length === 0 ? 'Products appear here as soon as the first supplier is connected.' : 'Try another search or clear the filters.'}</p>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 150 : 200}px, 1fr))`, gap: 14, opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
                  {result?.items.map((c) => {
                    const owned = inStore.has(c.id)
                    const profitAbs = Math.round((c.suggested - c.wholesale) * 100) / 100
                    return (
                      <button key={c.id} onClick={() => open(c)} style={{ textAlign: 'left', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', background: 'rgb(var(--q-ink-rgb) / .02)', border: hair, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ position: 'relative' }}>
                          {c.image ? (
                            // Supplier's photo, shown here only; the store gets our own copy when the product is added.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.image} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ display: 'block', width: '100%', aspectRatio: '1', objectFit: 'cover', background: 'rgb(var(--q-ink-rgb) / .04)' }} />
                          ) : (
                            <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--q-ink-rgb) / .04)' }}><Package size={22} style={{ color: 'var(--q-fg4)' }} /></div>
                          )}
                          <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, fontWeight: 700, fontFamily: mono, padding: '3px 7px', borderRadius: 999, background: 'var(--q-acc)', color: 'var(--q-acc-ink)' }}>{c.margin} %</span>
                          {c.supplier.demo && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 999, background: 'rgb(0 0 0 / .55)', color: 'var(--q-fg)' }}>Demo</span>}
                          {owned && <span style={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: 'rgb(0 0 0 / .6)', color: 'var(--q-ok-text)' }}><Check size={11} /> In your store</span>}
                          {!c.available && <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10.5, padding: '3px 8px', borderRadius: 999, background: 'rgb(0 0 0 / .6)', color: 'var(--q-warn-text)' }}>Out of stock</span>}
                        </div>
                        <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                          <p style={{ fontSize: 10, fontFamily: mono, color: 'var(--q-fg4)', margin: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.brand || lastPart(c.category)}</p>
                          <p style={{ fontSize: 13, fontWeight: 550, margin: 0, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.name}</p>
                          <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{money(c.suggested, c.currency)}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--q-ok-text)' }}>+{money(profitAbs, c.currency)}</span>
                          </div>
                          <p style={{ fontSize: 11, color: 'var(--q-fg4)', margin: 0 }}>You pay {money(c.wholesale, c.currency)}{c.dispatchDays !== null ? ` · ships in ${c.dispatchDays} d` : ''}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {result?.setUp && result.total > PAGE && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '18px 0 4px' }}>
                    <button style={btn(false, page === 0 || loading)} disabled={page === 0 || loading} onClick={() => search(page - 1)}><ChevronLeft size={13} /> Previous</button>
                    <span style={{ fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)' }}>{page + 1} / {Math.ceil(result.total / PAGE)}</span>
                    <button style={btn(false, loading || (page + 1) * PAGE >= result.total)} disabled={loading || (page + 1) * PAGE >= result.total} onClick={() => search(page + 1)}>Next <ChevronRight size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 22 }}>
            {!mine && <p style={{ fontSize: 12, color: 'var(--q-fg4)' }}>Loading…</p>}
            {mine && (
              <>
                <section>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Catalog products in this store</p>
                  {mine.links.length === 0 && <p style={{ fontSize: 12, color: 'var(--q-fg3)' }}>None yet. Pick products in Browse.</p>}
                  {mine.links.map((l) => (
                    <div key={l.productId} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)', fontSize: 12 }}>
                      <span style={{ fontFamily: mono, color: 'var(--q-fg4)' }}>{l.productId}</span>
                      <span style={{ flex: 1, color: 'var(--q-fg3)' }}>{l.supplier} · you pay {money(l.wholesaleNow, currency)}{!l.available ? ' · out of stock at the supplier' : l.stock !== null ? ` · ${l.stock} in stock` : ''}</span>
                      {l.priceAlert && (
                        <span style={{ color: 'var(--q-warn-text)' }}>
                          Wholesale price changed from {money(l.wholesale, currency)}. Check your price.{' '}
                          <button style={btn(false)} onClick={() => ackPrice(l.productId)}>OK</button>
                        </span>
                      )}
                    </div>
                  ))}
                </section>
                <section>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Orders sent to suppliers</p>
                  {mine.orders.length === 0 && <p style={{ fontSize: 12, color: 'var(--q-fg3)' }}>None yet. Paid orders with catalog products are sent automatically.</p>}
                  {mine.orders.map((o) => (
                    <div key={o.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .05)', fontSize: 12 }}>
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

        {/* Product detail */}
        {detail && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgb(0 0 0 / .35)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setDetail(null)}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={detail.name} style={{ width: narrow ? '100%' : 'min(440px, 100%)', height: '100%', background: 'var(--q-bg)', borderLeft: hair, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: hair }}>
                <p style={{ flex: 1, margin: 0, fontSize: 11, fontFamily: mono, color: 'var(--q-fg4)' }}>{detail.category.split(/[|>]/).map((s) => s.trim()).filter(Boolean).join(' › ')}</p>
                <button aria-label="Close product" onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: 'var(--q-fg3)', cursor: 'pointer', padding: 4, display: 'flex' }}><X size={16} /></button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {detail.images[photo] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detail.images[photo]} alt="" referrerPolicy="no-referrer" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 12, background: 'rgb(var(--q-ink-rgb) / .04)' }} />
                ) : (
                  <div style={{ aspectRatio: '1', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--q-ink-rgb) / .04)' }}><Package size={30} style={{ color: 'var(--q-fg4)' }} /></div>
                )}
                {detail.images.length > 1 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {detail.images.slice(0, 5).map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt="" referrerPolicy="no-referrer" onClick={() => setPhoto(i)} style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', outline: i === photo ? '2px solid var(--q-acc)' : 'none' }} />
                    ))}
                  </div>
                )}
                <div>
                  <p style={{ ...label, margin: 0 }}>{detail.brand}{detail.supplier.demo ? ' · Demo' : ''}</p>
                  <p style={{ fontSize: 18, fontWeight: 650, margin: '4px 0 0', lineHeight: 1.25 }}>{detail.name}</p>
                </div>
                {detail.description && <p style={{ fontSize: 13, color: 'var(--q-fg2)', margin: 0, lineHeight: 1.55 }}>{detail.description}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['You pay', money(detail.wholesale, detail.currency)],
                    ['Suggested price', money(detail.suggested, detail.currency)],
                    ['Stock', !detail.available ? 'Out of stock' : detail.stock !== null ? `${detail.stock} pcs` : 'In stock'],
                    ['Ships', detail.dispatchDays !== null ? `in ${detail.dispatchDays} ${detail.dispatchDays === 1 ? 'day' : 'days'}` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '9px 11px', borderRadius: 10, border: hair }}>
                      <p style={{ fontSize: 10.5, color: 'var(--q-fg4)', margin: 0 }}>{k}</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: '2px 0 0' }}>{v}</p>
                    </div>
                  ))}
                </div>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--q-fg3)', margin: 0 }}>
                  <Truck size={13} /> {detail.supplier.name} ships to your customer{detail.supplier.shipsTo.length ? ` (${detail.supplier.shipsTo.join(', ')})` : ''} in neutral packaging.
                </p>
              </div>
              <div style={{ borderTop: hair, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: 'rgb(var(--q-acc-rgb) / .04)' }}>
                {inStore.has(detail.id) ? (
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--q-ok-text)', margin: 0 }}>
                    <Check size={15} /> In your store. It goes live with your next Publish.
                  </p>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 12, color: 'var(--q-fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        Your price
                        <input style={{ ...inputStyle, width: 110 }} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Your selling price" />
                        {detail.currency === 'CZK' ? 'Kč' : detail.currency}
                      </label>
                      <span style={{ fontSize: 13, fontWeight: 600, color: profit !== null && profit > 0 ? 'var(--q-ok-text)' : 'var(--q-danger-text)' }}>
                        {profit === null ? '' : profit > 0 ? `You earn ${money(profit, detail.currency)} (${profitShare} %)` : 'Below what you pay'}
                      </span>
                    </div>
                    {error && <p style={{ fontSize: 12, color: 'var(--q-danger-text)', margin: 0 }}>{error}</p>}
                    <button style={{ ...btn(true, adding || !detail.available), padding: '10px 14px', fontSize: 13 }} disabled={adding || !detail.available} onClick={add}>
                      {adding ? 'Adding…' : 'Add to my store'}
                    </button>
                    <p style={{ fontSize: 11, color: 'var(--q-fg4)', margin: 0 }}>Photos are copied into your store. The product goes live with your next Publish.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
