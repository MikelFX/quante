'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { decidePollAction, phaseToStatusText, isJobStuck, type JobStatusPayload } from '@/lib/generation-poll'

type Stage = 'chat' | 'ready' | 'generating'

interface Message {
  role: 'quante' | 'user'
  content: string
  streaming?: boolean
}

const OPENING = "Hey! I'm Quante. Tell me about your store — what are you selling, and who are your customers?"

// ── Level 2 reconnect: "a generation was running, then the page reloaded" ─────────────
// See docs/update-log.md. A marker is written to localStorage the moment handleGenerate()
// starts, updated with the generation_jobs id as soon as the POST /api/quante/generate
// response arrives (Level 3 — the jobId is now returned synchronously in the 202 response
// body, not streamed as a separate event), and removed on every terminal outcome reached
// *within the same page load* (success redirect, explicit error, or the polling loop's own
// stuck-job fallback). If none of those run — reload, browser/tab closed, device died — the
// marker survives, and the mount-time check below is what notices it next time this page
// loads. UPDATE (Level 3): when the marker has a jobId, the mount check now polls
// /api/quante/generate/status directly instead of only guessing from /api/projects'
// creation-time — precise and immediate, since generation runs independently of the client
// via Next.js after() and the job row is the actual source of truth.
const PENDING_KEY = 'quante:pending-generation'
// Comfortably above the 300s hard server cap (maxDuration) plus the client's own 290s
// give-up timer — a marker older than this is almost certainly abandoned, not worth
// prompting about, and is discarded silently rather than shown.
const PENDING_MAX_AGE_MS = 10 * 60_000

interface PendingGeneration {
  startedAt: number
  brief: string
  projectName: string
  jobId: string | null
}

function savePending(data: PendingGeneration) {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(data)) } catch {}
}

function loadPending(): PendingGeneration | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.startedAt !== 'number' || typeof parsed?.brief !== 'string') return null
    return parsed as PendingGeneration
  } catch {
    return null
  }
}

function clearPending() {
  try { window.localStorage.removeItem(PENDING_KEY) } catch {}
}

// Builds the /project/[id] redirect target used both by a fresh handleGenerate() completion
// and by the resume banner's "Open finished store" button — same query-param contract
// StudioClient.tsx's URL-bootstrap effect expects (did/vid/pu, see StudioClient.tsx).
//
// `deployError` (`de` query param): set when the follow-up preview deploy failed even
// though the generation itself succeeded. Without this, StudioClient would fall into
// the same "no did → no SSE → no watchdog → spinner forever" trap the earlier fix was
// meant to close. With it, Studio can render the "build failed" state immediately on
// mount instead of waiting for a stream that will never open.
function buildProjectUrl(
  projectId: string,
  deploymentId: string | null,
  codeVersionId: string | null,
  previewUrl: string | null,
  deployError: string | null = null
): string {
  const params = new URLSearchParams()
  if (deploymentId) params.set('did', deploymentId)
  if (codeVersionId) params.set('vid', codeVersionId)
  if (previewUrl) params.set('pu', previewUrl)
  if (deployError) params.set('de', deployError.slice(0, 500))
  const qs = params.toString()
  return `/project/${projectId}${qs ? `?${qs}` : ''}`
}

const STAGES = [
  { label: 'Analyzing brief', duration: 3000 },
  { label: 'Designing layout', duration: 5000 },
  { label: 'Writing components', duration: 8000 },
  { label: 'Styling & theming', duration: 6000 },
  { label: 'Wiring up cart & checkout', duration: 5000 },
  { label: 'Preparing deployment', duration: 4000 },
]

export default function NewProjectPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('chat')
  const [messages, setMessages] = useState<Message[]>([{ role: 'quante', content: OPENING }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [brief, setBrief] = useState('')
  const [projectName, setProjectName] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [codeChunks, setCodeChunks] = useState('')
  const [stageIndex, setStageIndex] = useState(0)

  // Level 2 — reconnect banner state. `resumePending` is the localStorage marker found on
  // mount (null once dismissed/resolved); `resumeFoundProjectId` is set once the mount-time
  // (or manual re-)check finds a matching project; `resumeChecking` drives the button's
  // loading state so a slow /api/projects call doesn't look like a dead click.
  const [resumePending, setResumePending] = useState<PendingGeneration | null>(null)
  const [resumeFoundProjectId, setResumeFoundProjectId] = useState<string | null>(null)
  const [resumeChecked, setResumeChecked] = useState(false)
  const [resumeChecking, setResumeChecking] = useState(false)
  // Level 3 — when the marker carries a jobId, the banner polls /api/quante/generate/status
  // directly instead of only guessing from /api/projects' creation timestamps. `resumeStatusText`
  // mirrors the live phase (same text handleGenerate's own polling loop shows); `resumeError`
  // is a terminal failure/stuck-job message, distinct from "still checking".
  const [resumeStatusText, setResumeStatusText] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [resumeDeploymentId, setResumeDeploymentId] = useState<string | null>(null)
  const [resumeVersionId, setResumeVersionId] = useState<string | null>(null)
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null)
  const [resumeDeployError, setResumeDeployError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Runs once on mount — deliberately independent of `stage` (a reload always starts back
  // at 'chat', regardless of what stage the user was in when the page went away).
  const checkForResumableProject = useCallback(async (pending: PendingGeneration) => {
    setResumeChecking(true)
    try {
      const r = await fetch('/api/projects')
      if (r.ok) {
        const data = await r.json()
        const projects: Array<{ id: string; created_at: string }> = data.projects ?? data ?? []
        // Precise on purpose: a project must have been created AFTER this specific
        // generation started (small clock-skew buffer), not just "recently" — we know the
        // exact start time from the marker, so there's no need for the coarser "last 6
        // minutes" window the give-up-timer fallback elsewhere in this file uses.
        const cutoff = pending.startedAt - 10_000
        const match = projects
          .filter(p => new Date(p.created_at).getTime() > cutoff)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        if (match) {
          setResumeFoundProjectId(match.id)
        }
      }
    } catch {
      // Leave resumeFoundProjectId null — banner falls back to "still checking / try again".
    } finally {
      setResumeChecking(false)
      setResumeChecked(true)
    }
  }, [])

  useEffect(() => {
    const pending = loadPending()
    if (!pending) return
    if (Date.now() - pending.startedAt > PENDING_MAX_AGE_MS) {
      clearPending()
      return
    }
    // Deliberately deferred to an effect rather than a useState lazy initializer: this page
    // is server-rendered once before hydration, `window.localStorage` doesn't exist there,
    // and a lazy initializer runs during that SSR pass too — reading it there would make the
    // client's first hydration render disagree with the server-rendered HTML (the banner
    // would pop in mismatched) instead of appearing cleanly right after mount, as it does here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResumePending(pending)
    // Level 3 — a marker with a jobId gets precise, live status via the polling effect below
    // instead of this coarser heuristic; only fall back to it when no jobId was captured
    // (e.g. the device died between calling handleGenerate() and the POST response arriving).
    if (!pending.jobId) checkForResumableProject(pending)
  }, [checkForResumableProject])

  // Level 3 — live-polls /api/quante/generate/status for a resumed job. Runs whenever there's
  // a pending marker with a jobId and no terminal outcome yet (found project / hard error).
  // Mirrors handleGenerate()'s own poll loop below, just driven by the marker instead of a
  // fresh POST response.
  useEffect(() => {
    if (!resumePending?.jobId || resumeFoundProjectId || resumeError) return
    const pending = resumePending
    const jobId = pending.jobId
    const createdAtMs = pending.startedAt
    let cancelled = false

    async function poll() {
      try {
        const r = await fetch(`/api/quante/generate/status?jobId=${jobId}`)
        if (!r.ok) {
          if (r.status === 404 && !cancelled) {
            // Job row itself is gone (very old marker, DB reset, etc.) — fall back to the
            // time-window heuristic rather than surfacing a scary error for something stale.
            checkForResumableProject(pending)
          }
          return
        }
        const payload: JobStatusPayload = await r.json()
        if (cancelled) return
        setResumeStatusText(phaseToStatusText(payload.phase))
        const decision = decidePollAction(payload)
        if (decision.action === 'navigate') {
          setResumeFoundProjectId(decision.projectId)
          setResumeDeploymentId(decision.deploymentId)
          setResumeVersionId(decision.codeVersionId)
          setResumePreviewUrl(payload.previewUrl)
          setResumeDeployError(decision.deployError)
        } else if (decision.action === 'error') {
          setResumeError(decision.message)
        } else if (isJobStuck(createdAtMs, Date.now())) {
          setResumeError('This generation seems to have stalled. Check your dashboard, or start a new one.')
        }
      } catch {
        // Network hiccup — the next tick will retry; no need to surface this as an error.
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [resumePending, resumeFoundProjectId, resumeError, checkForResumableProject])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, stage])

  useEffect(() => {
    if (stage === 'chat' && !thinking) inputRef.current?.focus()
  }, [stage, thinking])

  useEffect(() => {
    if (stage !== 'generating') return
    setStageIndex(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    let cumulative = 0
    for (let s = 0; s < STAGES.length - 1; s++) {
      cumulative += STAGES[s]!.duration
      const snap = s + 1
      timers.push(setTimeout(() => setStageIndex(snap), cumulative))
    }
    return () => timers.forEach(clearTimeout)
  }, [stage])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking || stage !== 'chat') return

    setInput('')
    setError('')

    const updated: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(updated)
    setThinking(true)

    // History sent to API: exclude hardcoded opening (messages[0]), start from first user message
    const history = updated.slice(1)
      .filter(m => m.content.trim())
      .map(m => ({
        role: m.role === 'quante' ? 'assistant' as const : 'user' as const,
        content: m.content,
      }))

    try {
      const abort = new AbortController()
      abortRef.current = abort

      const res = await fetch('/api/quante/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
        signal: abort.signal,
      })
      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()

      // Append empty streaming placeholder for Quante reply
      setMessages(prev => [...prev, { role: 'quante', content: '', streaming: true }])
      setThinking(false)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const raw = dec.decode(value, { stream: true })
        for (const line of raw.split('\n').filter(l => l.trim())) {
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'text_chunk') {
              setMessages(prev => {
                const last = prev[prev.length - 1]
                return [...prev.slice(0, -1), { ...last, content: last.content + evt.text }]
              })
            } else if (evt.type === 'ready') {
              // Finalize Quante's message (stop streaming cursor)
              setMessages(prev => {
                const last = prev[prev.length - 1]
                return [...prev.slice(0, -1), { ...last, streaming: false }]
              })
              setBrief(evt.brief)
              // Try to extract a project name from the brief
              const m = evt.brief.match(/^([A-Z][A-Za-z0-9\s&'.-]{1,28}?) (?:is |are |–|—)/)
              if (m) setProjectName(m[1].trim())
              setStage('ready')
            } else if (evt.type === 'error') {
              throw new Error(evt.message)
            }
          } catch { /* skip malformed JSON lines */ }
        }
      }

      // Stop streaming cursor if no <ready> was received
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }]
        return prev
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message || 'Something went wrong. Please try again.')
      setThinking(false)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'quante' && !last.content) return prev.slice(0, -1)
        return prev
      })
    }
  }, [input, thinking, stage, messages])

  // Level 3 — POST starts the job and returns a jobId almost immediately (generation itself
  // runs server-side via Next.js after(), decoupled from this fetch entirely — see
  // app/api/quante/generate/route.ts and docs/update-log.md). Everything below is polling
  // /api/quante/generate/status until it reports completed/failed, using the exact same
  // decidePollAction()/phaseToStatusText()/isJobStuck() pure logic the resume banner's own
  // polling effect (above) uses — so this function and a fresh-reload resume can never
  // disagree about what a given status payload means. Unlike the old NDJSON-streaming
  // version, there's no "warn at 250s / give up at 290s" special-casing: if this tab closes
  // mid-poll, the localStorage marker + jobId are all a later reload needs to pick the same
  // poll back up (that's the resume banner's job now, not this function's).
  async function handleGenerate() {
    if (!brief.trim()) return
    setStage('generating')
    setStatusText('Designing your store…')
    setError('')
    setCodeChunks('')

    // A fresh generation is starting now, so any stale resume banner from a previous reload
    // no longer applies (whatever it pointed at is moot either way).
    setResumePending(null)
    setResumeFoundProjectId(null)
    setResumeChecked(false)
    setResumeStatusText(null)
    setResumeError(null)
    setResumeDeploymentId(null)
    setResumeVersionId(null)
    setResumePreviewUrl(null)
    setResumeDeployError(null)

    const pendingStartedAt = Date.now()
    const trimmedBrief = brief.trim()
    const trimmedName = projectName.trim()
    savePending({ startedAt: pendingStartedAt, brief: trimmedBrief, projectName: trimmedName, jobId: null })

    let jobId: string
    try {
      const res = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: trimmedBrief, projectName: trimmedName || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.jobId) {
        clearPending()
        setError(data?.error || 'Could not start generation. Please try again.')
        setStage('ready')
        return
      }
      jobId = data.jobId
      // Now the marker can carry the real jobId — from here on, a reload resumes via direct
      // status polling instead of the coarser /api/projects time-window fallback.
      savePending({ startedAt: pendingStartedAt, brief: trimmedBrief, projectName: trimmedName, jobId })
    } catch {
      clearPending()
      setError('Could not reach the server. Please check your connection and try again.')
      setStage('ready')
      return
    }

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2500))

      let payload: JobStatusPayload
      try {
        const r = await fetch(`/api/quante/generate/status?jobId=${jobId}`)
        if (!r.ok) continue // transient (5xx, brief auth hiccup, etc.) — retry next tick
        payload = await r.json()
      } catch {
        continue // network hiccup — retry next tick
      }

      setStatusText(phaseToStatusText(payload.phase))
      if (payload.rawOutputTail) setCodeChunks(payload.rawOutputTail)

      const decision = decidePollAction(payload)
      if (decision.action === 'navigate') {
        clearPending()
        router.push(buildProjectUrl(decision.projectId, decision.deploymentId, decision.codeVersionId, payload.previewUrl, decision.deployError))
        return
      }
      if (decision.action === 'error') {
        clearPending()
        setError(decision.message)
        setStage('ready')
        return
      }
      if (isJobStuck(pendingStartedAt, Date.now())) {
        clearPending()
        setError('Generation timed out. Check your dashboard — your store may have been saved there.')
        setStage('ready')
        return
      }
    }
  }

  // ── Generating ──────────────────────────────────────────────────────────────
  if (stage === 'generating') {
    return (
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '2.5rem 1rem',
        display: 'flex', flexDirection: 'column', gap: 32, minHeight: '85vh',
      }}>
        {/* Header */}
        <div>
          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 6px' }}>
            Building your store
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.08)', borderTopColor: '#6f78e6', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#e0e0e8' }}>{statusText}</h2>
          </div>
        </div>

        {/* Stages */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STAGES.map((s, i) => {
            const done = i < stageIndex
            const active = i === stageIndex
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                {/* Indicator */}
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? '#3ecf8e' : active ? 'rgba(111,120,230,.15)' : 'rgba(255,255,255,.04)',
                  border: done ? 'none' : active ? '1.5px solid #6f78e6' : '1px solid rgba(255,255,255,.08)',
                  transition: 'all .4s ease',
                }}>
                  {done ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="#0a0a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : active ? (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6f78e6', animation: 'pulse 1.4s ease infinite' }} />
                  ) : null}
                </div>
                <span style={{ fontSize: 13, color: done ? '#3ecf8e' : active ? '#d0d0da' : '#4a4a55', fontFamily: 'var(--font-geist-mono)', transition: 'color .4s ease' }}>
                  {s.label}
                </span>
                {done && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>done</span>
                )}
                {active && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6f78e6', fontFamily: 'var(--font-geist-mono)', animation: 'blink 1.2s ease infinite' }}>…</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Live code terminal — always visible during generation */}
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: '#070709', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
            <span style={{ marginLeft: 8, fontSize: 10, color: '#4a4a55', fontFamily: 'var(--font-geist-mono)' }}>generating store…</span>
          </div>
          <pre style={{
            margin: 0, padding: '12px 14px', fontSize: 11,
            fontFamily: 'var(--font-geist-mono)', color: '#6f78e6',
            lineHeight: 1.6, overflowX: 'auto', overflowY: 'hidden',
            maxHeight: 220, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            minHeight: 52,
          }}>
            {codeChunks
              ? codeChunks.slice(-1500)
              : <span style={{ color: '#363640' }}>Waiting for Claude…</span>
            }
            <span style={{ opacity: 0.5, animation: 'blink 1s step-end infinite' }}>▌</span>
          </pre>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{error}</p>
        )}

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
          @keyframes blink{0%,100%{opacity:.4}50%{opacity:0}}
        `}</style>
      </div>
    )
  }

  const avatarSt: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
    background: 'rgba(111,120,230,.14)',
    border: '1px solid rgba(111,120,230,.22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, color: '#6f78e6',
    fontFamily: 'var(--font-geist-mono)', letterSpacing: '.02em',
    marginTop: 1,
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '2rem 1rem 6rem', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <p style={{
        fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
        textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 2rem',
      }}>
        New project
      </p>

      {/* Resume banner: shown when a generation marker survived a reload/crash. Level 3 —
          when the marker has a jobId, status comes live from the polling effect above
          (resumeStatusText/resumeError) instead of the older /api/projects heuristic, which
          now only runs as a fallback for markers without one. */}
      {resumePending && (() => {
        const isLive = !!resumePending.jobId && !resumeFoundProjectId && !resumeError
        return (
        <div style={{
          marginBottom: 24, padding: '14px 16px', borderRadius: 12,
          border: `1px solid ${resumeError ? 'rgba(248,113,113,.3)' : 'rgba(111,120,230,.28)'}`,
          background: resumeError ? 'rgba(248,113,113,.05)' : 'rgba(111,120,230,.06)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {isLive ? (
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.08)', borderTopColor: '#6f78e6', animation: 'spin 0.9s linear infinite', flexShrink: 0, marginTop: 2 }} />
            ) : (
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${resumeError ? '#f87171' : '#6f78e6'}`, flexShrink: 0, marginTop: 2 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e0e0e8' }}>
                {resumeFoundProjectId
                  ? 'A generation from before your last reload finished.'
                  : resumeError
                    ? resumeError
                    : isLive
                      ? (resumeStatusText || 'A generation is still running — checking status…')
                      : 'A generation was still running when this page last closed or reloaded.'}
              </p>
              <p style={{
                margin: '4px 0 0', fontSize: 12, color: '#8a8a93', lineHeight: 1.5,
                overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                “{resumePending.brief}”
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                clearPending()
                setResumePending(null)
                setResumeFoundProjectId(null)
                setResumeError(null)
                setResumeStatusText(null)
                setResumeDeploymentId(null)
                setResumeVersionId(null)
                setResumePreviewUrl(null)
              }}
              style={{
                fontSize: 12, color: '#8a8a93', background: 'none', border: 'none',
                cursor: 'pointer', padding: '7px 10px',
              }}
            >
              Discard, start fresh
            </button>
            {resumeFoundProjectId ? (
              <button
                type="button"
                onClick={() => {
                  clearPending()
                  router.push(buildProjectUrl(resumeFoundProjectId, resumeDeploymentId, resumeVersionId, resumePreviewUrl, resumeDeployError))
                }}
                style={{
                  fontSize: 12, fontWeight: 600, color: '#fff', background: '#6f78e6',
                  border: 'none', borderRadius: 7, cursor: 'pointer', padding: '7px 14px',
                }}
              >
                Open finished store →
              </button>
            ) : resumePending.jobId ? (
              // Live-polling state (isLive) or a terminal error — either way, status updates
              // on its own; there's nothing useful for a manual button to do here besides
              // discard (above), unlike the no-jobId fallback branch below.
              <span style={{ fontSize: 12, color: '#5b5b64', padding: '7px 4px' }}>
                {resumeError ? 'You can discard this and start a new one.' : 'Checking automatically…'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => checkForResumableProject(resumePending)}
                disabled={resumeChecking}
                style={{
                  fontSize: 12, fontWeight: 600, color: '#e0e0e8',
                  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                  borderRadius: 7, cursor: resumeChecking ? 'default' : 'pointer', padding: '7px 14px',
                }}
              >
                {resumeChecking ? 'Checking…' : resumeChecked ? 'Not found yet — check again' : 'Check status'}
              </button>
            )}
          </div>
        </div>
        )
      })()}

      {/* Messages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: msg.role === 'quante' ? 'row' : 'row-reverse',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            {msg.role === 'quante' && <div style={avatarSt}>Q</div>}
            <div style={{
              maxWidth: '80%',
              ...(msg.role === 'user' ? {
                padding: '9px 13px',
                borderRadius: 12,
                background: 'rgba(111,120,230,.09)',
                border: '1px solid rgba(111,120,230,.16)',
              } : {}),
              fontSize: 14,
              lineHeight: 1.65,
              color: '#f4f4f6',
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
              {msg.streaming && (
                <span style={{
                  display: 'inline-block', width: 5, height: 14,
                  background: '#6f78e6', marginLeft: 2, borderRadius: 1,
                  verticalAlign: 'middle',
                  animation: 'blink .75s step-end infinite',
                }} />
              )}
            </div>
          </div>
        ))}

        {/* Thinking dots */}
        {thinking && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={avatarSt}>Q</div>
            <div style={{ display: 'flex', gap: 5, paddingTop: 3 }}>
              {[0, 160, 320].map(d => (
                <div key={d} style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#5b5b64',
                  animation: `pulse 1.3s ${d}ms ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Ready panel */}
      {stage === 'ready' && (
        <div style={{
          marginTop: 28,
          borderRadius: 12,
          border: '1px solid rgba(111,120,230,.22)',
          background: 'rgba(111,120,230,.04)',
          overflow: 'hidden',
        }}>
          {/* Brief header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <p style={{
              fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#6f78e6',
              textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 10px',
            }}>
              ✦ Store brief
            </p>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              rows={4}
              style={{
                width: '100%', fontSize: 13, color: '#e0e0e8', background: 'transparent',
                border: 'none', outline: 'none', resize: 'none', lineHeight: 1.7,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{
                fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
                textTransform: 'uppercase', letterSpacing: '.07em', margin: '0 0 6px',
              }}>
                Project name
              </p>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="My store"
                style={{
                  width: '100%', fontSize: 13, padding: '8px 11px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.09)', background: '#0a0a0e',
                  color: '#f4f4f6', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.45)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={() => { setStage('chat'); setError('') }}
                style={{
                  fontSize: 12, color: '#5b5b64', background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0,
                  transition: 'color .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#8a8a93')}
                onMouseLeave={e => (e.currentTarget.style.color = '#5b5b64')}
              >
                ← Keep refining
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>10 cr</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!brief.trim()}
                  style={{
                    padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                    border: 'none', cursor: brief.trim() ? 'pointer' : 'not-allowed',
                    background: brief.trim() ? '#6f78e6' : 'rgba(255,255,255,.06)',
                    color: brief.trim() ? '#fff' : '#5b5b64',
                    transition: 'background .12s, opacity .12s',
                  }}
                  onMouseEnter={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#5d66d4' }}
                  onMouseLeave={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#6f78e6' }}
                >
                  Generate store
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat input */}
      {stage === 'chat' && (
        <div style={{
          marginTop: 24,
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,.09)',
          background: '#0a0a0e',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '10px 10px 10px 14px',
          transition: 'border-color .15s',
        }}
          onFocusCapture={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.35)')}
          onBlurCapture={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
        >
          <textarea
            ref={inputRef}
            value={input}
            disabled={thinking}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder={thinking ? '' : 'Reply to Quante…'}
            rows={1}
            style={{
              flex: 1, fontSize: 14, color: '#f4f4f6', background: 'transparent',
              border: 'none', outline: 'none', resize: 'none', lineHeight: 1.55,
              fontFamily: 'inherit', minHeight: 22, maxHeight: 130,
              opacity: thinking ? 0.3 : 1, transition: 'opacity .2s',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || thinking}
            style={{
              flexShrink: 0, width: 36, height: 36, borderRadius: 8,
              background: input.trim() && !thinking ? '#6f78e6' : 'rgba(255,255,255,.06)',
              border: 'none', cursor: input.trim() && !thinking ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .12s',
              color: input.trim() && !thinking ? '#fff' : '#5b5b64',
              fontSize: 15, lineHeight: 1,
            }}
            onMouseEnter={e => { if (input.trim() && !thinking) (e.currentTarget as HTMLButtonElement).style.background = '#5d66d4' }}
            onMouseLeave={e => { if (input.trim() && !thinking) (e.currentTarget as HTMLButtonElement).style.background = '#6f78e6' }}
          >
            ↑
          </button>
        </div>
      )}

      {error && stage === 'chat' && (
        <p style={{ fontSize: 12, color: '#f87171', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>
      )}

      <style>{`
        @keyframes blink  { 50% { opacity: 0 } }
        @keyframes pulse  { 0%,80%,100% { opacity: .25; transform: scale(.85) } 40% { opacity: 1; transform: scale(1) } }
        @keyframes spin   { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
