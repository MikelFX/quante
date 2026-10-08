'use client'

// Qgent in the Studio (shop mode, 2026-10-08). Qgent goes through the store on request
// (POST /api/projects/[id]/qgent/review) and proposes fixes. Each fix is shown as a diff and
// applied only when the merchant confirms it; money-related ones (prices, currency, cart,
// shipping / payment wording) need a second confirmation. An applied fix is a DRAFT code
// version — shoppers see it after Publish — and can be undone. Everything is logged.

import { useCallback, useEffect, useState } from 'react'
import { ParticleZone } from '@ad/ui'

type Status = 'proposed' | 'advice' | 'applied' | 'rejected' | 'reverted' | 'failed' | 'stale'

interface Hunk { path: string; line: number; lines: Array<{ t: ' ' | '-' | '+'; text: string }> }

interface Action {
  id: string
  reviewId: string | null
  title: string
  why: string
  area: string
  severity: 'high' | 'medium' | 'low'
  status: Status
  sensitiveReasons: string[]
  hunks: Hunk[]
  appliedVersionNo: number | null
  revertedVersionNo: number | null
  creditsCharged: number
  error: string | null
  createdAt: string
  confirmedAt: string | null
  sensitiveConfirmedAt: string | null
  revertedAt: string | null
}

interface AdsBrief { brand: string; audience: string; tone: string; products: Array<{ name: string; description: string }> }

interface State {
  ready: boolean
  hasStore?: boolean
  agency?: boolean
  language?: string
  costs?: { review: number; apply: number }
  review?: { id: string; createdAt: string; status: 'running' | 'done' | 'failed'; summary: string; adsBrief: AdsBrief | null; error: string | null } | null
  actions?: Action[]
}

export interface QgentApplied {
  title: string
  undo: boolean
  versionNo: number
  deploymentId: string | null
  previewUrl: string | null
  staged: boolean
}

interface Props {
  projectId: string
  /** Live store: changes become a draft until Publish. */
  draftMode: boolean
  /** A change was saved as a new draft version (and a build may have started). */
  onApplied: (r: QgentApplied) => void
  /** Credits changed (review or apply charged / refunded). */
  onBalanceRefresh: () => void
}

const QADS_DRAFT_KEY = 'qads:draft:v1'
const QADS_LANGS = new Set(['cs', 'en', 'sk', 'de'])

const label: React.CSSProperties = {
  fontSize: 10, fontFamily: 'var(--q-mono)', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '.06em', color: 'var(--q-fg4)', margin: 0,
}
const card: React.CSSProperties = {
  borderRadius: 14, border: '1px solid rgb(var(--q-ink-rgb) / .09)', background: 'rgb(var(--q-ink-rgb) / .025)', padding: 14,
}
const small: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--q-fg3)', margin: 0 }
const btnGhost: React.CSSProperties = {
  minHeight: 32, padding: '0 12px', borderRadius: 999, border: '1px solid rgb(var(--q-ink-rgb) / .14)',
  background: 'transparent', color: 'var(--q-fg)', fontSize: 12, fontWeight: 550, cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = {
  ...btnGhost, border: '1px solid transparent', background: 'var(--q-acc)', color: 'var(--q-acc-ink)', fontWeight: 650,
}

const SEVERITY: Record<Action['severity'], { text: string; color: string }> = {
  high: { text: 'Important', color: 'var(--q-danger-text)' },
  medium: { text: 'Worth fixing', color: 'var(--q-warn-text)' },
  low: { text: 'Polish', color: 'var(--q-fg3)' },
}

const STATUS_TEXT: Record<Status, string> = {
  proposed: 'Waiting for you',
  advice: 'Advice',
  applied: 'Applied',
  rejected: 'Dismissed',
  reverted: 'Undone',
  failed: 'Not applied',
  stale: 'Outdated',
}

async function fetchState(projectId: string): Promise<{ state: State } | { error: string }> {
  try {
    const r = await fetch(`/api/projects/${projectId}/qgent`)
    const d = await r.json().catch(() => ({}))
    return r.ok ? { state: d as State } : { error: d.error ?? 'Could not load Qgent.' }
  } catch {
    return { error: 'Could not load Qgent — check your connection.' }
  }
}

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export function QgentPanel({ projectId, draftMode, onApplied, onBalanceRefresh }: Props) {
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Second confirmation for money-related changes: action id → reasons from the server.
  const [moneyConfirm, setMoneyConfirm] = useState<{ id: string; reasons: string[]; checked: boolean } | null>(null)
  const [showLog, setShowLog] = useState(false)

  const apply = (r: { state: State } | { error: string }) => {
    if ('state' in r) { setState(r.state); setLoadError(null) } else setLoadError(r.error)
  }
  const load = useCallback(async () => apply(await fetchState(projectId)), [projectId])

  useEffect(() => {
    let cancelled = false
    fetchState(projectId).then((r) => { if (!cancelled) apply(r) })
    return () => { cancelled = true }
  }, [projectId])

  // Another tab (or a reload) may have a review running: poll until it is done.
  const running = reviewing || state?.review?.status === 'running'
  useEffect(() => {
    if (!running || reviewing) return
    const t = setInterval(() => { void load() }, 8000)
    return () => clearInterval(t)
  }, [running, reviewing, load])

  async function review() {
    if (running) return
    setReviewing(true)
    setNotice(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/qgent/review`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) setNotice({ kind: 'error', text: d.error ?? 'The review failed.' })
      else setNotice({ kind: 'ok', text: d.findings ? `Qgent found ${d.findings} thing${d.findings === 1 ? '' : 's'} to look at.` : 'Qgent found nothing to fix.' })
    } catch {
      setNotice({ kind: 'error', text: 'The review was interrupted. Check your connection and try again.' })
    } finally {
      setReviewing(false)
      onBalanceRefresh()
      await load()
    }
  }

  async function act(a: Action, op: 'apply' | 'reject' | 'revert', confirmSensitive = false) {
    setBusy(a.id)
    setNotice(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/qgent/actions/${a.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, confirmSensitive }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && d.needsSensitiveConfirm) {
        setMoneyConfirm({ id: a.id, reasons: Array.isArray(d.reasons) ? d.reasons : a.sensitiveReasons, checked: false })
        return
      }
      if (!r.ok) {
        setNotice({ kind: 'error', text: d.error ?? 'That did not work.' })
      } else if (op !== 'reject') {
        setMoneyConfirm(null)
        onApplied({ title: a.title, undo: op === 'revert', versionNo: d.versionNo, deploymentId: d.deploymentId ?? null, previewUrl: d.previewUrl ?? null, staged: !!d.staged })
        setNotice({
          kind: 'ok',
          text: op === 'revert'
            ? `Undone — saved as draft v${d.versionNo}.`
            : `Applied as draft v${d.versionNo}${d.charged ? ` (${credits(d.charged)})` : ''}.${draftMode ? ' Shoppers see it after you Publish.' : ''}`,
        })
      }
      if (op !== 'reject') onBalanceRefresh()
    } catch {
      setNotice({ kind: 'error', text: 'That did not work — check your connection.' })
    } finally {
      setBusy(null)
      await load()
    }
  }

  function toQads(brief: AdsBrief, p: { name: string; description: string }) {
    const extra = [brief.audience && `Audience: ${brief.audience}`, brief.tone && `Tone: ${brief.tone}`].filter(Boolean).join('\n')
    const draft = {
      productName: p.name.slice(0, 120),
      productDescription: [p.description, extra].filter(Boolean).join('\n\n').slice(0, 2000),
      projectId,
      ...(state?.language && QADS_LANGS.has(state.language) ? { language: state.language } : {}),
    }
    try { sessionStorage.setItem(QADS_DRAFT_KEY, JSON.stringify(draft)) } catch {}
    window.location.assign('/qads')
  }

  if (loadError && !state) return <div style={{ padding: 16 }}><p style={{ ...small, color: 'var(--q-danger-text)' }}>{loadError}</p></div>
  if (!state) return <div style={{ padding: 16 }}><p style={small}>Loading…</p></div>
  if (!state.ready) {
    return (
      <div style={{ padding: 16 }}>
        <div style={card}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px', color: 'var(--q-fg)' }}>Qgent isn&apos;t set up yet</p>
          <p style={small}>The database migration for Qgent hasn&apos;t run on this environment yet (supabase/migration-qgent-shop.sql).</p>
        </div>
      </div>
    )
  }

  const actions = state.actions ?? []
  const latestId = state.review?.id ?? null
  const current = actions.filter((a) => a.reviewId === latestId && latestId)
  const order: Status[] = ['proposed', 'advice', 'applied', 'reverted', 'failed', 'stale', 'rejected']
  current.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  const costText = state.agency ? 'free with Agency' : credits(state.costs?.review ?? 2)
  const applyCost = state.agency ? 0 : state.costs?.apply ?? 1

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <p style={{ ...small, color: 'var(--q-fg2)' }}>
          Qgent goes through your store page by page and suggests fixes. You see every change as a diff first and nothing
          changes until you confirm it. Changes are saved as drafts{draftMode ? ' (shoppers see them after Publish)' : ''},
          logged, and can be undone. Prices, currency, the cart and shipping or payment texts need a second confirmation.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="q-btn" onClick={review} disabled={running || !state.hasStore} style={running || !state.hasStore ? { opacity: 0.6, cursor: 'default' } : undefined}>
            {running ? 'Reviewing…' : state.review ? 'Review again' : 'Review my store'}
          </button>
          <span style={{ ...small, fontSize: 11 }}>{costText} · ~1–2 min</span>
        </div>
        {!state.hasStore && <p style={{ ...small, marginTop: 8 }}>Generate your store first.</p>}
      </div>

      {running && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }} aria-live="polite">
          <ParticleZone className="q-load-pz" priority shapes={['AGENT']} style={{ height: 120, width: '100%' }} />
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--q-fg)' }}>Qgent is going through your store</p>
          <p style={small}>Pages, products, links, texts and SEO. This usually takes a minute or two.</p>
        </div>
      )}

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} style={{ ...small, padding: '8px 10px', borderRadius: 10, color: notice.kind === 'error' ? 'var(--q-danger-text)' : 'var(--q-ok-text)', background: notice.kind === 'error' ? 'rgb(var(--q-danger-rgb) / .08)' : 'rgb(var(--q-ok-rgb) / .08)' }}>
          {notice.text}
        </p>
      )}

      {state.review && state.review.status !== 'running' && (
        <div>
          <p style={label}>Last review · {when(state.review.createdAt)}</p>
          {state.review.status === 'failed'
            ? <p style={{ ...small, marginTop: 6, color: 'var(--q-danger-text)' }}>{state.review.error ?? 'The review did not finish.'}</p>
            : state.review.summary && <p style={{ ...small, marginTop: 6, color: 'var(--q-fg2)' }}>{state.review.summary}</p>}
        </div>
      )}

      {current.map((a) => (
        <Finding
          key={a.id}
          a={a}
          busy={busy === a.id}
          applyCost={applyCost}
          money={moneyConfirm?.id === a.id ? moneyConfirm : null}
          onMoneyCheck={(checked) => setMoneyConfirm((m) => (m && m.id === a.id ? { ...m, checked } : m))}
          onMoneyCancel={() => setMoneyConfirm(null)}
          onApply={(sensitiveOk) => act(a, 'apply', sensitiveOk)}
          onReject={() => act(a, 'reject')}
          onRevert={() => act(a, 'revert')}
        />
      ))}

      {state.review?.status === 'done' && state.review.adsBrief && state.review.adsBrief.products.length > 0 && (
        <div style={card}>
          <p style={label}>For Qads</p>
          <p style={{ ...small, marginTop: 6 }}>
            Qgent collected what your store says about itself. Pick a product to start ads in Qads with it filled in (you add the photos there).
          </p>
          {(state.review.adsBrief.audience || state.review.adsBrief.tone) && (
            <p style={{ ...small, marginTop: 8, color: 'var(--q-fg2)' }}>
              {state.review.adsBrief.audience && <><b>Audience:</b> {state.review.adsBrief.audience}<br /></>}
              {state.review.adsBrief.tone && <><b>Tone:</b> {state.review.adsBrief.tone}</>}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {state.review.adsBrief.products.slice(0, 6).map((p) => (
              <button key={p.name} type="button" onClick={() => toQads(state.review!.adsBrief!, p)} style={{ ...btnGhost, textAlign: 'left', borderRadius: 10, padding: '8px 12px', minHeight: 40 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{p.name} →</span>
                {p.description && <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--q-fg3)', marginTop: 2 }}>{p.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} style={{ ...btnGhost, border: 'none', padding: 0, minHeight: 28, color: 'var(--q-fg3)' }}>
            {showLog ? '▾' : '▸'} Log ({actions.length})
          </button>
          {showLog && (
            <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((a) => (
                <li key={a.id} style={{ ...small, fontSize: 11, display: 'flex', gap: 8 }}>
                  <span style={{ flex: 'none', minWidth: 74, fontFamily: 'var(--q-mono)', color: 'var(--q-fg4)' }}>{when(a.revertedAt ?? a.confirmedAt ?? a.createdAt)}</span>
                  <span>
                    <b style={{ color: 'var(--q-fg2)', fontWeight: 600 }}>{STATUS_TEXT[a.status]}</b> · {a.title}
                    {a.status === 'applied' && a.appliedVersionNo ? ` · draft v${a.appliedVersionNo}` : ''}
                    {a.status === 'reverted' && a.revertedVersionNo ? ` · undone in v${a.revertedVersionNo}` : ''}
                    {a.creditsCharged ? ` · ${credits(a.creditsCharged)}` : ''}
                    {a.sensitiveConfirmedAt ? ' · money change confirmed separately' : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function Finding({ a, busy, applyCost, money, onMoneyCheck, onMoneyCancel, onApply, onReject, onRevert }: {
  a: Action
  busy: boolean
  applyCost: number
  money: { reasons: string[]; checked: boolean } | null
  onMoneyCheck: (checked: boolean) => void
  onMoneyCancel: () => void
  onApply: (sensitiveOk: boolean) => void
  onReject: () => void
  onRevert: () => void
}) {
  const [open, setOpen] = useState(a.status === 'proposed')
  const sev = SEVERITY[a.severity]
  const muted = a.status === 'rejected' || a.status === 'stale' || a.status === 'reverted'
  return (
    <div style={{ ...card, opacity: muted ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...label, color: sev.color }}>{sev.text}</span>
        {a.area && <span style={label}>· {a.area}</span>}
        <span style={{ ...label, marginLeft: 'auto', color: a.status === 'applied' ? 'var(--q-ok-text)' : 'var(--q-fg4)' }}>{STATUS_TEXT[a.status]}</span>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, margin: '6px 0 4px', color: 'var(--q-fg)' }}>{a.title}</p>
      {a.why && <p style={small}>{a.why}</p>}

      {a.status === 'proposed' && a.sensitiveReasons.length > 0 && (
        <p style={{ ...small, marginTop: 8, padding: '6px 9px', borderRadius: 8, color: 'var(--q-warn-text)', background: 'rgb(var(--q-warn-rgb) / .08)' }}>
          Money-related: {a.sensitiveReasons.join(', ')}. Needs a second confirmation.
        </p>
      )}

      {a.hunks.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...btnGhost, border: 'none', padding: 0, minHeight: 28, marginTop: 6, color: 'var(--q-acc-text)' }}>
            {open ? '▾ Hide change' : '▸ Show change'}
          </button>
          {open && <Diff hunks={a.hunks} />}
        </>
      )}

      {a.status === 'advice' && <p style={{ ...small, marginTop: 8, fontSize: 11 }}>No automatic fix — change it yourself, in Chat or in the visual editor.</p>}
      {(a.status === 'stale' || a.status === 'failed') && a.error && <p style={{ ...small, marginTop: 8, fontSize: 11 }}>{a.error}</p>}
      {a.status === 'applied' && <p style={{ ...small, marginTop: 8, fontSize: 11, color: 'var(--q-ok-text)' }}>Applied{a.appliedVersionNo ? ` as draft v${a.appliedVersionNo}` : ''} · {when(a.confirmedAt)}</p>}
      {a.status === 'reverted' && <p style={{ ...small, marginTop: 8, fontSize: 11 }}>Undone{a.revertedVersionNo ? ` in v${a.revertedVersionNo}` : ''} · {when(a.revertedAt)}</p>}

      {money ? (
        <div role="group" aria-label="Confirm a money-related change" style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgb(var(--q-warn-rgb) / .35)', background: 'rgb(var(--q-warn-rgb) / .06)' }}>
          <p style={{ ...small, color: 'var(--q-fg)', fontWeight: 600 }}>Second confirmation: this fix {money.reasons.join(', ')}.</p>
          <p style={{ ...small, marginTop: 4 }}>Prices, payments and shipping only change with this separate confirmation. Check the diff above first.</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--q-fg)', cursor: 'pointer' }}>
            <input type="checkbox" checked={money.checked} onChange={(e) => onMoneyCheck(e.target.checked)} />
            I checked it and want this money change
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" disabled={!money.checked || busy} onClick={() => onApply(true)} style={{ ...btnPrimary, opacity: !money.checked || busy ? 0.55 : 1, cursor: !money.checked || busy ? 'default' : 'pointer' }}>
              {busy ? 'Applying…' : 'Confirm money change'}
            </button>
            <button type="button" onClick={onMoneyCancel} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {a.status === 'proposed' && (
            <>
              <button type="button" disabled={busy} onClick={() => onApply(false)} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Applying…' : `Apply${applyCost ? ` · ${credits(applyCost)}` : ''}`}
              </button>
              <button type="button" disabled={busy} onClick={onReject} style={btnGhost}>Dismiss</button>
            </>
          )}
          {a.status === 'advice' && <button type="button" disabled={busy} onClick={onReject} style={btnGhost}>Dismiss</button>}
          {a.status === 'applied' && <button type="button" disabled={busy} onClick={onRevert} style={btnGhost}>{busy ? 'Undoing…' : 'Undo'}</button>}
        </div>
      )}
    </div>
  )
}

function Diff({ hunks }: { hunks: Hunk[] }) {
  return (
    <div style={{ marginTop: 6, maxHeight: 280, overflow: 'auto', borderRadius: 8, border: '1px solid rgb(var(--q-ink-rgb) / .08)', background: 'var(--q-s1)', fontFamily: 'var(--q-mono)', fontSize: 11, lineHeight: 1.55 }}>
      {hunks.map((h, i) => (
        <div key={i}>
          <div style={{ padding: '4px 8px', color: 'var(--q-fg4)', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .06)', borderTop: i ? '1px solid rgb(var(--q-ink-rgb) / .06)' : undefined }}>
            {h.path}:{h.line}
          </div>
          {h.lines.map((l, j) => (
            <div
              key={j}
              style={{
                padding: '0 8px 0 22px', textIndent: -14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                color: l.t === '+' ? 'var(--q-ok-text)' : l.t === '-' ? 'var(--q-danger-text)' : 'var(--q-fg3)',
                background: l.t === '+' ? 'rgb(var(--q-ok-rgb) / .08)' : l.t === '-' ? 'rgb(var(--q-danger-rgb) / .08)' : 'transparent',
              }}
            >
              <span aria-hidden="true" style={{ userSelect: 'none', opacity: 0.6 }}>{l.t} </span>
              <span className="vh">{l.t === '+' ? 'added: ' : l.t === '-' ? 'removed: ' : ''}</span>
              {l.text || ' '}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
