'use client'

import { useEffect, useRef } from 'react'

/**
 * Port of pointerFx(): a difference-blended ring cursor that grows over links and buttons,
 * the spotlight that follows the pointer inside .spot cards (--mx / --my) and magnetic .mag
 * buttons. Cursor and magnet only on fine pointers; magnet also respects the motion switch.
 */
export function PointerFx() {
  const cur = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionOn = () => document.documentElement.getAttribute('data-motion') !== 'off' && !reduced.matches
    let magEl: HTMLElement | null = null
    const release = () => {
      if (magEl) {
        magEl.style.transform = ''
        magEl = null
      }
    }

    const onMove = (e: PointerEvent) => {
      const tg = e.target instanceof Element ? e.target : null
      if (!tg) return
      const c = cur.current
      if (c && fine) {
        c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'
        c.classList.toggle('big', !!tg.closest('a,button'))
      }
      const sp = tg.closest<HTMLElement>('.spot')
      if (sp) {
        const r = sp.getBoundingClientRect()
        sp.style.setProperty('--mx', e.clientX - r.left + 'px')
        sp.style.setProperty('--my', e.clientY - r.top + 'px')
      }
      if (!fine) return
      const mg = motionOn() ? tg.closest<HTMLElement>('.mag') : null
      if (magEl && magEl !== mg) release()
      if (mg) {
        const r = mg.getBoundingClientRect()
        mg.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2) * 0.22 + 'px,' + (e.clientY - r.top - r.height / 2) * 0.32 + 'px)'
        magEl = mg
      }
    }
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) release()
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('mouseout', onOut)
      release()
    }
  }, [])

  return (
    <div className="cur" ref={cur} aria-hidden="true">
      <i />
      <b />
    </div>
  )
}
