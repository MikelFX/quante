'use client'

// Admin → Store updates: the automatic store scaffold rollout
// (/api/admin/scaffold-rollout, lib/hosting/scaffold-rollout.ts). Preview (dry run)
// first, then update. The daily cron (/api/cron/scaffold-rollout) does the same in
// batches of 15.

import { useCallback, useEffect, useState } from 'react'

const mono = 'var(--font-geist-mono)'

interface Counts { scanned: number; upToDate: number; outdated: number; building: number; failed: number; skipped: number }

interface StoreRow {
  projectId: string
  name: string | null
  ownerId: string
  liveVersion: number | null
  attempts: number
  lastError: string | null
  skipReason?: string
}

interface ResultRow {
  projectId: string
  status: 'started' | 'skipped' | 'failed'
  reason?: string
  error?: string
  deploymentId?: string
  url?: string
  droppedFiles?: Array<{ path: string; reason: string }>
}

const btn = (primary: boolean, disabled: boolean): React.CSSProperties => ({
  background: primary ? '#f4f4f6' : 'none',
  color: primary ? '#0a0a0e' : '#8a8a93',
  border: primary ? 'none' : '1px solid rgba(255,255,255,.12)',
  borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: primary ? 600 : 500,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
})

const cell: React.CSSProperties = {
  fontSize: 11.5, fontFamily: mono, color: '#8a8a93',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

export function StoreUpdatesAdmin() {
  const [scaffoldVersion, setScaffoldVersion] = useState<number | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [partial, setPartial] = useState(false)
  const [migrationPending, setMigrationPending] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [busy, setBusy] = useState<null | 'preview' | 'update'>(null)
  const [preview, setPreview] = useState<{ stores: StoreRow[]; skipped: StoreRow[]; more: boolean } | null>(null)
  const [results, setResults] = useState<ResultRow[] | null>(null)
  // Stores the update run did not reach (its time budget ran out) — run again for them.
  const [notStarted, setNotStarted] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(10)

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const res = await fetch('/api/admin/scaffold-rollout')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? `Summary failed (${res.status})`); return }
      setScaffoldVersion(data.scaffoldVersion ?? null)
      setCounts(data.counts ?? null)
      setPartial(!!data.partial)
      setMigrationPending(!!data.migrationPending)
    } catch {
      setError('Summary request failed.')
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  useEffect(() => { void loadSummary() }, [loadSummary])

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'update')
    setError(null)
    if (!dryRun) { setResults(null); setNotStarted([]) }
    try {
      // Update exactly the stores the dry run listed (what you saw is what gets deployed).
      const projectIds = !dryRun && preview ? preview.stores.slice(0, limit).map((s) => s.projectId) : undefined
      const res = await fetch('/api/admin/scaffold-rollout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, limit, ...(projectIds ? { projectIds } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? `Request failed (${res.status})`); return }
      if (data.migrationPending) setMigrationPending(true)
      if (dryRun) {
        setPreview({ stores: data.stores ?? [], skipped: data.skipped ?? [], more: !!data.more })
      } else {
        setResults(data.results ?? [])
        setNotStarted(Array.isArray(data.notStarted) ? data.notStarted : [])
        setPreview(null)
        void loadSummary()
      }
    } catch {
      setError('Request failed.')
    } finally {
      setBusy(null)
    }
  }

  const statBox = (label: string, value: number | undefined, color = '#f4f4f6') => (
    <div key={label} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <p style={{ fontSize: 10, fontFamily: mono, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontFamily: mono, color, margin: '4px 0 0' }}>{value ?? '—'}</p>
    </div>
  )

  const storeTable = (rows: StoreRow[], showReason: boolean) => (
    <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflowX: 'auto' }}>
      <div style={{ minWidth: 560 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.4fr .6fr .6fr 1.6fr', gap: 10, padding: '7px 14px', background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          {['Store', 'Owner', 'Live v', 'Tries', showReason ? 'Skipped because' : 'Last error'].map((h) => (
            <p key={h} style={{ fontSize: 10, fontFamily: mono, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: 0 }}>{h}</p>
          ))}
        </div>
        {rows.map((s, i) => (
          <div key={s.projectId} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.4fr .6fr .6fr 1.6fr', gap: 10, padding: '9px 14px', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
            <span style={{ ...cell, color: '#f4f4f6' }} title={s.projectId}>{s.name ?? s.projectId}</span>
            <span style={cell} title={s.ownerId}>{s.ownerId}</span>
            <span style={cell}>{s.liveVersion ?? '—'}</span>
            <span style={cell}>{s.attempts}</span>
            <span style={{ ...cell, color: showReason ? '#e0a04f' : s.lastError ? '#f87171' : '#5b5b64' }} title={s.lastError ?? undefined}>
              {showReason ? (s.skipReason ?? '—') : (s.lastError ?? '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <section style={{ marginTop: '3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', margin: 0 }}>
          Store updates
          {scaffoldVersion !== null && (
            <span style={{ fontFamily: mono, fontSize: 11, color: '#5b5b64', marginLeft: 8 }}>scaffold v{scaffoldVersion}</span>
          )}
        </h2>
        <button onClick={() => void loadSummary()} disabled={loadingSummary} style={btn(false, loadingSummary)}>
          {loadingSummary ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 12.5, color: '#8a8a93', lineHeight: 1.55, margin: 0 }}>
          Rebuilds each live store&apos;s <em>currently live</em> version with the latest platform scaffold (free, unpublished edits stay unpublished).
          A failed build leaves the previous deployment live. The daily cron updates up to 15 stores per run; stores that failed 3 times are skipped until retried here.
        </p>

        {migrationPending && (
          <p style={{ fontSize: 12, color: '#e0a04f', margin: 0 }}>
            Run supabase/migration-scaffold-version.sql first — store updates are disabled until it has run.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {statBox('Up to date', counts?.upToDate, '#3ecf8e')}
          {statBox('Outdated', counts?.outdated, counts && counts.outdated > 0 ? '#e0a04f' : '#f4f4f6')}
          {statBox('Building', counts?.building)}
          {statBox('Failed', counts?.failed, counts && counts.failed > 0 ? '#f87171' : '#f4f4f6')}
          {statBox('Skipped', counts?.skipped)}
        </div>
        <p style={{ fontSize: 11.5, color: '#5b5b64', margin: 0 }}>
          Quick database-only summary (unpolled builds are not re-checked) — the dry run does the full check.
          {partial && ' Summary hit its time budget — counts are partial.'}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#8a8a93', display: 'flex', alignItems: 'center', gap: 6 }}>
            Batch size
            <input
              type="number" min={1} max={25} value={limit}
              onChange={(e) => setLimit(Math.min(25, Math.max(1, Number(e.target.value) || 1)))}
              style={{ width: 64, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, color: '#f4f4f6', outline: 'none' }}
            />
          </label>
          <button onClick={() => void run(true)} disabled={busy !== null || migrationPending} style={btn(false, busy !== null || migrationPending)}>
            {busy === 'preview' ? 'Checking…' : 'Preview (dry run)'}
          </button>
          <button
            onClick={() => void run(false)}
            disabled={busy !== null || migrationPending || !preview || preview.stores.length === 0}
            style={btn(true, busy !== null || migrationPending || !preview || preview.stores.length === 0)}
            title={!preview ? 'Run a dry run first' : undefined}
          >
            {busy === 'update' ? 'Updating…' : `Update ${preview ? Math.min(preview.stores.length, limit) : 0} stores`}
          </button>
        </div>

        {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}

        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>
              {preview.stores.length === 0 ? 'No outdated stores to update.' : `${preview.stores.length} store${preview.stores.length !== 1 ? 's' : ''} would be updated${preview.more ? ' (more after this batch)' : ''}:`}
            </p>
            {preview.stores.length > 0 && storeTable(preview.stores, false)}
            {preview.skipped.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: '#8a8a93', margin: '6px 0 0' }}>Skipped:</p>
                {storeTable(preview.skipped, true)}
              </>
            )}
          </div>
        )}

        {results && (
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflowX: 'auto' }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 2.6fr', gap: 10, padding: '7px 14px', background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                {['Project', 'Result', 'Details'].map((h) => (
                  <p key={h} style={{ fontSize: 10, fontFamily: mono, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: 0 }}>{h}</p>
                ))}
              </div>
              {results.length === 0 && notStarted.length === 0 && <p style={{ fontSize: 12, color: '#5b5b64', padding: '10px 14px', margin: 0 }}>Nothing was updated.</p>}
              {results.map((r, i) => {
                const color = r.status === 'started' ? '#3ecf8e' : r.status === 'failed' ? '#f87171' : '#e0a04f'
                const details = r.status === 'started'
                  ? `${r.deploymentId ?? ''}${r.droppedFiles && r.droppedFiles.length > 0 ? ` — dropped: ${r.droppedFiles.map((d) => d.path).join(', ')}` : ''}`
                  : (r.error ?? r.reason ?? '')
                return (
                  <div key={r.projectId} style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 2.6fr', gap: 10, padding: '9px 14px', borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                    <span style={cell} title={r.projectId}>{r.projectId}</span>
                    <span style={{ ...cell, color, fontWeight: 600, textTransform: 'uppercase' }}>{r.status}</span>
                    <span style={{ ...cell, whiteSpace: 'normal', wordBreak: 'break-word' }}>{details}</span>
                  </div>
                )
              })}
              {notStarted.map((id) => (
                <div key={`ns-${id}`} style={{ display: 'grid', gridTemplateColumns: '1.6fr .8fr 2.6fr', gap: 10, padding: '9px 14px', borderTop: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={cell} title={id}>{id}</span>
                  <span style={{ ...cell, color: '#5b5b64', fontWeight: 600, textTransform: 'uppercase' }}>not started</span>
                  <span style={{ ...cell, whiteSpace: 'normal' }}>Time budget ran out before this store — run the update again.</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
