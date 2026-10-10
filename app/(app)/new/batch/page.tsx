'use client'

// /new/batch — Agency batch generation: up to AGENCY_BATCH_SIZE stores from one list. Each store
// runs through the same generator as a single one (lib/generation/run.ts), a few at a time
// (lib/generation/batch.ts). ?b=<batchId> shows the batch's progress; the page polls it, which
// also keeps the queue moving where the server's own chain can't (previews).

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AGENCY_BATCH_CONCURRENCY, AGENCY_BATCH_SIZE, AGENCY_FAIR_USE } from '@/lib/config'
import { phaseToStatusText, type GenerationPhase } from '@/lib/generation-poll'

interface Row { name: string; brief: string }
interface Job {
  id: string
  name: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  phase: string | null
  projectId: string | null
  previewUrl: string | null
  error: string | null
  deployError: string | null
}

const EMPTY: Row = { name: '', brief: '' }
const POLL_MS = 4000

const label: React.CSSProperties = { fontSize: 10, fontFamily: 'var(--q-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--q-fg4)' }
const field: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--q-line2)',
  background: 'var(--q-bg)', color: 'var(--q-fg)', font: '400 14px/1.5 var(--q-sans)', outline: 'none',
}

export default function BatchPage() {
  // useSearchParams needs a Suspense boundary for the static shell.
  return <Suspense fallback={null}><BatchPageInner /></Suspense>
}

function BatchPageInner() {
  const params = useSearchParams()
  const batchId = params.get('b')
  const [plan, setPlan] = useState<'loading' | 'agency' | 'other'>('loading')

  useEffect(() => {
    let off = false
    fetch('/api/credits/balance')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { tier?: string } | null) => { if (!off) setPlan(d?.tier === 'agency' ? 'agency' : 'other') })
      .catch(() => { if (!off) setPlan('other') })
    return () => { off = true }
  }, [])

  return (
    <div className="q-page-wrap" style={{ maxWidth: 860 }}>
      <p className="ad-app-label" style={{ padding: '0 0 12px' }}>agency</p>
      <h1 className="q-h1">Batch generation</h1>
      <p style={{ margin: '12px 0 28px', fontSize: 14, lineHeight: 1.6, color: 'var(--q-fg3)', maxWidth: 620 }}>
        Up to {AGENCY_BATCH_SIZE} stores from one list. Every store goes through the same generator as a single one,
        {` ${AGENCY_BATCH_CONCURRENCY}`} at a time. Included in Agency — fair use {AGENCY_FAIR_USE.generationsPerDay} generations a day.
      </p>

      {plan === 'loading' ? null
        : plan === 'other' ? (
          <div className="q-card" style={{ padding: '22px 24px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--q-fg)' }}>Batch generation is part of the Agency plan.</p>
            <Link href="/billing#agency" className="q-btn">See Agency in Billing</Link>
          </div>
        )
          : batchId ? <Progress batchId={batchId} />
            : <BatchForm />}
    </div>
  )
}

function BatchForm() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }])
  const [paste, setPaste] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const filled = rows.filter((r) => r.brief.trim())
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  // One store per paragraph (blank line between stores), appended after the filled rows.
  const splitPaste = () => {
    const blocks = (paste ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
    const next = [...rows.filter((r) => r.brief.trim() || r.name.trim()), ...blocks.map((brief) => ({ name: '', brief }))]
    setRows((next.length ? next : [{ ...EMPTY }]).slice(0, AGENCY_BATCH_SIZE))
    setPaste(null)
  }

  const submit = async () => {
    if (submitting || !filled.length) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/quante/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: filled.map((r) => ({ name: r.name.trim(), brief: r.brief.trim() })) }),
      })
      const data = (await res.json().catch(() => ({}))) as { batchId?: string; error?: string }
      if (!res.ok || !data.batchId) {
        setError(data.error ?? 'Could not start the batch. Please try again.')
        setSubmitting(false)
        return
      }
      router.replace(`/new/batch?b=${data.batchId}`)
    } catch {
      setError('Could not start the batch. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r, i) => (
        <div key={i} className="q-card" style={{ padding: '16px 18px', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={label}>Store {i + 1}</span>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="q-tap"
                style={{ background: 'none', border: 0, color: 'var(--q-fg3)', fontSize: 12, cursor: 'pointer' }}>
                Remove
              </button>
            )}
          </div>
          <input aria-label={`Store ${i + 1} name`} placeholder="Store name (optional)" maxLength={100} value={r.name}
            onChange={(e) => set(i, { name: e.currentTarget.value })} style={field} />
          <textarea aria-label={`Store ${i + 1} brief`} placeholder="What it sells, for whom, the look and tone, language and currency…"
            rows={3} maxLength={20000} value={r.brief} onChange={(e) => set(i, { brief: e.currentTarget.value })}
            style={{ ...field, resize: 'vertical', minHeight: 84 }} />
        </div>
      ))}

      {paste !== null && (
        <div className="q-card" style={{ padding: '16px 18px', display: 'grid', gap: 10 }}>
          <span style={label}>Paste a list — one store per paragraph, a blank line between stores</span>
          <textarea aria-label="List of store briefs" rows={8} value={paste} onChange={(e) => setPaste(e.currentTarget.value)}
            style={{ ...field, resize: 'vertical' }} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="q-btn" onClick={splitPaste}>Add as stores</button>
            <button type="button" className="q-btn q-btn-gl" onClick={() => setPaste(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="q-btn q-btn-gl" disabled={rows.length >= AGENCY_BATCH_SIZE}
          onClick={() => setRows((rs) => [...rs, { ...EMPTY }])}>
          + Add store
        </button>
        {paste === null && (
          <button type="button" className="q-btn q-btn-gl" onClick={() => setPaste('')}>Paste a list</button>
        )}
      </div>

      <div className="q-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--q-fg3)' }}>
          <b style={{ color: 'var(--q-fg)', fontFamily: 'var(--q-mono)' }}>{filled.length} / {AGENCY_BATCH_SIZE}</b> stores ready to generate
        </span>
        <button type="button" className="q-btn" disabled={!filled.length || submitting} onClick={submit}
          style={!filled.length || submitting ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
          {submitting ? 'Starting…' : `Generate ${filled.length || ''} store${filled.length === 1 ? '' : 's'}`}
        </button>
      </div>
      <div aria-live="polite">{error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--q-danger-text)' }}>{error}</p>}</div>
    </div>
  )
}

function statusOf(j: Job): { text: string; tone: string } {
  if (j.status === 'queued') return { text: 'Waiting', tone: 'var(--q-fg4)' }
  if (j.status === 'running') return { text: phaseToStatusText((j.phase ?? 'designing') as GenerationPhase), tone: 'var(--q-acc-text)' }
  if (j.status === 'failed') return { text: 'Failed', tone: 'var(--q-danger-text)' }
  return { text: j.deployError ? 'Generated — preview build failed' : 'Generated', tone: j.deployError ? 'var(--q-warn-text)' : 'var(--q-ok-text)' }
}

function Progress({ batchId }: { batchId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/quante/batch/${batchId}`, { cache: 'no-store' })
    const data = (await res.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
    if (!res.ok || !data.jobs) { setError(data.error ?? 'Could not load the batch.'); return false }
    setJobs(data.jobs)
    return data.jobs.some((j) => j.status === 'queued' || j.status === 'running')
  }, [batchId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let off = false
    const tick = async () => {
      const more = await load().catch(() => true)
      if (!off && more) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => { off = true; if (timer) clearTimeout(timer) }
  }, [load])

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, completed: 0, failed: 0 }
    for (const j of jobs ?? []) c[j.status]++
    return c
  }, [jobs])

  if (error) return <p role="alert" style={{ fontSize: 14, color: 'var(--q-danger-text)' }}>{error}</p>
  if (!jobs) return <p style={{ fontSize: 14, color: 'var(--q-fg3)' }}>Loading the batch…</p>
  const done = counts.queued + counts.running === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="q-card" style={{ padding: '16px 18px' }} aria-live="polite">
        <p style={{ margin: 0, fontSize: 14, color: 'var(--q-fg)' }}>
          <b style={{ fontFamily: 'var(--q-mono)' }}>{counts.completed} / {jobs.length}</b> generated
          {counts.running > 0 && <> · {counts.running} in progress</>}
          {counts.queued > 0 && <> · {counts.queued} waiting</>}
          {counts.failed > 0 && <> · <span style={{ color: 'var(--q-danger-text)' }}>{counts.failed} failed</span></>}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--q-fg3)' }}>
          {done
            ? 'The batch is finished. Open a store in the Studio to check its build and keep editing.'
            : 'You can leave this page — the batch keeps going and the stores appear on your dashboard as they are generated.'}
        </p>
      </div>

      {jobs.map((j, i) => {
        const s = statusOf(j)
        return (
          <div key={j.id} className="q-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--q-fg)' }}>{j.name || `Store ${i + 1}`}</p>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: s.tone }}>{s.text}</p>
              {j.status === 'failed' && j.error && <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--q-fg3)', maxWidth: 560 }}>{j.error}</p>}
            </div>
            {j.projectId && (
              <div style={{ display: 'flex', gap: 8 }}>
                {j.previewUrl && <a href={j.previewUrl} target="_blank" rel="noopener noreferrer" className="q-btn q-btn-gl">Preview ↗</a>}
                <Link href={`/project/${j.projectId}`} className="q-btn">Open in Studio</Link>
              </div>
            )}
          </div>
        )
      })}

      {done && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/new/batch" className="q-btn q-btn-gl">Start another batch</Link>
          <Link href="/dashboard" className="q-btn q-btn-gl">Dashboard</Link>
        </div>
      )}
    </div>
  )
}
