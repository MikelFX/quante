'use client'

// Launch strip for Qads Character on the AssetraDigital website (owner, 2026-10-28): shortly after a
// visitor arrives, one slim line glides up at the bottom-left — the brand's blinking pixel, a mono
// label, one sentence and a link into /qads in Character mode. No image, no modal, no backdrop.
// Closing hides it for good (localStorage). Shown only during the launch offer
// (lib/qads/pricing.ts TIKTOKER_LAUNCH). Quante product → Quante green (.ad-q).

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { appHref } from '@/lib/domains'
import { isTiktokerLaunch } from '@/lib/qads/pricing'

const SEEN_KEY = 'ad:qads-launch:v2'
const DELAY_MS = 1800

// The English Quante pages (/en, owner 2026-11-07) get the same strip in English.
const COPY = {
  cs: { region: 'Novinka v Qads', news: 'Novinka:', long: 'vlastní AI postava, která o vašem produktu natočí video.', short: 'AI postava natočí video o vašem produktu.', offer: '30 dní bez marže.', go: 'Vyzkoušet', close: 'Zavřít' },
  en: { region: 'New in Qads', news: 'New:', long: 'your own AI character makes a video about your product.', short: 'An AI character makes a video of your product.', offer: '30 days at cost.', go: 'Try it', close: 'Close' },
}

export function QadsLaunchPanel() {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  const c = path === '/en' || path.startsWith('/en/') ? COPY.en : COPY.cs

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
    <div className="ad-q ql" data-open={open ? 'true' : 'false'} role="region" aria-label={c.region} inert={!open}>
      <span className="ql-px" aria-hidden="true" />
      <span className="ql-k">Qads <i>×</i> Higgsfield</span>
      <span className="ql-sep" aria-hidden="true" />
      <p className="ql-t">
        <b>{c.news}</b>{' '}
        <span className="ql-long">{c.long}</span>
        <span className="ql-short">{c.short}</span>{' '}
        <em>{c.offer}</em>
      </p>
      <a className="ql-go" href={appHref('/qads?mode=character')}>
        {c.go}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
      </a>
      <button type="button" className="ql-x" onClick={close} aria-label={c.close}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  )
}
