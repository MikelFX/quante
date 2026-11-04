'use client'

// /qgent — Qgent's 20 agents on a store, live. One address field and two ways to use them:
//   Review: the agents go through the page (POST /api/qgent/swarm, NDJSON) and every finding
//           waits for the merchant's Accept / Reject. Nothing on the old site changes.
//   Build:  the agents build a new Quante store from the old one in front of the merchant — the
//           Qscan scan (POST /api/qscan) + a normal generation (POST /api/quante/generate) with the
//           accepted findings added to the brief; the stage follows the files as they are written.
// Accept / Reject live in the browser and only shape the rebuild and the copied checklist. The Studio's Qgent panel (code fixes as diffs) is unchanged.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { ArrowRight, Check, ClipboardCopy, Globe, Hammer, Loader2, RotateCcw, ScanSearch, X } from 'lucide-react'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { ParticleMode } from '@ad/ui/particles'
import { CREDIT_COSTS } from '@/lib/config'
import { SWARM_AGENTS, agentIndex } from '@/lib/qgent/swarm/agents'
import { acceptedBrief, type SwarmFinding } from '@/lib/qgent/swarm/model'
import { buildProjectUrl, decidePollAction, isJobStuck, phaseToStatusText, type JobStatusPayload } from '@/lib/generation-poll'
import { SwarmStage, type StagePage } from './SwarmStage'
import { BuildStage, type BuildInfo } from './BuildStage'
import { AgentDot } from './AgentCursor'
import '../qads/qads.css'
import '../qscan/qscan.css'
import './qgent.css'

type Mode = 'review' | 'build'
type Phase = 'idle' | 'reviewing' | 'reviewed' | 'reading' | 'building' | 'built'
type Decision = 'yes' | 'no'

const DRAFT_KEY = 'qgent:swarm:url:v1'
const BRIEF_LIMIT = 19_900

const SEVERITY: Record<SwarmFinding['severity'], string> = { high: 'Important', medium: 'Worth fixing', low: 'Polish' }

function price(n: number | null, currency: string | null) {
  if (n === null) return ''
  const v = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)
  return currency ? `${v} ${currency}` : v
}

export function QgentSwarmClient() {
  const { isSignedIn, isLoaded } = useUser()
  const [mode, setMode] = useState<Mode>('review')
  const [url, setUrl] = useState('')
  const [rights, setRights] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [needsCredits, setNeedsCredits] = useState(false)
  const [agency, setAgency] = useState(false)

  // review
  const [page, setPage] = useState<StagePage | null>(null)
  const [findings, setFindings] = useState<SwarmFinding[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [streamDone, setStreamDone] = useState(false)
  const [summary, setSummary] = useState('')
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'yes'>('all')
  const [copied, setCopied] = useState(false)

  // build
  const [info, setInfo] = useState<BuildInfo | null>(null)
  const [filesDone, setFilesDone] = useState<string[]>([])
  const [writing, setWriting] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [built, setBuilt] = useState<{ studioUrl: string; previewUrl: string | null } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  const builtRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    void fetch('/api/credits/balance').then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.tier === 'agency') setAgency(true) }).catch(() => {})
  }, [isSignedIn])

  // address typed before sign-in, or ?url= / ?mode=build from a link
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const q = new URLSearchParams(window.location.search)
        const draft = sessionStorage.getItem(DRAFT_KEY)
        if (draft) { setUrl(draft); sessionStorage.removeItem(DRAFT_KEY) } else if (q.get('url')) setUrl(q.get('url')!.slice(0, 2048))
        if (q.get('mode') === 'build') setMode('build')
      } catch {}
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const accepted = useMemo(() => findings.filter((f) => decisions[f.id] === 'yes'), [findings, decisions])
  const shown = useMemo(() => findings.filter((f) => revealed.has(f.id)), [findings, revealed])
  const listed = shown.filter((f) => (filter === 'open' ? !decisions[f.id] : filter === 'yes' ? decisions[f.id] === 'yes' : true))
  const busy = phase === 'reviewing' || phase === 'reading' || phase === 'building'

  const onReveal = useCallback((id: string) => setRevealed((r) => (r.has(id) ? r : new Set(r).add(id))), [])
  const toStage = () => requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const signIn = () => {
    try { sessionStorage.setItem(DRAFT_KEY, url) } catch {}
    window.location.href = `/login?redirect_url=${encodeURIComponent(`/qgent${mode === 'build' ? '?mode=build' : ''}`)}`
  }

  function guard(): boolean {
    if (!url.trim() || busy) return false
    if (isLoaded && !isSignedIn) { signIn(); return false }
    if (!rights) { setError('Tick the box first: the store is yours, or you may use its content.'); return false }
    setError(null)
    setNeedsCredits(false)
    return true
  }

  async function review(e?: FormEvent) {
    e?.preventDefault()
    if (!guard()) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPage(null); setFindings([]); setRevealed(new Set()); setStreamDone(false); setSummary(''); setReviewNote(null)
    setSelected(null); setBuilt(null); setInfo(null)
    setPhase('reviewing')
    setStatusText('Scanning page…')
    toStage()
    try {
      const res = await fetch('/api/qgent/swarm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, rights }), signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? 'The agents could not start. Please try again.')
        setNeedsCredits(res.status === 402)
        setPhase('idle')
        return
      }
      setDecisions({})
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const handle = (ev: Record<string, unknown>) => {
        if (ev.t === 'page') {
          setPage({ url: String(ev.url), layers: ev.layers as StagePage['layers'], total: Number(ev.total) || 0, product: (ev.product as StagePage['product']) ?? null })
          setStatusText('Agents at work…')
        } else if (ev.t === 'finding') {
          const f = ev.finding as SwarmFinding
          setFindings((list) => [...list, f])
        } else if (ev.t === 'done') {
          setSummary(String(ev.summary ?? ''))
          if (ev.aiError) setReviewNote(String(ev.aiError))
          setStatusText(`${Number(ev.findings) || 0} findings`)
        }
      }
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) { try { handle(JSON.parse(line)) } catch {} }
        }
      }
      setStreamDone(true)
      setPhase('reviewed')
    } catch {
      if (!ctrl.signal.aborted) {
        setError('The connection dropped. The findings so far stay here.')
        setStreamDone(true)
        setPhase('reviewed')
      }
    }
  }

  async function build(e?: FormEvent) {
    e?.preventDefault()
    if (!guard()) return
    setBuilt(null); setInfo(null); setFilesDone([]); setWriting(null)
    setPhase('reading')
    setStatusText('Reading your old store…')
    toStage()
    try {
      const res = await fetch('/api/qscan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: page?.url ?? url, rights }) })
      const scan = await res.json().catch(() => null)
      if (!res.ok || !scan?.summary) {
        setError(scan?.error ?? 'The old store could not be read. Please try again.')
        setPhase(page ? 'reviewed' : 'idle')
        return
      }
      const s = scan.summary as { brand: { name: string; tagline: string }; colors: string[]; productsPreview: Array<{ name: string; price: number | null; currency: string | null; image: string | null }> }
      setInfo({
        brand: s.brand.name,
        tagline: s.brand.tagline,
        colors: s.colors ?? [],
        products: (s.productsPreview ?? []).map((p) => ({ name: p.name, price: price(p.price, p.currency), image: p.image })),
      })
      setPhase('building')
      setStatusText('Designing your new store…')
      const extra = acceptedBrief(accepted, Math.max(0, Math.min(2_400, BRIEF_LIMIT - String(scan.brief).length)))
      const gen = await fetch('/api/quante/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: String(scan.brief) + (extra ? `\n${extra}` : ''), projectName: scan.projectName }),
      })
      const g = await gen.json().catch(() => null)
      if (!gen.ok || !g?.jobId) {
        setError(g?.code === 'billing_hold' ? 'Your account is on a billing hold, so credits can’t be spent right now.' : g?.error ?? 'Could not start building. Please try again.')
        setNeedsCredits(gen.status === 402)
        setPhase(page ? 'reviewed' : 'idle')
        setInfo(null)
        return
      }
      await poll(g.jobId as string, scan.scanId as string)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPhase(page ? 'reviewed' : 'idle')
    }
  }

  async function poll(jobId: string, scanId: string) {
    const startedAt = performance.now()
    while (true) {
      await new Promise((r) => setTimeout(r, 2500))
      let payload: JobStatusPayload & { filesDone?: string[]; writing?: string | null }
      try {
        const r = await fetch(`/api/quante/generate/status?jobId=${jobId}`)
        if (!r.ok) continue
        payload = await r.json()
      } catch {
        continue
      }
      if (Array.isArray(payload.filesDone)) setFilesDone((prev) => (payload.filesDone!.length >= prev.length ? payload.filesDone! : prev))
      setWriting(payload.writing ?? null)
      setStatusText(phaseToStatusText(payload.phase))
      const decision = decidePollAction(payload)
      if (decision.action === 'navigate') {
        void fetch(`/api/qscan/${scanId}/project`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: decision.projectId }) }).catch(() => {})
        setWriting(null)
        setBuilt({ studioUrl: buildProjectUrl(decision.projectId, decision.deploymentId, decision.codeVersionId, payload.previewUrl, decision.deployError), previewUrl: payload.previewUrl })
        setPhase('built')
        requestAnimationFrame(() => builtRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        return
      }
      if (decision.action === 'error') {
        setError(decision.message)
        setPhase(page ? 'reviewed' : 'idle')
        return
      }
      if (isJobStuck(0, performance.now() - startedAt)) {
        setError('Building took too long. Check your dashboard — the store may have been saved there.')
        setPhase(page ? 'reviewed' : 'idle')
        return
      }
    }
  }

  const decide = (id: string, d: Decision) => setDecisions((cur) => {
    const n = { ...cur }
    if (n[id] === d) delete n[id]
    else n[id] = d
    return n
  })

  const select = (id: string) => {
    setSelected(id)
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-fid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  async function copyChecklist() {
    const name = new Map(SWARM_AGENTS.map((a) => [a.id, a.role]))
    const text = [`Qgent — ${page?.url ?? url}`, '', ...accepted.map((f) => `- [ ] ${f.title} (${name.get(f.agent)})${f.after ? `\n      ${f.before ? `"${f.before}" → ` : ''}"${f.after}"` : ''}`)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const reset = () => {
    abortRef.current?.abort()
    setPhase('idle'); setPage(null); setFindings([]); setRevealed(new Set()); setInfo(null); setBuilt(null); setError(null)
  }

  const reviewCost = agency ? 'included' : `${CREDIT_COSTS.qgent_swarm} cr`
  const buildCost = agency ? 'included' : `${CREDIT_COSTS.generate} cr`
  const showBuild = phase === 'reading' || phase === 'building' || phase === 'built'
  const showReview = !showBuild && (phase === 'reviewing' || phase === 'reviewed')

  return (
    <div className="qnt-public qp-dark qz qs qg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ParticleMode mode="site" />
      <PublicNav />

      <main style={{ flex: 1, padding: '0 1.25rem', width: '100%' }}>
        <header className="qz-hero">
          <p className="qg-kicker"><span className="qg-dots" aria-hidden="true">{SWARM_AGENTS.slice(0, 6).map((a, i) => <AgentDot key={a.id} index={i} />)}</span>Qgent × 20 agents</p>
          <h1 className="qz-h1">Twenty agents. <em>One store.</em></h1>
          <p className="qz-sub qs-sub">
            Paste your e-shop’s address. Twenty specialist agents go through it live and show what they would change — you
            keep what you want. Or let them build you a new store from the old one, right in front of you.
          </p>
        </header>

        <form className="qz-box qs-box" onSubmit={(e) => void (mode === 'review' ? review(e) : build(e))} aria-label="Send the agents">
          <div className="qg-modes" role="radiogroup" aria-label="What should the agents do">
            <button type="button" role="radio" aria-checked={mode === 'review'} onClick={() => setMode('review')} disabled={busy}>
              <ScanSearch aria-hidden="true" />Review my store
            </button>
            <button type="button" role="radio" aria-checked={mode === 'build'} onClick={() => setMode('build')} disabled={busy}>
              <Hammer aria-hidden="true" />Build a new one from it
            </button>
          </div>
          <div className="qs-field">
            <Globe className="qs-globe" aria-hidden="true" />
            <label htmlFor="qg-url" className="vh">Store address</label>
            <input
              id="qg-url" className="qs-input" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellCheck={false}
              placeholder="yourstore.com" value={url} maxLength={2048} disabled={busy}
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <button type="submit" className="qz-go qs-go" disabled={!url.trim() || busy}>
              {busy ? (phase === 'reviewing' ? 'Reviewing…' : 'Building…') : mode === 'review' ? 'Send the agents' : 'Build it'}
              <span className="cr">{mode === 'review' ? reviewCost : buildCost}</span>
              <span className="ar">{busy ? <Loader2 className="qs-spin" /> : <ArrowRight />}</span>
            </button>
          </div>
          <label className="qs-rights">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.currentTarget.checked)} />
            <span>The store is mine, or I have the right to use its content.</span>
          </label>
        </form>

        <p className="qz-under">
          {mode === 'review'
            ? 'Nothing on your site changes. You decide on every suggestion.'
            : 'A normal Quante generation from a Qscan of your store — usually 2–4 minutes.'}
          {isLoaded && !isSignedIn ? ' Sign in to start.' : ''}
        </p>
        {error && (
          <p className="qz-err" role="alert">{error}{needsCredits && <> · <Link href="/billing">Top up credits</Link></>}</p>
        )}

        <section ref={stageRef} className="qg-wrap" aria-label="The agents at work">
          {showReview && (
            <div className="qg-split">
              <SwarmStage
                page={page} findings={findings} revealed={revealed} onReveal={onReveal} streamDone={streamDone}
                selected={selected} onSelect={select} decisions={decisions} statusText={statusText}
              />
              <aside className="qg-panel" aria-label="Findings">
                <header className="qg-panel-h">
                  <h2>Findings <span>{shown.length}</span></h2>
                  <div className="qg-filter" role="tablist" aria-label="Show">
                    {(['all', 'open', 'yes'] as const).map((k) => (
                      <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                        {k === 'all' ? 'All' : k === 'open' ? 'To decide' : `Accepted ${accepted.length}`}
                      </button>
                    ))}
                  </div>
                </header>
                {summary && <p className="qg-summary">{summary}</p>}
                {reviewNote && <p className="qg-note">{reviewNote}</p>}
                <ol className="qg-list" ref={listRef}>
                  {listed.map((f) => {
                    const i = agentIndex(f.agent)
                    const a = SWARM_AGENTS[i]
                    const d = decisions[f.id]
                    return (
                      <li key={f.id} data-fid={f.id} data-dec={d} data-sel={selected === f.id ? '' : undefined}>
                        <button type="button" className="qg-f-h" onClick={() => setSelected(f.id)}>
                          <AgentDot index={i} />
                          <b>{a?.name}</b><span>{a?.role}</span>
                          <em data-sev={f.severity}>{SEVERITY[f.severity]}</em>
                        </button>
                        <p className="qg-f-t">{f.title}</p>
                        {f.why && <p className="qg-f-w">{f.why}</p>}
                        {(f.before || f.after) && (
                          <div className="qg-diff">
                            {f.before && <del>{f.before}</del>}
                            {f.after && <ins>{f.after}</ins>}
                          </div>
                        )}
                        <div className="qg-f-a">
                          <button type="button" className="qg-yes" aria-pressed={d === 'yes'} onClick={() => decide(f.id, 'yes')}><Check aria-hidden="true" />{d === 'yes' ? 'Accepted' : 'Accept'}</button>
                          <button type="button" className="qg-no" aria-pressed={d === 'no'} onClick={() => decide(f.id, 'no')}><X aria-hidden="true" />{d === 'no' ? 'Rejected' : 'Reject'}</button>
                        </div>
                      </li>
                    )
                  })}
                  {!listed.length && (
                    <li className="qg-empty">{phase === 'reviewing' ? 'The agents are reading the page — findings appear here as they reach them.' : filter === 'all' ? 'Nothing to report.' : 'Nothing here yet.'}</li>
                  )}
                </ol>
                {phase === 'reviewed' && (
                  <footer className="qg-panel-f">
                    <p>{accepted.length ? `${accepted.length} accepted change${accepted.length === 1 ? '' : 's'}.` : 'Accept the changes you want.'} Take them as a checklist for your current platform, or let the agents build a new store with them.</p>
                    <div className="qg-row-b">
                      <button type="button" className="qz-b" disabled={!accepted.length} onClick={() => void copyChecklist()}><ClipboardCopy aria-hidden="true" />{copied ? 'Copied' : 'Copy checklist'}</button>
                      <button type="button" className="qz-go" onClick={() => { setMode('build'); void build() }}>
                        Build a new store{accepted.length ? ' with them' : ''}<span className="cr">{buildCost}</span><span className="ar"><Hammer /></span>
                      </button>
                    </div>
                  </footer>
                )}
              </aside>
            </div>
          )}

          {showBuild && (
            <>
              <BuildStage info={info} filesDone={filesDone} writing={writing} finished={phase === 'built'} statusText={statusText} accepted={accepted.length} />
              {phase === 'built' && built && (
                <article className="qs-card qs-done qg-built" ref={builtRef}>
                  <p className="qs-k">Ready</p>
                  <h2>Your new store is built.</h2>
                  <p className="qs-lead">
                    It’s a regular Quante store{accepted.length ? `, with your ${accepted.length} accepted changes` : ''}. Keep shaping it in the Studio, then publish, host it with us or take the code.
                    {built.previewUrl && <> <a href={built.previewUrl} target="_blank" rel="noopener noreferrer">Open the preview</a>.</>}
                  </p>
                  <div className="qg-row-b qg-center">
                    <Link href={built.studioUrl} className="qz-go">Open in Studio <span className="ar"><ArrowRight /></span></Link>
                    <button type="button" className="qz-b" onClick={reset}><RotateCcw aria-hidden="true" />Start over</button>
                  </div>
                </article>
              )}
            </>
          )}

          {phase === 'idle' && (
            <ul className="qg-roster" aria-label="The agents">
              {SWARM_AGENTS.map((a, i) => (
                <li key={a.id}><AgentDot index={i} /><b>{a.name}</b><span>{a.role}</span></li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
