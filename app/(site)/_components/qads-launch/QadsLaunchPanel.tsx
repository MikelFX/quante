'use client'

// Launch strip for Qads Character on the AssetraDigital website (owner, 2026-10-28): shortly after a
// visitor arrives, one slim line glides up at the bottom-left — the brand's blinking pixel, a mono
// label, one sentence and a link into /qads in Character mode. No image, no modal, no backdrop.
// Closing hides it for good (localStorage). Shown only during the launch offer
// (lib/qads/pricing.ts TIKTOKER_LAUNCH). Quante product → Quante green (.ad-q).

import { useEffect, useState } from 'react'
import { appHref } from '@/lib/domains'
import { isTiktokerLaunch } from '@/lib/qads/pricing'

const SEEN_KEY = 'ad:qads-launch:v2'
const DELAY_MS = 1800

export function QadsLaunchPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isTiktokerLaunch()) return
    try { if (localStorage.getItem(SEEN_KEY) === 'closed') return } catch {}
    const t = window.setTimeout(() => setOpen(true), DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])

  const close = () => {
    setOpen(false)
    try { localStorage.setItem(SEEN_KEY, 'closed') } catch {}
  }

  return (
    <div className="ad-q ql" data-open={open ? 'true' : 'false'} role="region" aria-label="Novinka v Qads" inert={!open}>
      <span className="ql-px" aria-hidden="true" />
      <span className="ql-k">Qads <i>×</i> Higgsfield</span>
      <span className="ql-sep" aria-hidden="true" />
      <p className="ql-t">
        <b>Novinka:</b>{' '}
        <span className="ql-long">vlastní AI postava, která o vašem produktu natočí video.</span>
        <span className="ql-short">AI postava natočí video o vašem produktu.</span>{' '}
        <em>30 dní bez marže.</em>
      </p>
      <a className="ql-go" href={appHref('/qads?mode=character')}>
        Vyzkoušet
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
      </a>
      <button type="button" className="ql-x" onClick={close} aria-label="Zavřít">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  )
}
