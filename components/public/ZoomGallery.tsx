'use client'

import { useEffect, useRef } from 'react'

// One store, one persistent browser-chrome frame — the visual never swaps to
// a different card. Scroll drives a continuous pan+zoom of the inner canvas
// down through stacked page "regions" (home → product → checkout), so it
// reads as a single camera push deeper into one store's flow, never a
// slideshow of separate stores swapping in and out. Alongside it the chat
// log only ever APPENDS: each region crossed reveals one more prompt/reply
// pair, and earlier pairs stay put — a growing transcript, never content
// that swaps or slides away. Ported from mockups/redesign-r4-features-grid.html.
//
// Content is deliberately generic/stylized for this first pass — no real
// store screenshots yet (per user decision, dolpra.stores.quantecode.com
// and friends come later). Chrome bar shows a placeholder subdomain.

const REGIONS = [
  { key: 'home', label: 'home' },
  { key: 'product', label: 'product page' },
  { key: 'checkout', label: 'checkout' },
] as const

const PAIRS = [
  { me: 'Minimal store for a candle brand, warm neutral palette.', reply: "Done — your store is live." },
  { me: 'Make me a full product page for this product.', reply: 'Done — product page is live, with a gallery and description.' },
  { me: 'Now add a checkout page with an order summary.', reply: 'Done — checkout with Stripe payment is set up.' },
]

export function ZoomGallery() {
  const trackRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const regionRefs = useRef<(HTMLDivElement | null)[]>([])
  const labelRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const runnerRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([])
  const pairRefs = useRef<(HTMLDivElement | null)[]>([])
  const chatLogRef = useRef<HTMLDivElement>(null)
  const lastRegionIndex = useRef(-1)

  useEffect(() => {
    const track = trackRef.current
    const sticky = stickyRef.current
    const canvas = canvasRef.current
    if (!track || !sticky || !canvas) return

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    const lastIndex = REGIONS.length - 1

    // Geometry cache: stickyTopOffset/scrollableRange/regionH only change on
    // resize or content reflow (webfont load, etc.), never from scrolling
    // itself — yet the old version re-read all three (via getComputedStyle +
    // two offsetHeight reads, each a forced synchronous layout) on every
    // single scroll-driven update(), on top of the one read that IS
    // genuinely scroll-dependent (track.getBoundingClientRect()). That's 4
    // forced layout reads/frame where only 1 is necessary — cheap on a
    // desktop but a real source of scroll jank on mobile CPUs, and the
    // direct cause of the "scroll-linked text doesn't track smoothly"
    // report: the pan/zoom + chat-reveal are driven by this same per-frame
    // math, so extra layout cost here shows up as visible stutter there.
    // recomputeGeometry() runs once up front and again on resize/settle —
    // update() itself now only does the one read it actually needs.
    let stickyTopOffset = 0
    let scrollableRange = 0
    let regionH = 342
    function recomputeGeometry() {
      if (!track || !sticky) return
      stickyTopOffset = parseInt(getComputedStyle(sticky).top, 10) || 0
      scrollableRange = track.offsetHeight - sticky.offsetHeight
      const region0 = regionRefs.current[0]
      regionH = region0 ? region0.offsetHeight : 342
    }

    function update() {
      if (!track || !sticky || !canvas) return
      const rect = track.getBoundingClientRect()
      let raw = -rect.top / (scrollableRange - stickyTopOffset)
      raw = clamp01(raw)

      const progress = raw * lastIndex

      const localT = progress - Math.floor(progress)
      const zoomPulse = Math.sin(localT * Math.PI) * 0.035
      canvas.style.transform = `translateY(${-progress * regionH}px) scale(${1 + zoomPulse})`

      const nearest = Math.round(progress)
      if (nearest !== lastRegionIndex.current) {
        lastRegionIndex.current = nearest
        pairRefs.current.forEach((el, i) => {
          if (el && i <= nearest) el.classList.add('qp-shown')
        })
        if (labelRef.current) labelRef.current.textContent = REGIONS[nearest]?.label ?? REGIONS[0].label
        chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: 'smooth' })
      }

      if (fillRef.current) fillRef.current.style.width = raw * 100 + '%'
      if (runnerRef.current) runnerRef.current.style.left = (progress / lastIndex) * 100 + '%'
      dotsRef.current.forEach((el, i) => el?.classList.toggle('qp-active', nearest === i))

      // Widened from 0.86-1.0 to 0.7-1.0 and made deeper (was -8px/0.97 scale/
      // opacity floor 0.88) so the pinned card visibly wipes away as raw
      // approaches 1, instead of sitting on screen at ~full size/opacity
      // (previously only faded 12%) for the whole tail of the scroll-jacked
      // track — that frozen-looking tail was the "dead black stretch" found
      // in the full-site audit. Track height was also cut 190vh -> 145vh
      // (see globals.css) so there's less unaccounted-for scroll distance
      // after raw clamps to 1 in the first place.
      const exitT = raw > 0.7 ? clamp01((raw - 0.7) / 0.3) : 0
      sticky.style.transform = `translateY(${exitT * -28}px) scale(${1 - exitT * 0.08})`
      sticky.style.opacity = String(1 - exitT * 0.85)
    }

    // Ticking guard: without it, a burst of scroll events inside one frame
    // (common on mobile — touch-driven scroll can fire more scroll events
    // than there are frames) queues one requestAnimationFrame per event, and
    // they all run back-to-back once the frame is free, doing the same
    // layout-read + style-write work multiple times for no visual benefit.
    // At most one update() is now in flight per frame.
    let ticking = false
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => { update(); ticking = false })
    }
    function onResize() {
      recomputeGeometry()
      update()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    recomputeGeometry()
    update()
    // Geometry (sticky.offsetHeight / track.offsetHeight) can still be off on
    // first paint if webfonts or the region content reflow after mount —
    // recompute once shortly after so `raw`'s clamp point actually lines up
    // with the container's real bottom edge instead of drifting, which was
    // part of what made the pinned tail feel longer than intended.
    const settleTimer = window.setTimeout(() => { recomputeGeometry(); update() }, 400)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.clearTimeout(settleTimer)
    }
  }, [])

  return (
    <div className="qp-gallery-track" ref={trackRef}>
      <div className="qp-gallery-sticky" ref={stickyRef}>
        <div className="qp-gallery-progress"><div className="qp-fill" ref={fillRef} /></div>
        <div className="qp-gallery-grid">

          <div className="qp-zoom-viewport">
            <div className="qp-zv-bar">
              <span /><span /><span />
              <span className="qp-zv-name">yourstore.stores.quantecode.com</span>
            </div>
            <div className="qp-zoom-page-label" ref={labelRef}>home</div>
            <div className="qp-zoom-window">
              <div className="qp-zoom-canvas" ref={canvasRef}>
                <div className="qp-zoom-region" ref={(el) => { regionRefs.current[0] = el }}>
                  <div className="qp-zr-hero" />
                  <div className="qp-zr-row qp-w70" />
                  <div className="qp-zr-row qp-w40" />
                  <div className="qp-zr-cardgrid"><div /><div /><div /></div>
                </div>
                <div className="qp-zoom-region" ref={(el) => { regionRefs.current[1] = el }}>
                  <div className="qp-zr-row qp-w40" />
                  <div className="qp-zr-hero" style={{ height: 130 }} />
                  <div className="qp-zr-row qp-w70" />
                  <div className="qp-zr-row qp-w40" />
                  <span className="qp-zr-pill">Add to cart</span>
                </div>
                <div className="qp-zoom-region" ref={(el) => { regionRefs.current[2] = el }}>
                  <div className="qp-zr-row qp-w40" />
                  <div className="qp-zr-form" />
                  <div className="qp-zr-form" />
                  <div className="qp-zr-form" style={{ width: '60%' }} />
                  <div className="qp-zr-summary">
                    <div className="qp-zr-row qp-w70" />
                    <div className="qp-zr-row qp-w40" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="qp-chat-log" ref={chatLogRef}>
            {PAIRS.map((p, i) => (
              <div
                key={p.me}
                className={`qp-chat-pair${i === 0 ? ' qp-shown' : ''}`}
                ref={(el) => { pairRefs.current[i] = el }}
              >
                <div className="qp-bubble qp-me">{p.me}</div>
                <div className="qp-bubble">{p.reply}</div>
              </div>
            ))}
          </div>

        </div>
        <div className="qp-gallery-dots-wrap">
          <div className="qp-gallery-dots-line" />
          <div className="qp-gallery-dots">
            {REGIONS.map((r, i) => (
              <span key={r.key} className={i === 0 ? 'qp-active' : ''} ref={(el) => { dotsRef.current[i] = el }} />
            ))}
            {/* Nested inside .qp-gallery-dots (not -wrap) on purpose: this flex
                row is exactly the padded-in track the dots sit on, so the
                runner's JS-driven `left: X%` (in update()) resolves against
                the same box the dots use. When it lived directly under
                .qp-gallery-dots-wrap, its 0%/100% were measured against the
                wrap's un-padded border box while the dots' 0%/100% were
                measured after the wrap's 20%/40% padding — two different
                coordinate systems — so the glowing runner drifted away from
                the actual active dot instead of sitting on top of it
                (visible on mobile as a stray extra "dot" near the left edge). */}
            <div className="qp-gallery-dot-runner" ref={runnerRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
