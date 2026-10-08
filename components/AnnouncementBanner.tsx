'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { domainProvider } from '@/lib/site-config'
import { isSiteRoute } from '@/lib/site-routes'

const STORAGE_KEY = 'quante_banner_v1_dismissed'
const BANNER_H_PX = 40

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
      document.documentElement.style.setProperty('--banner-h', `${BANNER_H_PX}px`)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    localStorage.setItem(STORAGE_KEY, '1')
    document.documentElement.style.setProperty('--banner-h', '0px')
  }

  // Quante announcement — not part of the AssetraDigital website.
  if (!visible || isSiteRoute(pathname)) return null

  return (
    <div
      role="banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: BANNER_H_PX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--q-bg)',
        borderBottom: '1px solid rgb(var(--q-ink-rgb) / 0.06)',
        fontSize: 13,
        color: 'var(--q-fg)',
        padding: '0 56px',
        gap: 6,
      }}
    >
      <span className="ann-new" style={{ fontFamily: 'var(--q-mono)', fontSize: 10.5, letterSpacing: '.09em', color: 'var(--q-acc-text)', marginRight: 6 }}>
        NEW
      </span>
      {/* The bar has a fixed height (--banner-h): on phones only the short version fits one line. */}
      Connect your own domain<span className="ann-long"> to your store, powered by {domainProvider.name}</span>{' '}
      <Link
        href="/domains"
        style={{ color: 'var(--q-fg)', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap' }}
      >
        Learn more →
      </Link>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="q-tap"
        style={{
          position: 'absolute',
          right: 14,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgb(var(--q-ink-rgb) / .65)',
          fontSize: 18,
          lineHeight: 1,
          padding: '4px 6px',
          borderRadius: 4,
        }}
      >
        ×
      </button>
    </div>
  )
}
