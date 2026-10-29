'use client'

// The Qads community wall: photos and videos people made with Qads and chose to share
// (/api/qads/community), filled with the seed media (content/qads/community-seed.ts). A sticky
// 3D stage driven by scroll (choreography in ./wall-math.ts): on arrival only the top of a curved,
// tilted strip shows below the composer, its edge dissolving into grain at the bottom of the
// screen; scrolling straightens it into a band, then the other pieces fly in from every direction
// and settle into three more rows. Videos play only while they are on stage (a few at a time).
// With animations off or reduced motion the finished wall is shown as is.
// Smooth on phones: the scene eases after the scroll position, pictures are fetched and decoded
// before the wall arrives, only transform/opacity change per frame, no video starts mid-flight.

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMUNITY_SEED, type WallMedia } from '@/content/qads/community-seed'
import { fillWall, followQ, grainCells, groupPose, inFlight, landedAt, tilePose, wallLayout, ROWS, type WallLayout } from './wall-math'

const GRAIN = 130 // height of the dissolving band, px
const GRAIN_TILE = 280 // width of one band tile (it repeats across), px
const GRAIN_CELL = 1 // one grain pixel, px
const MAX_PLAYING = 6

// The band's grain as a picture, drawn once: crisp cells at 3× so it stays sharp on phones.
function grainImage(): Promise<string | null> {
  const cols = GRAIN_TILE / GRAIN_CELL
  const rows = Math.round(GRAIN / GRAIN_CELL)
  const k = GRAIN_CELL * 3
  const canvas = document.createElement('canvas')
  canvas.width = cols * k
  canvas.height = rows * k
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  const cells = grainCells(cols, rows)
  ctx.fillStyle = '#000'
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cells[r * cols + c]) ctx.fillRect(c * k, r * k, k, k)
  return new Promise((done) => canvas.toBlob((b) => done(b ? URL.createObjectURL(b) : null)))
}

export function QadsCommunityWall() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const maskRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<HTMLDivElement | null>(null)
  const planeRef = useRef<HTMLDivElement | null>(null)
  const headRef = useRef<HTMLElement | null>(null)
  const tileRefs = useRef<(HTMLElement | null)[]>([])
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const glowRefs = useRef<(HTMLElement | null)[]>([])
  const [shared, setShared] = useState<WallMedia[]>([])
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [still, setStill] = useState(false)
  const [near, setNear] = useState(false)
  const [grain, setGrain] = useState<string | null>(null)

  useEffect(() => {
    if (still) return
    let off = false
    let url: string | null = null
    grainImage().then((u) => { url = u; if (off) { if (u) URL.revokeObjectURL(u) } else setGrain(u) }).catch(() => {})
    return () => { off = true; if (url) URL.revokeObjectURL(url) }
  }, [still])

  useEffect(() => {
    let off = false
    fetch('/api/qads/community')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: WallMedia[] } | null) => { if (!off && d?.items?.length) setShared(d.items) })
      .catch(() => {})
    return () => { off = true }
  }, [])

  // Layout follows the viewport; motion follows the site setting and the OS preference.
  useEffect(() => {
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => {
      setLayout(wallLayout(window.innerWidth, window.innerHeight))
      setStill(root.dataset.motion === 'off' || reduce.matches)
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ['data-motion'] })
    window.addEventListener('resize', read)
    reduce.addEventListener('change', read)
    return () => { obs.disconnect(); window.removeEventListener('resize', read); reduce.removeEventListener('change', read) }
  }, [])

  const tiles = useMemo(() => (layout ? fillWall(shared, COMMUNITY_SEED, layout.cols * ROWS, layout.cols) : []), [layout, shared])

  // Fetch and decode every picture well before the wall comes on screen, so no photo is still
  // loading (or decoding on the main thread) while it flies in.
  useEffect(() => {
    const section = sectionRef.current
    if (!section || near) return
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true) }, { rootMargin: '150% 0px' })
    io.observe(section)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    if (!near) return
    for (const el of planeRef.current?.querySelectorAll('img') ?? []) el.decode().catch(() => {})
  }, [near, tiles])

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current
    const mask = maskRef.current
    const view = viewRef.current
    const plane = planeRef.current
    if (!section || !stage || !mask || !view || !plane || !layout || !tiles.length) return
    let raf = 0
    let active = false
    let shown = -1
    let last = 0
    const playing = new Set<number>()
    const videos = videoRefs.current
    // Phones decode only a few videos at once without dropping frames.
    const maxPlaying = window.matchMedia('(pointer: coarse)').matches ? 3 : MAX_PLAYING
    // Only changed values are written: an unchanged style write still costs a style pass.
    const written = new WeakMap<HTMLElement, Record<string, string>>()
    const put = (el: HTMLElement, prop: string, value: string) => {
      let memo = written.get(el)
      if (!memo) written.set(el, (memo = {}))
      if (memo[prop] === value) return
      memo[prop] = value
      el.style.setProperty(prop, value)
    }

    const frame = (now: number) => {
      raf = 0
      const W = window.innerWidth
      const H = window.innerHeight
      const rect = section.getBoundingClientRect()
      // q: 0 → 1 while the stage scrolls into view, 1 → 2 while it is pinned (wall-math.ts).
      const enter = Math.min(1, Math.max(0, 1 - rect.top / H))
      const pinned = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - H)))
      const target = still ? 2 : rect.top > 0 ? enter : 1 + pinned
      // The scene eases after the scroll position instead of jumping with every scroll event.
      shown = shown < 0 || still || !active ? target : followQ(shown, target, Math.min(64, now - last))
      last = now
      const q = shown

      const head = headRef.current
      const g = groupPose(q, layout, H, head ? head.offsetTop + head.offsetHeight : undefined)
      put(plane, 'transform', `translate3d(0, ${g.y.toFixed(1)}px, 0) rotateX(${g.tilt.toFixed(2)}deg) scale(${g.scale.toFixed(4)})`)

      // The grain band rides the bottom edge of the screen, then slides away once the wall opens.
      // The mask itself never changes (changing its size re-rasterised it on every frame): the
      // masked layer moves instead and the scene inside moves back by the same amount, both plain
      // transforms. Fully open, the mask is dropped: a masked 3D scene is re-composited through
      // an offscreen surface on every frame.
      const stageH = stage.clientHeight
      const visible = H - Math.max(0, rect.top)
      const reveal = still ? stageH + GRAIN : visible - GRAIN + Math.max(0, q - 1.05) * H * 2.2
      const open = reveal >= stageH + GRAIN
      stage.classList.toggle('open', open)
      const shift = open ? 0 : reveal - stageH - GRAIN
      put(mask, 'transform', `translate3d(0, ${shift.toFixed(1)}px, 0)`)
      put(view, 'transform', `translate3d(0, ${(-shift).toFixed(1)}px, 0)`)
      if (head && !still) {
        const h = Math.min(1, Math.max(0, (q - 1.55) / 0.3))
        put(head, 'opacity', h.toFixed(3))
        put(head, 'transform', `translate3d(0, ${((1 - h) * 14).toFixed(1)}px, 0)`)
      }

      const want: number[] = []
      for (let i = 0; i < tiles.length; i++) {
        const el = tileRefs.current[i]
        if (!el) continue
        const p = tilePose(i, layout, q, W, H)
        put(el, 'transform', `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, ${p.z.toFixed(1)}px) rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg) rotateZ(${p.rz.toFixed(1)}deg) scale(${p.s.toFixed(3)})`)
        put(el, 'opacity', p.o.toFixed(3))
        // A short mint pulse as a piece lands — the glow is its own layer, only its opacity moves.
        const glow = glowRefs.current[i]
        if (glow) put(glow, 'opacity', still ? '0' : Math.max(0, 1 - Math.abs(q - landedAt(i, layout)) / 0.05).toFixed(2))
        // No autoplay with animations off or reduced motion: the videos rest on their posters.
        if (tiles[i].kind === 'video' && p.o > 0.85 && active && !still) want.push(i)
      }

      // Play a few distinct videos; everything else rests on its poster. None starts while the
      // tiles are flying in (starting a video costs main-thread and decoder time).
      const srcs = new Set<string>()
      const chosen = new Set<number>()
      for (const i of want) {
        if (chosen.size >= maxPlaying) break
        if (srcs.has(tiles[i].src)) continue
        if (!playing.has(i) && inFlight(q)) continue
        srcs.add(tiles[i].src)
        chosen.add(i)
      }
      for (const i of chosen) {
        if (playing.has(i)) continue
        const v = videoRefs.current[i]
        if (!v) continue
        v.preload = 'auto'
        playing.add(i)
        v.play().catch(() => playing.delete(i))
      }
      for (const i of [...playing]) {
        if (chosen.has(i)) continue
        videoRefs.current[i]?.pause()
        playing.delete(i)
      }

      if (shown !== target) schedule()
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(frame) }

    const io = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting
      schedule()
    }, { rootMargin: '200px 0px' })
    io.observe(section)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      for (const v of videos) v?.pause()
    }
  }, [layout, tiles, still])

  const style = layout
    ? ({
        '--qz-tw': `${layout.tileW}px`,
        '--qz-th': `${layout.tileH}px`,
        '--qz-grain': `${GRAIN}px`,
        '--qz-grain-w': `${GRAIN_TILE}px`,
        ...(grain ? { '--qz-grain-img': `url("${grain}")` } : {}),
      } as React.CSSProperties)
    : undefined

  return (
    <section ref={sectionRef} className={'qz-wall' + (still ? ' still' : '')} aria-labelledby="qz-wall-h" style={style}>
      <div ref={stageRef} className="qz-wall-stage">
        <header ref={headRef} className="qz-wall-head">
          <p className="qz-wall-kicker">Community library</p>
          <h2 id="qz-wall-h">Made with Qads</h2>
          <p className="qz-wall-sub">Ads people made from a single product photo{shared.length ? ` — ${shared.length} shared so far` : ''}.</p>
        </header>
        <div ref={maskRef} className="qz-wall-mask">
          <div ref={viewRef} className="qz-wall-view">
            <div ref={planeRef} className="qz-wall-plane">
              {tiles.map((m, i) => (
                <figure key={i} ref={(el) => { tileRefs.current[i] = el }} className="qz-wt" data-kind={m.kind}>
                  {layout && i >= layout.cols && <span ref={(el) => { glowRefs.current[i] = el }} className="qz-wt-glow" aria-hidden="true" />}
                  <div className="qz-wt-in">
                    {m.kind === 'video' ? (
                      <video
                        ref={(el) => { videoRefs.current[i] = el }}
                        src={m.src}
                        poster={m.poster}
                        muted
                        loop
                        playsInline
                        preload={m.poster ? 'none' : 'metadata'}
                        aria-label={m.label}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- remote signed URLs and seed WebPs, sized by the tile
                      <img src={m.src} alt={m.label} loading={near ? 'eager' : 'lazy'} decoding="async" />
                    )}
                    <span className="qz-wt-idx" aria-hidden="true">#{String(i + 1).padStart(2, '0')}</span>
                    <figcaption>{m.label}</figcaption>
                  </div>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
