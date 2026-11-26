'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import {
  CONSENT_KEY,
  CONSENT_OPEN_EVENT,
  consentCopy,
  consentValue,
  parseConsent,
  pixelAllowed,
  pixelBootstrap,
} from '@/lib/marketing-pixel'

/**
 * Consent bar + the ChatGPT Ads pixel (lib/marketing-pixel.ts). Mounted once in the root layout so it
 * survives client navigation (next/script with an id runs once per page load). On assetradigital.agency,
 * previews and localhost it renders nothing; on quantecode.com it asks once, and the pixel loads only
 * after „Allow marketing“. Withdrawing consent tells the SDK at once and it is not loaded again.
 */

const CHANGED = 'q:consent:changed'
const noop = () => () => {}
const useHost = () => useSyncExternalStore(noop, () => location.hostname, () => '')

function subscribeConsent(cb: () => void) {
  window.addEventListener(CHANGED, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHANGED, cb)
    window.removeEventListener('storage', cb)
  }
}
function readConsentRaw(): string | null {
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}

export function MarketingConsent() {
  const pathname = usePathname() ?? '/'
  const host = useHost()
  const raw = useSyncExternalStore(subscribeConsent, readConsentRaw, () => null)
  const stored = parseConsent(raw)
  const [reopened, setReopened] = useState(false)
  // Re-open from the footer link („Nastavení cookies“ / „Cookie settings“).
  useEffect(() => {
    const reopen = () => setReopened(true)
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
  }, [])

  if (!pixelAllowed(host, pathname)) return null

  function choose(value: boolean) {
    try { localStorage.setItem(CONSENT_KEY, consentValue(value)) } catch {}
    const w = window as unknown as { oaiq?: (...a: unknown[]) => void }
    if (!value && w.oaiq) w.oaiq('consent', false)
    setReopened(false)
    window.dispatchEvent(new Event(CHANGED))
  }

  const open = reopened || !stored
  const t = consentCopy(pathname)
  return (
    <>
      {stored?.marketing && (
        <Script id="oai-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: pixelBootstrap() }} />
      )}
      {open && (
        <div
          role="dialog"
          aria-label={t.label}
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 16,
            margin: '0 auto',
            maxWidth: 620,
            zIndex: 10000,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            background: 'var(--q-glass2)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--q-glass-border)',
            borderRadius: 14,
            boxShadow: 'var(--q-shadow)',
            color: 'var(--q-fg)',
            fontFamily: 'var(--q-sans)',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <p style={{ flex: '1 1 260px', margin: 0, color: 'var(--q-fg2)' }}>
            {t.text}{' '}
            <a href="/cookies" style={{ color: 'var(--q-fg)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {t.more}
            </a>
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => choose(false)} style={btn(false)}>{t.reject}</button>
            <button type="button" onClick={() => choose(true)} style={btn(true)}>{t.accept}</button>
          </div>
        </div>
      )}
    </>
  )
}

// Both choices look equally prominent (no dark pattern): same size, same weight.
function btn(primary: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 10,
    border: '1px solid ' + (primary ? 'var(--q-acc)' : 'var(--q-line2)'),
    background: primary ? 'var(--q-acc)' : 'transparent',
    color: primary ? 'var(--q-acc-ink)' : 'var(--q-fg)',
    font: '600 13px var(--q-sans)',
    cursor: 'pointer',
  }
}

/** Footer link that opens the consent bar again (rendered only where the bar exists). */
export function ConsentSettingsLink({ className, label }: { className?: string; label?: string }) {
  const pathname = usePathname() ?? '/'
  const host = useHost()
  if (!pixelAllowed(host, pathname)) return null
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
      style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 3 }}
    >
      {label ?? consentCopy(pathname).settings}
    </button>
  )
}
