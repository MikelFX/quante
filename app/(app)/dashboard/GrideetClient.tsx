'use client'

// Grideet's grid: brand cards (one per store, plus "Unassigned"), filters in the URL (the server
// filters and pages, lib/grideet/load.ts), items of a brand on expand. Every action leads into an
// existing flow; the few that change something here (share, undo, delete) ask first and call the
// API that module already has. Nothing here spends credits.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AGENCY_BATCH_SIZE } from '@/lib/config'
import {
  KINDS, MODULES, STATUSES,
  type BrandGroup, type GridAction, type GridItem, type GrideetFilters, type KindId, type StoreState,
} from '@/lib/grideet/model'
import { GridImage, GridVideo } from './GrideetMedia'

interface Props {
  groups: BrandGroup[]
  page: number
  pages: number
  total: number
  filters: GrideetFilters & { page: number }
  isAgency: boolean
  capped: string[]
  skipped: string[]
}

const QADS_DRAFT_KEY = 'qads:draft:v1'
const ITEMS_STEP = 24

const STATE_LABEL: Record<StoreState, string> = {
  live: 'Live',
  changes: 'Unpublished changes',
  draft: 'Not published',
  generating: 'Generating',
}
const MODULE_LABEL: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.id, m.label]))
const KIND_ICON: Record<KindId, string> = { product: '▣', video: '▶', photo: '◩', scan: '⌕', edit: '✎', export: '⇩', build: '◌' }

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 60 ? `${d}d ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function countsLine(g: BrandGroup, capped: string[]): string[] {
  const out: string[] = []
  for (const k of KINDS) {
    if (k.id === 'store') continue
    const n = g.counts[k.id as KindId]
    if (!n) continue
    const plus = (k.id === 'video' || k.id === 'photo') && capped.includes('qads') ? '+' : ''
    out.push(`${n}${plus} ${n === 1 ? k.label.toLowerCase() : k.plural}`)
  }
  return out
}

// ─── Confirm dialog ─────────────────────────────────────────────────────────────────────────

interface Ask { text: string; ok: string; danger?: boolean; run: () => Promise<void> }

function ConfirmDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, onClose])
  return (
    <div className="gd-modal" role="presentation" onClick={() => { if (!busy) onClose() }}>
      <div className="gd-dialog q-card" role="dialog" aria-modal="true" aria-label="Confirm" onClick={(e) => e.stopPropagation()}>
        <p>{ask.text}</p>
        <div className="gd-dialog-actions">
          <button type="button" className="q-btn q-btn-gl" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            ref={okRef}
            type="button"
            className={`q-btn${ask.danger ? ' gd-danger' : ''}`}
            disabled={busy}
            onClick={async () => { setBusy(true); try { await ask.run() } finally { setBusy(false); onClose() } }}
          >
            {busy ? 'Working…' : ask.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────────

export function GrideetClient({ groups, page, pages, total, filters, isAgency, capped, skipped }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(filters.q ?? '')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [ask, setAsk] = useState<Ask | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [deleted, setDeleted] = useState<Set<string>>(new Set())

  const itemFilterOn = (filters.module && filters.module !== 'all')
    || (filters.kind && filters.kind !== 'all' && filters.kind !== 'store')
    || (filters.status && ['working', 'open', 'failed'].includes(filters.status))
    || !!filters.q
  const anyFilter = itemFilterOn || (filters.kind && filters.kind !== 'all') || (filters.status && filters.status !== 'all')

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const sp = new URLSearchParams()
    const cur: Record<string, string> = { q: filters.q ?? '', module: filters.module ?? 'all', kind: filters.kind ?? 'all', status: filters.status ?? 'all', page: String(filters.page) }
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && v !== 'all' && !(k === 'page' && v === '1')) sp.set(k, v)
    if (!('page' in patch)) sp.delete('page')
    const qs = sp.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: 'page' in patch }))
  }, [filters, pathname, router])

  // Search: debounced into the URL.
  useEffect(() => {
    if ((filters.q ?? '') === q.trim()) return
    const t = setTimeout(() => setParams({ q: q.trim() || null }), 350)
    return () => clearTimeout(t)
  }, [q, filters.q, setParams])

  const visible = useMemo(() => groups.filter((g) => !g.id || !deleted.has(g.id)), [groups, deleted])
  const isOpen = (g: BrandGroup) => itemFilterOn || open.has(g.id ?? '_') || (visible.length === 1 && g.items.length > 0)
  const toggleOpen = (g: BrandGroup) => setOpen((s) => { const n = new Set(s); const k = g.id ?? '_'; if (n.has(k)) n.delete(k); else n.add(k); return n })

  // ── Actions ──
  const refresh = () => startTransition(() => router.refresh())

  async function runAction(a: GridAction) {
    if (a.type === 'qadsDraft') {
      try { sessionStorage.setItem(QADS_DRAFT_KEY, JSON.stringify(a.payload ?? {})) } catch {}
      window.location.assign(a.href ?? '/qads')
      return
    }
    const go = async () => {
      if (a.type === 'qadsShare') {
        const p = a.payload as { generationId: string; share: boolean }
        const res = await fetch(`/api/qads/generations/${p.generationId}/share`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share: p.share }),
        }).catch(() => null)
        const d = res ? await res.json().catch(() => ({})) : {}
        setNotice(res?.ok ? { kind: 'ok', text: p.share ? 'Shared in the community.' : 'Taken down from the community.' } : { kind: 'error', text: d.error ?? 'Could not update sharing.' })
        if (res?.ok) refresh()
      } else if (a.type === 'qgentRevert') {
        const p = a.payload as { projectId: string; actionId: string }
        const res = await fetch(`/api/projects/${p.projectId}/qgent/actions/${p.actionId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'revert' }),
        }).catch(() => null)
        const d = res ? await res.json().catch(() => ({})) : {}
        setNotice(res?.ok ? { kind: 'ok', text: 'Undone — saved as a new draft version. Shoppers see it after you Publish.' } : { kind: 'error', text: d.error ?? 'Could not undo this change.' })
        if (res?.ok) refresh()
      }
    }
    if (a.confirm) setAsk({ text: a.confirm, ok: a.label, run: go })
    else await go()
  }

  function askDelete(g: BrandGroup) {
    if (!g.id) return
    const id = g.id
    setAsk({
      text: `Delete “${g.name}”? This cannot be undone. Export the code first if you want to keep it.`,
      ok: 'Delete',
      danger: true,
      run: async () => {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => null)
        if (!res?.ok) {
          const d = res ? await res.json().catch(() => ({})) : {}
          setNotice({ kind: 'error', text: d.error ?? 'Failed to delete the store.' })
          return
        }
        setDeleted((s) => new Set([...s, id]))
        setSelected((s) => { const n = new Set(s); n.delete(id); return n })
        refresh()
      },
    })
  }

  // ── Agency bulk export (up to AGENCY_BATCH_SIZE per ZIP, /api/export/bulk) ──
  const stores = visible.filter((g) => g.id).map((g) => g.id as string)
  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else if (n.size < AGENCY_BATCH_SIZE) n.add(id)
    return n
  })
  async function bulkExport() {
    if (exporting || !selected.size) return
    setExporting(true)
    try {
      const res = await fetch('/api/export/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectIds: [...selected] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setNotice({ kind: 'error', text: d.error ?? 'Export failed.' })
        return
      }
      const blob = await res.blob()
      const filename = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? 'stores.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setSelected(new Set())
    } catch {
      setNotice({ kind: 'error', text: 'Export failed.' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      {/* ── Filters ── */}
      <div className="gd-filters" role="search" aria-busy={pending}>
        <label className="gd-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stores, products, ads…"
            maxLength={100}
          />
        </label>
        <Select label="Module" value={filters.module ?? 'all'} onChange={(v) => setParams({ module: v })}
          options={[{ id: 'all', label: 'All modules' }, ...MODULES]} />
        <Select label="Type" value={filters.kind ?? 'all'} onChange={(v) => setParams({ kind: v })}
          options={[{ id: 'all', label: 'All types' }, ...KINDS.filter((k) => k.id !== 'build').map((k) => ({ id: k.id, label: k.label }))]} />
        <Select label="Status" value={filters.status ?? 'all'} onChange={(v) => setParams({ status: v })}
          options={[{ id: 'all', label: 'Any status' }, ...STATUSES]} />
        {anyFilter && (
          <button type="button" className="gd-clear" onClick={() => { setQ(''); setParams({ q: null, module: null, kind: null, status: null }) }}>Clear</button>
        )}
        {pending && <span className="gd-pending" aria-live="polite">Loading…</span>}
      </div>

      {notice && (
        <div role="status" className={`gd-note${notice.kind === 'error' ? ' gd-note-error' : ' gd-note-ok'}`}>
          {notice.text}
          <button type="button" className="gd-note-x" aria-label="Dismiss" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {skipped.length > 0 && (
        <p className="gd-quiet">Some sources could not be read right now ({skipped.join(', ')}) — what they hold is not shown.</p>
      )}

      {/* ── Agency bulk export ── */}
      {isAgency && stores.length > 0 && (
        <div className={`gd-bulk${selected.size ? ' gd-bulk-on' : ''}`}>
          <span>
            {selected.size ? `${selected.size} selected` : 'Select stores to export their code'}
            <span className="gd-mono"> · up to {AGENCY_BATCH_SIZE} per export</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {selected.size > 0 && <button type="button" className="gd-link" onClick={() => setSelected(new Set())}>Clear</button>}
            {selected.size > 0 && (
              <button type="button" className="q-btn" onClick={bulkExport} disabled={exporting}>
                {exporting ? 'Exporting…' : `Export ${selected.size} ZIP${selected.size > 1 ? 's' : ''}`}
              </button>
            )}
          </span>
        </div>
      )}

      {/* ── Brands ── */}
      {visible.length === 0 ? (
        <div className="q-card gd-none">
          <p>Nothing matches these filters.</p>
          <button type="button" className="q-btn q-btn-gl" onClick={() => { setQ(''); setParams({ q: null, module: null, kind: null, status: null }) }}>Show everything</button>
        </div>
      ) : (
        <div className="gd-grid">
          {visible.map((g) => (
            <BrandCard
              key={g.id ?? '_unassigned'}
              g={g}
              open={isOpen(g)}
              onToggle={() => toggleOpen(g)}
              capped={capped}
              isAgency={isAgency}
              selected={!!g.id && selected.has(g.id)}
              onSelect={() => g.id && toggleSelect(g.id)}
              onDelete={() => askDelete(g)}
              onAction={runAction}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="gd-pager" aria-label="Pages">
          <button type="button" className="q-btn q-btn-gl" disabled={page <= 1 || pending} onClick={() => setParams({ page: String(page - 1) })}>← Newer</button>
          <span className="gd-mono">Page {page} / {pages} · {total} brands</span>
          <button type="button" className="q-btn q-btn-gl" disabled={page >= pages || pending} onClick={() => setParams({ page: String(page + 1) })}>Older →</button>
        </nav>
      )}

      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />}
    </>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: ReadonlyArray<{ id: string; label: string }> }) {
  return (
    <label className="gd-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

// ─── Brand card ─────────────────────────────────────────────────────────────────────────────

interface CardProps {
  g: BrandGroup
  open: boolean
  onToggle: () => void
  capped: string[]
  isAgency: boolean
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onAction: (a: GridAction) => void
}

function BrandCard({ g, open, onToggle, capped, isAgency, selected, onSelect, onDelete, onAction }: CardProps) {
  const [shown, setShown] = useState(ITEMS_STEP)
  const store = !!g.id
  const state = g.meta.state
  const counts = countsLine(g, capped)
  const itemsId = `gd-items-${g.id ?? 'unassigned'}`
  const t = g.meta.theme

  return (
    <article className={`gd-brand q-card${open ? ' gd-open' : ''}${selected ? ' gd-selected' : ''}`} aria-label={g.name}>
      <div className="gd-brand-top">
        {/* Store preview: its own colours and logo / first product photo (config.design, data/products.ts). */}
        {store ? (
          <Link href={`/project/${g.id}`} className="gd-thumb" aria-hidden="true" tabIndex={-1}
            style={t ? { background: t.bg, color: t.text, borderColor: t.surface } : undefined}>
            <span className="gd-thumb-bar" style={t?.accent ? { background: t.accent } : undefined} />
            <span className="gd-thumb-name">{g.name}</span>
            {t?.image && <GridImage src={t.image} alt="" />}
            {!t?.image && g.items.find((i) => i.kind === 'product' && i.thumb) && (
              <GridImage src={g.items.find((i) => i.kind === 'product' && i.thumb)!.thumb!.src} alt="" />
            )}
          </Link>
        ) : (
          <div className="gd-thumb gd-thumb-none" aria-hidden="true"><span>∅</span></div>
        )}

        <div className="gd-brand-info">
          <div className="gd-brand-title">
            <h2>{store ? <Link href={`/project/${g.id}`}>{g.name}</Link> : g.name}</h2>
            {isAgency && store && (
              <label className="gd-check">
                <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${g.name} for export`} />
              </label>
            )}
          </div>
          <div className="gd-brand-meta">
            {store && state && <span className={`gd-badge gd-st-${state}`}>{STATE_LABEL[state]}</span>}
            {!store && <span className="gd-badge">Not linked to a store</span>}
            {g.meta.hosting && <span className="gd-badge gd-st-host">Hosting</span>}
            {g.lastActivity && <span className="gd-mono">{timeAgo(g.lastActivity)}</span>}
          </div>
          {g.meta.domain && (
            <a className="gd-domain gd-mono" href={`https://${g.meta.domain}`} target="_blank" rel="noopener noreferrer">{g.meta.domain} ↗</a>
          )}
          {counts.length > 0 && <p className="gd-counts">{counts.join(' · ')}</p>}
          {store && counts.length === 0 && <p className="gd-counts gd-quiet">No products, ads or imports yet</p>}
        </div>
      </div>

      <div className="gd-brand-actions">
        {store && <Link href={`/project/${g.id}`} className="q-btn">Open in Studio</Link>}
        {store && state === 'changes' && <Link href={`/project/${g.id}?tab=publish`} className="q-btn q-btn-gl">Publish…</Link>}
        {store && <Link href={`/project/${g.id}?tab=qgent`} className="q-btn q-btn-gl">Qgent check</Link>}
        {store && <Link href={`/project/${g.id}?tab=publish`} className="q-btn q-btn-gl">{state === 'draft' ? 'Go live / hosting' : 'Export & hosting'}</Link>}
        {g.items.length > 0 && (
          <button type="button" className="q-btn q-btn-gl" aria-expanded={open} aria-controls={itemsId} onClick={onToggle}>
            {open ? 'Hide items' : `Show ${g.items.length} item${g.items.length === 1 ? '' : 's'}`}
          </button>
        )}
        {store && <button type="button" className="gd-link gd-del" onClick={onDelete}>Delete</button>}
      </div>

      {open && g.items.length > 0 && (
        <div id={itemsId} className="gd-items">
          {g.items.slice(0, shown).map((it) => <ItemCard key={it.id} it={it} onAction={onAction} />)}
          {g.items.length > shown && (
            <button type="button" className="q-btn q-btn-gl gd-more" onClick={() => setShown((n) => n + ITEMS_STEP)}>
              Show more ({g.items.length - shown})
            </button>
          )}
        </div>
      )}
    </article>
  )
}

// ─── Item card ──────────────────────────────────────────────────────────────────────────────

function ActionButton({ a, primary, onAction }: { a: GridAction; primary?: boolean; onAction: (a: GridAction) => void }) {
  const cls = primary ? 'q-btn gd-act' : 'gd-link'
  if (a.type === 'link') return <Link href={a.href!} className={cls}>{a.label}</Link>
  if (a.type === 'download') return <a href={a.href} className={cls} download rel="noopener">{a.label}</a>
  return <button type="button" className={cls} onClick={() => onAction(a)}>{a.label}</button>
}

function ItemCard({ it, onAction }: { it: GridItem; onAction: (a: GridAction) => void }) {
  return (
    <div className={`gd-item gd-k-${it.kind}`}>
      <div className="gd-item-thumb">
        {it.thumb?.type === 'video' ? <GridVideo src={it.thumb.src} label={it.title} />
          : it.thumb ? <GridImage src={it.thumb.src} alt="" />
          : <span className="gd-item-icon" aria-hidden="true">{KIND_ICON[it.kind]}</span>}
        <span className="gd-item-mod">{MODULE_LABEL[it.module]}</span>
      </div>
      <div className="gd-item-body">
        <p className="gd-item-title" title={it.title}>{it.title}</p>
        {it.subtitle && <p className="gd-item-sub">{it.subtitle}</p>}
        <p className="gd-item-status">
          <span className={`gd-dot gd-s-${it.status}`} aria-hidden="true" />{it.statusLabel}
          <span className="gd-mono"> · {timeAgo(it.updatedAt)}</span>
        </p>
        <div className="gd-item-actions">
          <ActionButton a={it.primaryAction} primary onAction={onAction} />
          {it.actions.map((a) => <ActionButton key={a.label} a={a} onAction={onAction} />)}
        </div>
      </div>
    </div>
  )
}
