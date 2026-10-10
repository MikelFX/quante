'use client'

// The Qads community wall: photos and videos people made with Qads and chose to share
// (/api/qads/community), filled with the seed media (content/qads/community-seed.ts). A sticky
// 3D stage driven by scroll (choreography in ./wall-math.ts): on arrival only the top of a curved,
// tilted strip shows below the composer, its edge dissolving into grain at the bottom of the
// screen; scrolling straightens it into a band, then the other pieces fly in from every direction
// and settle into three more rows. Videos play only while they are on stage (a few at a time).
// With animations off or reduced motion the finished wall is shown as is.

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMUNITY_SEED, type WallMedia } from '@/content/qads/community-seed'
import { fillWall, groupPose, landedAt, tilePose, wallLayout, ROWS, type WallLayout } from './wall-math'

const GRAIN = 130 // height of the dissolving band, px
const MAX_PLAYING = 6

export function QadsCommunityWall() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const planeRef = useRef<HTMLDivElement | null>(null)
  const tileRefs = useRef<(HTMLElement | null)[]>([])
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const [shared, setShared] = useState<WallMedia[]>([])
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [still, setStill] = useState(false)

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

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current
    const plane = planeRef.current
    if (!section || !stage || !plane || !layout || !tiles.length) return
    let raf = 0
    let active = false
    const playing = new Set<number>()
    const videos = videoRefs.current

    const frame = () => {
      raf = 0
      const W = window.innerWidth
      const H = window.innerHeight
      const rect = section.getBoundingClientRect()
      // q: 0 → 1 while the stage scrolls into view, 1 → 2 while it is pinned (wall-math.ts).
      const enter = Math.min(1, Math.max(0, 1 - rect.top / H))
      const pinned = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - H)))
      const q = still ? 2 : rect.top > 0 ? enter : 1 + pinned

      const g = groupPose(q, layout, H)
      plane.style.transform = `translate3d(0, ${g.y.toFixed(1)}px, 0) rotateX(${g.tilt.toFixed(2)}deg) scale(${g.scale.toFixed(4)})`

      // The grain band rides the bottom edge of the screen, then slides away once the wall opens.
      const visible = H - Math.max(0, rect.top)
      const reveal = still ? H + GRAIN : visible - GRAIN + Math.max(0, q - 1.05) * H * 2.2
      stage.style.setProperty('--qz-reveal', `${Math.min(H + GRAIN, reveal).toFixed(1)}px`)
      stage.style.setProperty('--qz-head', String(Math.min(1, Math.max(0, (q - 1.55) / 0.3))))

      const want: number[] = []
      for (let i = 0; i < tiles.length; i++) {
        const el = tileRefs.current[i]
        if (!el) continue
        const p = tilePose(i, layout, q, W, H)
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, ${p.z.toFixed(1)}px) rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg) rotateZ(${p.rz.toFixed(1)}deg) scale(${p.s.toFixed(3)})`
        el.style.opacity = p.o.toFixed(3)
        // A short mint pulse as a piece lands.
        const land = i < layout.cols ? 0 : Math.max(0, 1 - Math.abs(q - landedAt(i, layout)) / 0.05)
        el.style.setProperty('--qz-land', land.toFixed(2))
        // No autoplay with animations off or reduced motion: the videos rest on their posters.
        if (tiles[i].kind === 'video' && p.o > 0.85 && active && !still) want.push(i)
      }

      // Play a few distinct videos; everything else rests on its poster.
      const srcs = new Set<string>()
      const chosen = new Set<number>()
      for (const i of want) {
        if (chosen.size >= MAX_PLAYING) break
        if (srcs.has(tiles[i].src)) continue
        srcs.add(tiles[i].src)
        chosen.add(i)
      }
      for (const i of chosen) {
        if (playing.has(i)) continue
        const v = videoRefs.current[i]
        if (!v) continue
        v.preload = 'auto'
        v.play().then(() => playing.add(i)).catch(() => {})
      }
      for (const i of [...playing]) {
        if (chosen.has(i)) continue
        videoRefs.current[i]?.pause()
        playing.delete(i)
      }
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
    ? ({ '--qz-tw': `${layout.tileW}px`, '--qz-th': `${layout.tileH}px`, '--qz-grain': `${GRAIN}px` } as React.CSSProperties)
    : undefined

  return (
    <section ref={sectionRef} className={'qz-wall' + (still ? ' still' : '')} aria-labelledby="qz-wall-h" style={style}>
      <div ref={stageRef} className="qz-wall-stage">
        <header className="qz-wall-head">
          <p className="qz-wall-kicker">Community library</p>
          <h2 id="qz-wall-h">Made with Qads</h2>
          <p className="qz-wall-sub">Ads people made from a single product photo{shared.length ? ` — ${shared.length} shared so far` : ''}.</p>
        </header>
        <div ref={planeRef} className="qz-wall-plane">
          {tiles.map((m, i) => (
            <figure key={i} ref={(el) => { tileRefs.current[i] = el }} className="qz-wt" data-kind={m.kind}>
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
                  <img src={m.src} alt={m.label} loading="lazy" decoding="async" />
                )}
                <span className="qz-wt-idx" aria-hidden="true">#{String(i + 1).padStart(2, '0')}</span>
                <figcaption>{m.label}</figcaption>
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
