'use client'

// The review stage on /qgent: the store's page drawn as layers (no iframe of the old site, no
// hotlinked images) with 20 agent cursors going over it behind a scan line, drawing selection boxes
// on the layers they read, and flying to the layer of every finding as it arrives. A finding is
// shown in the list only once its agent got there (onReveal), so list and stage stay in step.
// Motion off / reduced motion: no flying, every finding is revealed at once.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { SWARM_AGENTS, agentHue, agentIndex } from '@/lib/qgent/swarm/agents'
import type { Layer } from '@/lib/qgent/swarm/layers'
import type { SwarmFinding } from '@/lib/qgent/swarm/model'
import { groupLayers, scanDuration, swarmCircle } from '@/lib/qgent/swarm/stage'
import { AgentCursor, AgentDot } from './AgentCursor'

export interface StagePage {
  url: string
  layers: Layer[]
  total: number
  product: { url: string; layers: Layer[] } | null
}

interface Props {
  /** null while the page is being read */
  page: StagePage | null
  findings: SwarmFinding[]
  revealed: ReadonlySet<string>
  onReveal: (id: string) => void
  /** the stream ended (no more findings will come) */
  streamDone: boolean
  selected: string | null
  onSelect: (findingId: string) => void
  /** finding id → decision, for the pins' look */
  decisions: Record<string, 'yes' | 'no'>
  statusText: string
}

interface Pos { x: number; y: number }

const N = SWARM_AGENTS.length
const TICK = 170

export function stillMotion(): boolean {
  if (typeof window === 'undefined') return false
  return document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function SwarmStage({ page, findings, revealed, onReveal, streamDone, selected, onSelect, decisions, statusText }: Props) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const docRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Pos[]>(() => swarmCircle(N, 300, 220, 90))
  const [busy, setBusy] = useState<number[]>([])
  const [active, setActive] = useState<Record<string, number>>({})
  const [seen, setSeen] = useState(0)
  const [scanY, setScanY] = useState(0)
  const [progress, setProgress] = useState(0)
  const [scanEnd, setScanEnd] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [still] = useState(stillMotion)
  const userScrolled = useRef(false)

  // engine state that must not re-render on every change
  const st = useRef({ busyUntil: new Array<number>(N).fill(0), seen: new Set<string>(), scanStart: 0, scanMs: 0, elapsed: 0, last: 0, queue: [] as string[], dispatched: new Set<string>() })

  const allLayers = useMemo(() => (page ? [...page.layers, ...(page.product?.layers ?? [])] : []), [page])
  const blocks = useMemo(() => (page ? groupLayers(page.layers) : []), [page])
  const productBlocks = useMemo(() => (page?.product ? groupLayers(page.product.layers) : []), [page])

  const pinsByLayer = useMemo(() => {
    const m = new Map<string, SwarmFinding[]>()
    for (const f of findings) if (f.layer && revealed.has(f.id)) m.set(f.layer, [...(m.get(f.layer) ?? []), f])
    return m
  }, [findings, revealed])

  const rectOf = useCallback((lid: string) => {
    const doc = docRef.current
    const el = doc?.querySelector<HTMLElement>(`[data-lid="${lid}"]`)
    if (!doc || !el) return null
    const d = doc.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x: r.left - d.left, y: r.top - d.top, w: r.width, h: r.height }
  }, [])

  const moveAgent = useCallback((i: number, to: Pos, holdMs: number, lid?: string) => {
    const now = performance.now()
    st.current.busyUntil[i] = now + holdMs
    setPos((p) => { const n = p.slice(); n[i] = to; return n })
    setBusy((b) => (b.includes(i) ? b : [...b, i]))
    if (lid) setActive((a) => ({ ...a, [lid]: i }))
    window.setTimeout(() => {
      setBusy((b) => b.filter((x) => x !== i))
      if (lid) {
        setActive((a) => {
          if (a[lid] !== i) return a
          const n = { ...a }
          delete n[lid]
          return n
        })
        if (!st.current.seen.has(lid)) {
          st.current.seen.add(lid)
          setSeen(st.current.seen.size)
        }
      }
    }, holdMs / Math.max(1, speed))
  }, [speed])

  // waiting: the swarm circles in the middle of the stage
  useEffect(() => {
    if (page || still) return
    const view = viewRef.current
    const w = view?.clientWidth ?? 600
    const h = view?.clientHeight ?? 440
    let a = 0
    const t = window.setInterval(() => {
      a += 0.35
      setPos(swarmCircle(N, w / 2 - 8, h / 2 - 10, Math.min(110, w / 4)).map((p, i) => ({
        x: p.x + Math.cos(a + i) * 10, y: p.y + Math.sin(a * 1.3 + i) * 10,
      })))
    }, 600)
    return () => window.clearInterval(t)
  }, [page, still])

  // a new page: reset and start the scan
  useEffect(() => {
    if (!page) return
    const s = st.current
    s.seen = new Set()
    s.dispatched = new Set()
    s.queue = []
    s.elapsed = 0
    s.last = performance.now()
    s.scanMs = scanDuration(allLayers.length)
    userScrolled.current = false
    const t = window.setTimeout(() => {
      setSeen(0)
      setScanEnd(still)
      setScanY(0)
      setProgress(0)
      viewRef.current?.scrollTo({ top: 0 })
    }, 0)
    return () => window.clearTimeout(t)
  }, [page, allLayers.length, still])

  // reveal findings: at once with motion off, otherwise when the scan line has passed their layer
  useEffect(() => {
    if (!page) return
    for (const f of findings) {
      if (revealed.has(f.id) || st.current.dispatched.has(f.id)) continue
      if (still || !f.layer) {
        st.current.dispatched.add(f.id)
        onReveal(f.id)
      } else if (!st.current.queue.includes(f.id)) {
        st.current.queue.push(f.id)
      }
    }
  }, [findings, revealed, page, still, onReveal])

  // the engine
  useEffect(() => {
    if (!page || still) return
    const t = window.setInterval(() => {
      const s = st.current
      const now = performance.now()
      const dt = now - s.last
      s.last = now
      if (paused) return
      s.elapsed += dt * speed
      const doc = docRef.current
      const view = viewRef.current
      if (!doc || !view) return
      const height = doc.scrollHeight
      const progress = Math.min(1, s.elapsed / s.scanMs)
      const y = progress * height
      setScanY(y)
      setProgress(progress)
      if (progress >= 1) setScanEnd(true)
      if (!userScrolled.current && progress < 1) view.scrollTo({ top: Math.max(0, y - view.clientHeight * 0.45) })

      const idle = Array.from({ length: N }, (_, i) => i).filter((i) => s.busyUntil[i] < now)

      // findings whose layer the scan line has passed: their own agent flies there first
      for (const fid of [...s.queue]) {
        const f = findings.find((x) => x.id === fid)
        if (!f || !f.layer) continue
        const r = rectOf(f.layer)
        if (!r) { s.queue = s.queue.filter((q) => q !== fid); s.dispatched.add(fid); onReveal(fid); continue }
        if (r.y > y && progress < 1) continue
        const i = agentIndex(f.agent)
        if (i < 0) continue
        s.queue = s.queue.filter((q) => q !== fid)
        s.dispatched.add(fid)
        moveAgent(i, { x: r.x + Math.min(r.w - 24, Math.max(8, r.w * 0.7)), y: r.y + Math.min(r.h / 2, 30) }, 1500, f.layer)
        window.setTimeout(() => onReveal(fid), 650 / speed)
      }

      // everyone else reads layers around the scan line
      if (progress < 1) {
        const near = allLayers.filter((l) => !s.seen.has(l.id))
          .map((l) => ({ l, r: rectOf(l.id) }))
          .filter((x): x is { l: Layer; r: NonNullable<ReturnType<typeof rectOf>> } => !!x.r && x.r.y < y + 40 && x.r.y > y - 420)
        const free = idle.filter((i) => s.busyUntil[i] < now)
        for (let k = 0; k < Math.min(3, free.length, near.length); k++) {
          const i = free[Math.floor(Math.random() * free.length)]
          const pick = near.splice(Math.floor(Math.random() * near.length), 1)[0]
          if (!pick) break
          s.busyUntil[i] = now + 900
          moveAgent(i, { x: pick.r.x + 6 + Math.random() * Math.max(10, pick.r.w * 0.6), y: pick.r.y + Math.min(pick.r.h * 0.6, 26) }, 850 + Math.random() * 500, pick.l.id)
        }
      } else if (streamDone && Math.random() < 0.08 && idle.length) {
        // afterwards: a gentle drift to the layers that have findings
        const lids = [...pinsByLayer.keys()]
        const i = idle[Math.floor(Math.random() * idle.length)]
        const lid = lids[Math.floor(Math.random() * Math.max(1, lids.length))]
        const r = lid ? rectOf(lid) : null
        if (r) moveAgent(i, { x: r.x + r.w * (0.3 + Math.random() * 0.5), y: r.y + 10 + Math.random() * 20 }, 2200)
      }
    }, TICK)
    return () => window.clearInterval(t)
  }, [page, still, paused, speed, findings, allLayers, rectOf, moveAgent, onReveal, streamDone, pinsByLayer])

  // a selected finding: bring its layer into view
  useEffect(() => {
    const f = findings.find((x) => x.id === selected)
    if (!f?.layer) return
    const r = rectOf(f.layer)
    const view = viewRef.current
    if (r && view) {
      userScrolled.current = true
      view.scrollTo({ top: Math.max(0, r.y - view.clientHeight * 0.3), behavior: still ? 'auto' : 'smooth' })
    }
  }, [selected, findings, rectOf, still])

  const selectedLayer = findings.find((x) => x.id === selected)?.layer ?? null
  const total = page?.total ?? 0
  const seenShown = page ? (scanEnd ? total : Math.round((seen / Math.max(1, allLayers.length)) * total)) : 0
  const pct = page ? (scanEnd ? 100 : Math.round(progress * 100)) : 0

  const renderLayer = (l: Layer, extra = '') => {
    const pins = pinsByLayer.get(l.id)
    const a = active[l.id]
    return (
      <div
        key={l.id}
        data-lid={l.id}
        className={`qg-l qg-${l.kind}${extra}`}
        data-d={l.depth}
        data-on={a !== undefined ? '' : undefined}
        data-sel={selectedLayer === l.id ? '' : undefined}
        style={a !== undefined ? ({ '--h': `${agentHue(a)}deg` } as React.CSSProperties) : undefined}
      >
        <LayerBody l={l} />
        {a !== undefined && <span className="qg-tag" aria-hidden="true">{SWARM_AGENTS[a]?.name} · {l.kind}</span>}
        {pins && (
          <span className="qg-pins">
            {pins.map((f) => (
              <button
                key={f.id}
                type="button"
                className="qg-pin"
                data-dec={decisions[f.id]}
                style={{ '--h': `${agentHue(agentIndex(f.agent))}deg` } as React.CSSProperties}
                onClick={() => onSelect(f.id)}
                aria-label={`${SWARM_AGENTS[agentIndex(f.agent)]?.name}: ${f.title}`}
              >
                {SWARM_AGENTS[agentIndex(f.agent)]?.name.slice(0, 1)}
              </button>
            ))}
          </span>
        )}
      </div>
    )
  }

  const renderBlocks = (list: typeof blocks) => list.map((b, i) => {
    if (b.type === 'layer') return renderLayer(b.layer)
    if (b.type === 'links') return <div key={`r${i}`} className="qg-row" data-d={b.layers[0].depth}>{b.layers.map((l) => renderLayer(l))}</div>
    return (
      <div key={`c${i}`} className="qg-cards">
        {b.cards.map(({ card, parts }) => (
          <div key={card.id} className="qg-cardwrap">
            {renderLayer(card, ' qg-cardh')}
            {parts.map((p) => renderLayer(p, ' qg-in'))}
          </div>
        ))}
      </div>
    )
  })

  return (
    <div className="qg-stage" data-phase={page ? (scanEnd ? 'done' : 'scan') : 'wait'}>
      <div className="qg-chrome">
        <span className="qg-lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="qg-url">{page ? hostPath(page.url) : 'reading the page…'}</span>
      </div>
      <div
        className="qg-view"
        ref={viewRef}
        onWheel={() => { userScrolled.current = true }}
        onTouchMove={() => { userScrolled.current = true }}
      >
        <div className="qg-doc" ref={docRef}>
          {page ? (
            <>
              {renderBlocks(blocks)}
              {page.product && (
                <>
                  <div className="qg-divider"><span>Product page · {hostPath(page.product.url)}</span></div>
                  {renderBlocks(productBlocks)}
                </>
              )}
              {!scanEnd && <div className="qg-scan" style={{ transform: `translateY(${scanY}px)` }} aria-hidden="true" />}
            </>
          ) : (
            <div className="qg-wait" />
          )}
          {SWARM_AGENTS.map((a, i) => (
            <AgentCursor key={a.id} index={i} name={a.name} x={pos[i]?.x ?? 0} y={pos[i]?.y ?? 0} busy={busy.includes(i)} hidden={still && !!page} />
          ))}
        </div>
      </div>
      <div className="qg-bar" role="status" aria-live="polite">
        <span className="qg-dots" aria-hidden="true">{SWARM_AGENTS.slice(0, 5).map((a, i) => <AgentDot key={a.id} index={i} />)}</span>
        <b>{N} agents</b>
        <span className="qg-count">{page ? `${seenShown} / ${total} layers` : statusText}</span>
        <span className="qg-prog" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        {page && !scanEnd && !still && (
          <>
            <button type="button" className="qg-mini" onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} aria-label="Speed">{speed}×</button>
            <button type="button" className="qg-mini" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume' : 'Pause'}>{paused ? <Play /> : <Pause />}</button>
          </>
        )}
        {page && scanEnd && <span className="qg-count">{streamDone ? statusText : 'agents are still writing…'}</span>}
      </div>
    </div>
  )
}

function hostPath(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)).slice(0, 80)
  } catch {
    return url
  }
}

function LayerBody({ l }: { l: Layer }) {
  switch (l.kind) {
    case 'header': case 'nav': case 'footer': case 'section': case 'form':
      return <span className="qg-k">{l.kind}{l.text ? ` · ${l.text}` : ''}</span>
    case 'product':
      return <span className="qg-pn">{l.text || 'Product'}</span>
    case 'image':
      return <span className="qg-img">{l.flags?.includes('no-alt') ? 'no alt text' : l.text}</span>
    case 'video':
      return <span className="qg-img qg-vid">▶ {l.text}</span>
    case 'input':
      return <span className="qg-field">{l.text}</span>
    case 'button':
      return <span className="qg-btn">{l.text || '(no text)'}</span>
    case 'link':
      return <span className="qg-a">{l.text || '(no text)'}</span>
    case 'price':
      return <span className="qg-price">{l.text}</span>
    default:
      return <span className="qg-t">{l.text}</span>
  }
}
