'use client'

import { useEffect, useRef, useState } from 'react'
import { delay, useMotionAllowed } from '@ad/ui'
import { arcPath, finalText, moveMs, type CursorEditScript, type QditScript, type QgentScript } from './cursor-edit-script'

/*
 * The hero headline + lead of /quante/qdit and /quante/qgent, with a visitor's mouse cursor that
 * edits them on arrival:
 *   Qdit  — double-clicks the misspelt headline and retypes it, then drags over a phrase of the
 *           lead and gives it the accent colour from a small toolbar (what the editor really does).
 *   Qgent — Qgent scans the text and proposes the missing half of the lead; the cursor confirms it
 *           and the text types in (nothing changes without a confirmation, as in the product).
 *
 * The real copy is always in the DOM (.ce-f): search engines and screen readers read it, and it is
 * what shows without JavaScript, with reduced motion or with animations off. The animated layer
 * (.ce-a, aria-hidden) draws its letters with ::before { content: attr(data-t) }, so the draft
 * spellings are never page text. Movement is Web Animations on transform/opacity only; typing is a
 * handful of React updates; when the script ends nothing keeps running. Styles: cursor-edit.css.
 */

type Pt = { x: number; y: number }
type St = {
  /** the animation layer is shown (the server renders it on; we drop it once done / not allowed) */
  run: boolean
  // qdit
  slot: string
  slotSel: boolean
  caretT: boolean
  phSel: boolean
  phMark: boolean
  // qgent
  typed: number
  dot: boolean
  caretL: boolean
  fresh: boolean
}

class Stop extends Error {}

export function CursorEdit({ name, script }: { name: string; script: CursorEditScript }) {
  const allowed = useMotionAllowed()
  const fin = finalText(script)
  const [st, setSt] = useState<St>(() => ({
    run: true,
    slot: script.kind === 'qdit' ? script.title.typo : '',
    slotSel: false,
    caretT: false,
    phSel: false,
    phMark: false,
    typed: 0,
    dot: true,
    caretL: false,
    fresh: false,
  }))
  const set = (p: Partial<St>) => setSt((s) => ({ ...s, ...p }))

  const stage = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLSpanElement>(null)
  const slot = useRef<HTMLSpanElement>(null)
  const lead = useRef<HTMLSpanElement>(null)
  const phrase = useRef<HTMLSpanElement>(null)
  const caretL = useRef<HTMLElement>(null)
  const cur = useRef<HTMLDivElement>(null)
  const ptr = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const tool = useRef<HTMLDivElement>(null)
  const swatch = useRef<HTMLSpanElement>(null)
  const scan = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const apply = useRef<HTMLSpanElement>(null)
  const chip = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!allowed || done.current) {
      done.current = true
      set({ run: false })
      return
    }

    let dead = false
    let cancelled = false // unmount / re-run: the next effect decides what shows
    const timers = new Set<number>()
    const anims = new Set<Animation>()
    const kill = () => {
      dead = true
      timers.forEach((t) => window.clearTimeout(t))
      anims.forEach((a) => a.cancel())
    }
    const sleep = (ms: number) => new Promise<void>((res, rej) => {
      if (dead) return rej(new Stop())
      const t = window.setTimeout(() => { timers.delete(t); if (dead) rej(new Stop()); else res() }, ms)
      timers.add(t)
    })
    const anim = (el: Element | null, kf: Keyframe[], o: KeyframeAnimationOptions) => {
      if (!el || dead) return Promise.reject(new Stop())
      const a = el.animate(kf, { fill: 'forwards', ...o })
      anims.add(a)
      return a.finished.then(() => { if (dead) throw new Stop() }, () => { throw new Stop() })
    }
    const show = (el: HTMLElement | null, on: boolean, ms = 260, rise = 6) =>
      anim(el, on
        ? [{ opacity: 0, transform: `translateY(${rise}px) scale(.97)` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-rise / 2}px) scale(.98)` }],
      { duration: ms, easing: on ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in' })

    // geometry, always relative to the stage (so page scroll mid-move doesn't matter)
    const base = () => stage.current!.getBoundingClientRect()
    const rel = (r: DOMRect) => { const b = base(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height } }
    const box = (el: Element | null) => rel(el!.getBoundingClientRect())
    const place = (el: HTMLElement | null, x: number, y: number, w?: number, h?: number) => {
      if (!el) return
      el.style.left = `${Math.round(x)}px`
      el.style.top = `${Math.round(y)}px`
      if (w !== undefined) el.style.width = `${Math.round(w)}px`
      if (h !== undefined) el.style.height = `${Math.round(h)}px`
    }

    let at: Pt = { x: 0, y: 0 }
    const tf = (p: Pt) => `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`
    const jump = (p: Pt) => { at = p; cur.current!.style.transform = tf(p) }
    const move = (to: Pt, opts: { ms?: number; bow?: number } = {}) => {
      const d = Math.hypot(to.x - at.x, to.y - at.y)
      const pts = arcPath(at, to, opts.bow ?? 0.16)
      at = to
      return anim(cur.current, pts.map((p) => ({ transform: tf(p) })), { duration: opts.ms ?? moveMs(d), easing: 'linear' })
    }
    const cursorIn = () => anim(cur.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' })
    const cursorOut = () => anim(cur.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-in' })
    const beam = (on: boolean) => cur.current?.classList.toggle('is-text', on)
    const click = async () => {
      anim(ring.current, [{ opacity: .7, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' }).catch(() => {})
      await anim(ptr.current, [{ transform: 'scale(1)' }, { transform: 'scale(.8)', offset: .4 }, { transform: 'scale(1)' }], { duration: 190, easing: 'ease-out' })
    }

    const waitStart = async () => {
      // the headline's own reveal runs for ~1 s; fonts decide where the letters are
      await Promise.all([sleep(950), document.fonts?.ready.catch(() => {})])
      while (document.hidden) await sleep(250)
      const b = base()
      if (b.bottom < 0 || b.top > window.innerHeight) throw new Stop() // arrived scrolled away
    }

    async function qdit(s: QditScript) {
      const W = base().width
      // in from the lower right, as if the visitor's hand came from the demo below
      jump({ x: Math.min(W - 52, box(title.current).x + box(title.current).w + 180), y: box(lead.current).y + box(lead.current).h + 40 })
      cursorIn().catch(() => {})
      const tb = box(title.current)
      const pad = Math.max(10, Math.min(16, tb.h * 0.14))
      place(frame.current, tb.x - pad, tb.y - pad, tb.w + pad * 2, tb.h + pad * 2)
      const sb = box(slot.current)
      await move({ x: sb.x + sb.w * 0.55, y: sb.y + sb.h * 0.55 })
      beam(true)
      frame.current!.classList.add('is-on')
      await show(frame.current, true, 300, 0)
      await sleep(260)
      // double-click selects the two swapped letters
      await click(); await sleep(70); await click()
      set({ slotSel: true })
      await sleep(520)
      set({ slot: '', slotSel: false, caretT: true })
      await sleep(240)
      set({ slot: s.title.fix[0] })
      await sleep(170)
      set({ slot: s.title.fix })
      await sleep(420)
      frame.current!.classList.add('is-ok')
      await sleep(620)
      set({ caretT: false })
      show(frame.current, false, 320, 0).catch(() => {})

      // drag across the phrase of the lead
      const rs = phrase.current!.getClientRects()
      const b = base()
      const first = rs[0], last = rs[rs.length - 1]
      const a0 = { x: first.left - b.left + 1, y: first.top - b.top + first.height * 0.55 }
      const a1 = { x: last.right - b.left - 1, y: last.top - b.top + last.height * 0.55 }
      await move(a0, { bow: -0.12 })
      await sleep(140)
      await anim(ptr.current, [{ transform: 'scale(1)' }, { transform: 'scale(.86)' }], { duration: 110, easing: 'ease-out' })
      set({ phSel: true })
      await move(a1, { ms: 560, bow: rs.length > 1 ? 0.05 : 0 })
      await anim(ptr.current, [{ transform: 'scale(.86)' }, { transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' })
      beam(false)

      // the colour toolbar pops above the selection
      const pr = box(phrase.current)
      const tw = tool.current!.offsetWidth
      const tx = Math.max(0, Math.min(W - tw, a0.x + (rs.length > 1 ? 0 : (a1.x - a0.x) / 2 - tw / 2)))
      place(tool.current, tx, pr.y + pr.h + 10) // under the selection, like a text editor's bubble
      await show(tool.current, true, 280, -8)
      const sw = box(swatch.current)
      await move({ x: sw.x + sw.w / 2, y: sw.y + sw.h / 2 }, { bow: 0.25 })
      await sleep(120)
      await click()
      swatch.current!.classList.add('is-on')
      set({ phMark: true, phSel: false })
      await sleep(380)
      show(tool.current, false, 260, -8).catch(() => {})
      await sleep(260)
      await Promise.all([move({ x: at.x + 46, y: at.y + 58 }, { ms: 620 }), sleep(180).then(cursorOut)])
    }

    async function qgent(s: QgentScript) {
      const W = base().width
      // Qgent reads the text: a scan line runs down over headline and lead
      const tb = box(title.current), lb = box(lead.current)
      const top = tb.y - 6, bottom = lb.y + lb.h + 6
      place(scan.current, 0, top, W)
      await anim(scan.current, [
        { opacity: 0, transform: 'translateY(0)' },
        { opacity: 1, transform: `translateY(${(bottom - top) * 0.12}px)`, offset: 0.12 },
        { opacity: 1, transform: `translateY(${(bottom - top) * 0.88}px)`, offset: 0.88 },
        { opacity: 0, transform: `translateY(${bottom - top}px)` },
      ], { duration: 1150, easing: 'cubic-bezier(.45,0,.35,1)' })

      // a finding pinned where the lead stops short
      const c = box(caretL.current)
      place(pin.current, c.x + 6, c.y + c.h / 2 - 11)
      await show(pin.current, true, 260, 0)
      await sleep(240)
      const cw = Math.min(360, W)
      place(card.current, Math.max(0, Math.min(W - cw, c.x - cw * 0.35)), lb.y + lb.h + 14, cw)
      await show(card.current, true, 340, 10)

      // the visitor's cursor comes in and confirms
      const ab = box(apply.current)
      jump({ x: Math.min(W - 52, ab.x + ab.w + 120), y: ab.y + ab.h + 90 })
      cursorIn().catch(() => {})
      await move({ x: ab.x + ab.w * 0.5, y: ab.y + ab.h * 0.55 })
      apply.current!.classList.add('is-hover')
      await sleep(300)
      await click()
      apply.current!.classList.add('is-down')
      await sleep(160)
      show(card.current, false, 260, 10).catch(() => {})
      show(pin.current, false, 200, 0).catch(() => {})
      Promise.all([move({ x: at.x + 40, y: at.y + 50 }, { ms: 600 }), sleep(150).then(cursorOut)]).catch(() => {})

      // the proposal types in where the draft stopped
      set({ dot: false, caretL: true, fresh: true })
      const n = s.lead.added.length
      for (let i = 1; i <= n; i++) {
        set({ typed: i })
        const ch = s.lead.added[i - 1]
        await sleep(ch === ',' ? 120 : ch === ' ' ? 34 : 22 + ((i * 7) % 5) * 4)
      }
      await sleep(260)
      set({ caretL: false })
      const e = box(caretL.current)
      const chw = chip.current!.offsetWidth
      place(chip.current, Math.max(0, Math.min(W - chw, e.x - chw / 2)), e.y + e.h + 10)
      await show(chip.current, true, 280, 6)
      await sleep(500)
      set({ fresh: false })
      await sleep(1500)
      await show(chip.current, false, 300, 6)
    }

    let w0 = window.innerWidth
    const onResize = () => { if (Math.abs(window.innerWidth - w0) > 40) kill(); w0 = window.innerWidth }
    window.addEventListener('resize', onResize)

    ;(async () => {
      try {
        await waitStart()
        if (script.kind === 'qdit') await qdit(script)
        else await qgent(script)
      } catch (e) {
        if (!(e instanceof Stop)) console.error(e)
      } finally {
        kill()
        if (!cancelled) {
          done.current = true
          set({ run: false })
        }
      }
    })()

    return () => { cancelled = true; window.removeEventListener('resize', onResize); kill() }
    // the script runs once per page view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])

  const added = script.kind === 'qgent' ? script.lead.added : ''

  return (
    <div className="ce" ref={stage} data-run={st.run ? '' : undefined} data-kind={script.kind}>
      {script.kind === 'qdit' ? (
        <h1 className="h2 ttl">
          <span className="ce-f">{fin.title}</span>
          <span className="ce-a" aria-hidden="true" ref={title}>
            <span data-t={script.title.keep} />
            <span ref={slot} className={st.slotSel ? 'ce-slot is-sel' : 'ce-slot'} data-t={st.slot} />
            {st.caretT && <i className="ce-caret" />}
          </span>
        </h1>
      ) : (
        <h1 className="h2 ttl"><span ref={title}>{name}</span></h1>
      )}

      <p className="sub rv" style={delay(0.1)}>
        <span className="ce-f">
          {script.kind === 'qdit'
            ? <>{script.lead.before}<span className="ce-mark">{script.lead.phrase}</span>{script.lead.after}</>
            : fin.lead}
        </span>
        <span className="ce-a" aria-hidden="true" ref={lead}>
          {script.kind === 'qdit' ? (
            <>
              <span data-t={script.lead.before} />
              <span
                ref={phrase}
                className={['ce-ph', st.phSel && 'is-sel', st.phMark && 'ce-mark'].filter(Boolean).join(' ')}
                data-t={script.lead.phrase}
              />
              <span data-t={script.lead.after} />
            </>
          ) : (
            <>
              <span data-t={script.lead.kept} />
              {st.dot && <span data-t={script.lead.draftEnd} />}
              <span className={st.fresh ? 'ce-new is-fresh' : 'ce-new'} data-t={added.slice(0, st.typed)} />
              <i ref={caretL} className={st.caretL ? 'ce-caret' : 'ce-caret is-off'} />
              <span className="ce-ghost" data-t={added.slice(st.typed)} />
            </>
          )}
        </span>
      </p>

      {st.run && (
        <div className="ce-layer" aria-hidden="true">
          {script.kind === 'qdit' ? (
            <>
              <div ref={frame} className="ce-frame"><span className="ce-tag"><span className="ce-t1"><b>H1</b> Nadpis</span><em>✓ Upraveno</em></span></div>
              <div ref={tool} className="ce-tool glass">
                <span className="ce-tl">Barva</span>
                <span className="ce-sw" style={{ background: 'var(--fg)' }} />
                <span ref={swatch} className="ce-sw" style={{ background: 'var(--acc)' }} />
                <span className="ce-sw" style={{ background: 'var(--acc2)' }} />
                <span className="ce-sw" style={{ background: 'var(--acc3)' }} />
              </div>
            </>
          ) : (
            <>
              <div ref={scan} className="ce-scan" />
              <div ref={pin} className="ce-pin">1</div>
              <div ref={card} className="ce-card glass">
                <div className="ce-ch"><i />Qgent · návrh 1 z 1</div>
                <p className="ce-ct">Text neříká, co agent udělá. Doplnit:</p>
                <p className="ce-ins">{added.replace(/^,\s*/, '').replace(/\.$/, '')}</p>
                <div className="ce-btns"><span className="ce-btn">Odmítnout</span><span ref={apply} className="ce-btn pri">Použít</span></div>
              </div>
              <div ref={chip} className="ce-chip glass"><i>✓</i>Provedeno · jde vrátit</div>
            </>
          )}
          <div ref={cur} className="ce-cur">
            <div ref={ring} className="ce-ring" />
            <div ref={ptr} className="ce-ptr">
              <svg className="ce-arrow" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 3 6.6 3-1.3-3-6.5h6.3z" /></svg>
              <svg className="ce-beam" viewBox="0 0 24 24"><path d="M8.5 3.5c2 0 3.5.6 3.5 2v13c0 1.4-1.5 2-3.5 2M15.5 3.5c-2 0-3.5.6-3.5 2v13c0 1.4 1.5 2 3.5 2M9.5 12h5" /></svg>
            </div>
            <span className="ce-you">Vy</span>
          </div>
        </div>
      )}
    </div>
  )
}
