'use client'

// The build stage on /qgent: the 20 agents assemble the new store in front of the merchant. The
// storefront is drawn as its parts (BUILD_PARTS); a part is "building" while the generation is
// writing a file for it and "done" once such a file is complete (status poll filesDone / writingAll,
// lib/qgent/swarm/build.ts). The generation writes the pages side by side (lib/generation/parallel.ts),
// so several parts build at once. Each part has its own agents; every agent moves on its own clock
// while its part is building and rests beside it when it is done. Real content from the scan (brand, products and their photos — our own
// copies in store-assets) fills the parts as they finish; the old site is never loaded.

import { useEffect, useMemo, useRef, useState } from 'react'
import { SWARM_AGENTS, agentIndex } from '@/lib/qgent/swarm/agents'
import { BUILD_PARTS, buildParts, type PartId, type PartState } from '@/lib/qgent/swarm/build'
import { swarmCircle } from '@/lib/qgent/swarm/stage'
import { AgentCursor, AgentDot } from './AgentCursor'
import { stillMotion } from './SwarmStage'

export interface BuildInfo {
  brand: string
  tagline: string
  colors: string[]
  products: Array<{ name: string; price: string; image: string | null }>
}

interface Props {
  /** null while the old store is being read */
  info: BuildInfo | null
  filesDone: string[]
  /** every file being written right now (several at once in the parallel build) */
  writing: string[]
  finished: boolean
  statusText: string
  accepted: number
}

const N = SWARM_AGENTS.length

export function BuildStage({ info, filesDone, writing, finished, statusText, accepted }: Props) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const docRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState(() => swarmCircle(N, 300, 220, 90))
  const [still] = useState(stillMotion)
  const parts = useMemo(() => buildParts(filesDone, writing, finished), [filesDone, writing, finished])
  const state = useMemo(() => new Map<PartId, PartState>(parts.map((p) => [p.id, p])), [parts])
  const done = parts.filter((p) => p.state === 'done').length
  const buildingParts = parts.filter((p) => p.state === 'building')
  // the topmost part being built: the view follows it
  const building = buildingParts[0]?.id ?? null
  const nextMove = useRef<number[]>([])

  // follow the topmost part being built
  useEffect(() => {
    if (!building || !docRef.current || !viewRef.current) return
    const el = docRef.current.querySelector<HTMLElement>(`[data-part="${building}"]`)
    if (!el) return
    viewRef.current.scrollTo({ top: Math.max(0, el.offsetTop - 40), behavior: still ? 'auto' : 'smooth' })
  }, [building, still])

  // agents: circle while reading, then each works on / rests at its part
  useEffect(() => {
    const place = () => {
      const doc = docRef.current
      const view = viewRef.current
      if (!info || !doc) {
        const w = view?.clientWidth ?? 600
        const h = view?.clientHeight ?? 440
        const t = performance.now() / 900
        setPos(swarmCircle(N, w / 2 - 8, h / 2 - 10, Math.min(110, w / 4)).map((p, i) => ({ x: p.x + Math.cos(t + i) * 10, y: p.y + Math.sin(t * 1.3 + i) * 10 })))
        return
      }
      const d = doc.getBoundingClientRect()
      const now = performance.now()
      setPos((prev) => SWARM_AGENTS.map((a, i) => {
        const part = BUILD_PARTS.find((p) => p.agents.includes(a.id))!
        const el = doc.querySelector<HTMLElement>(`[data-part="${part.id}"]`)
        if (!el) return prev[i]
        // every agent on its own clock, so the swarm never moves in lockstep
        if (!still && prev[i] && now < (nextMove.current[i] ?? 0)) return prev[i]
        nextMove.current[i] = now + 600 + Math.random() * 1100
        const r = el.getBoundingClientRect()
        const x0 = r.left - d.left
        const y0 = r.top - d.top
        const s = state.get(part.id)?.state
        const k = part.agents.indexOf(a.id)
        if (s === 'building') return { x: x0 + 14 + Math.random() * Math.max(20, r.width - 120), y: y0 + 12 + Math.random() * Math.max(10, r.height - 30) }
        if (s === 'done') return { x: x0 + r.width - 70 - k * 64, y: y0 - 8 }
        return { x: x0 + 14 + k * 64, y: y0 + r.height / 2 - 8 }
      }))
    }
    place()
    if (still) return
    const t = window.setInterval(place, info ? 250 : 600)
    return () => window.clearInterval(t)
  }, [info, state, still])

  const accent = info?.colors[0]
  const themed = state.get('theme')?.state === 'done' && accent
  const writers = buildingParts.map((p) => SWARM_AGENTS[agentIndex(BUILD_PARTS.find((b) => b.id === p.id)!.agents[0])]?.name).filter(Boolean)
  const files = writing.map((w) => w.split('/').pop())
  const writingLine = !writing.length
    ? null
    : writing.length === 1
      ? `${writers[0] ?? 'Agent'} is writing ${files[0]}`
      : `${writers.slice(0, 2).join(', ')}${writers.length > 2 ? ` +${writers.length - 2}` : ''} · ${files.length} files at once: ${files.join(', ')}`

  const part = (id: PartId, children: React.ReactNode, cls = '') => {
    const s = state.get(id)?.state ?? 'waiting'
    const meta = BUILD_PARTS.find((p) => p.id === id)!
    return (
      <section key={id} data-part={id} data-state={s} className={`qg-part qg-p-${id}${cls}`}>
        <span className="qg-part-k">
          {meta.agents.map((a) => <AgentDot key={a} index={agentIndex(a)} />)}
          {meta.label}
          <em>{s === 'done' ? 'done' : s === 'building' ? 'building…' : 'waiting'}</em>
        </span>
        <div className="qg-part-b">{children}</div>
      </section>
    )
  }

  const products = info?.products.length ? info.products.slice(0, 8) : Array.from({ length: 4 }, () => ({ name: '', price: '', image: null }))

  return (
    <div className="qg-stage qg-build" data-phase={finished ? 'done' : info ? 'build' : 'wait'}>
      <div className="qg-chrome">
        <span className="qg-lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="qg-url">{info ? `new store · ${info.brand}` : 'reading your old store…'}</span>
      </div>
      <div className="qg-view" ref={viewRef}>
        <div className="qg-doc qg-shop" ref={docRef} style={themed ? ({ '--qg-brand': accent } as React.CSSProperties) : undefined}>
          {info ? (
            <>
              {part('theme', <div className="qg-swatches">{(info.colors.length ? info.colors.slice(0, 5) : [null, null, null]).map((c, i) => <span key={i} style={c ? { background: c } : undefined} />)}<i>Aa</i></div>)}
              {part('nav', <div className="qg-navbar"><b>{info.brand}</b><span /><span /><span /><span className="qg-cart" /></div>)}
              {part('hero', <div className="qg-hero"><h3>{info.tagline || info.brand}</h3><p /><p className="short" /><span className="qg-cta" /></div>)}
              {part('values', <div className="qg-values"><span /><span /><span /></div>)}
              {part('products', (
                <div className="qg-grid">
                  {products.map((p, i) => (
                    <figure key={i}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <span className="qg-ph">{p.image ? <img src={p.image} alt="" loading="lazy" /> : null}</span>
                      <figcaption>{p.name || ' '}<b>{p.price}</b></figcaption>
                    </figure>
                  ))}
                </div>
              ))}
              {part('story', (
                <div className="qg-story">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="qg-ph">{products[1]?.image ? <img src={products[1].image} alt="" loading="lazy" /> : null}</span>
                  <div><p /><p /><p className="short" /></div>
                </div>
              ))}
              {part('detail', (
                <div className="qg-detail">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="qg-ph">{products[0]?.image ? <img src={products[0].image} alt="" loading="lazy" /> : null}</span>
                  <div><h4>{products[0]?.name || ' '}</h4><b>{products[0]?.price}</b><p /><p className="short" /><span className="qg-cta" /></div>
                </div>
              ))}
              {part('collection', <div className="qg-chips"><span /><span /><span /><span /></div>)}
              {part('footer', <div className="qg-foot"><div><b>{info.brand}</b><p /></div><div><p /><p /><p /></div><div><p /><p /></div></div>)}
              {part('pages', <div className="qg-chips"><span /><span /></div>, ' qg-small')}
            </>
          ) : (
            <div className="qg-wait" />
          )}
          {SWARM_AGENTS.map((a, i) => (
            <AgentCursor key={a.id} index={i} name={a.name} x={pos[i]?.x ?? 0} y={pos[i]?.y ?? 0} busy={!!info && state.get(BUILD_PARTS.find((p) => p.agents.includes(a.id))!.id)?.state === 'building'} hidden={still && !!info} />
          ))}
        </div>
      </div>
      <div className="qg-bar" role="status" aria-live="polite">
        <span className="qg-dots" aria-hidden="true">{SWARM_AGENTS.slice(0, 5).map((a, i) => <AgentDot key={a.id} index={i} />)}</span>
        <b>{N} agents</b>
        <span className="qg-count">{info ? `${done} / ${parts.length} parts${buildingParts.length > 1 && !finished ? ` · ${buildingParts.length} building` : ''}` : statusText}</span>
        <span className="qg-prog" aria-hidden="true"><i style={{ width: `${Math.round((done / parts.length) * 100)}%` }} /></span>
        <span className="qg-count qg-writing">
          {finished ? 'built' : writingLine ?? (info ? statusText : accepted ? `${accepted} accepted changes go in` : '')}
        </span>
      </div>
    </div>
  )
}
