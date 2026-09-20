'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { domainProvider } from '@/lib/site-config'

const STORAGE_KEY = 'quante_banner_v1_dismissed'
const BANNER_H_PX = 40

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(false)

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

  if (!visible) return null

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
        background: '#0A0A0A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 13,
        color: '#FFFFFF',
        padding: '0 56px',
        gap: 6,
      }}
    >
      <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10.5, letterSpacing: '.09em', color: '#E8FF6F', marginRight: 6 }}>
        NEW
      </span>
      Connect your own domain to your store, powered by {domainProvider.name}{' '}
      <Link
        href="/domains"
        style={{ color: '#FFFFFF', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap' }}
      >
        Learn more →
      </Link>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        style={{
          position: 'absolute',
          right: 14,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(255,255,255,.65)',
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
