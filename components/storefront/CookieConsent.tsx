'use client'

import { useEffect, useState } from 'react'

interface ConsentState {
  analytics: boolean
  marketing: boolean
}

const STORAGE_KEY = 'cookie_consent'

export function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<ConsentState>({ analytics: false, marketing: false })

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  function saveConsent(consent: ConsentState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...consent, necessary: true }))
    } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.25rem',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 2.5rem)',
        maxWidth: '52rem',
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        borderRadius: 'var(--s-radius)',
        padding: '1.25rem 1.5rem',
        zIndex: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        fontFamily: 'var(--s-font-body)',
        color: 'var(--s-text)',
      }}
    >
      {!showSettings ? (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--s-muted)', lineHeight: 1.6, margin: 0, minWidth: '16rem' }}>
            Tento web používá cookies. Nezbytné cookies jsou nutné pro provoz webu.
            Analytické a marketingové cookies nám pomáhají zlepšovat služby — použijeme je
            jen s vaším souhlasem.{' '}
            <a href="/cookies" style={{ color: 'var(--s-accent)', textDecoration: 'none' }}>
              Více informací
            </a>
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                padding: '0.5rem 0.875rem',
                background: 'transparent',
                border: '1px solid var(--s-border)',
                borderRadius: 'var(--s-radius)',
                color: 'var(--s-muted)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
              }}
            >
              Nastavení
            </button>
            <button
              onClick={() => saveConsent({ analytics: false, marketing: false })}
              style={{
                padding: '0.5rem 0.875rem',
                background: 'transparent',
                border: '1px solid var(--s-border)',
                borderRadius: 'var(--s-radius)',
                color: 'var(--s-text)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
              }}
            >
              Odmítnout
            </button>
            <button
              onClick={() => saveConsent({ analytics: true, marketing: true })}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                border: 'none',
                borderRadius: 'var(--s-radius)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
              }}
            >
              Přijmout vše
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.9375rem', margin: 0 }}>Nastavení cookies</p>

          {[
            {
              key: 'necessary' as const,
              label: 'Nezbytné cookies',
              desc: 'Zajišťují základní funkce webu — košík, přihlášení, bezpečnost. Nelze vypnout.',
              fixed: true,
              value: true,
            },
            {
              key: 'analytics' as const,
              label: 'Analytické cookies',
              desc: 'Pomáhají nám pochopit, jak návštěvníci web používají. Data jsou anonymizovaná.',
              fixed: false,
              value: draft.analytics,
            },
            {
              key: 'marketing' as const,
              label: 'Marketingové cookies',
              desc: 'Slouží k zobrazování relevantních reklam na jiných webech.',
              fixed: false,
              value: draft.marketing,
            },
          ].map((cat) => (
            <div
              key={cat.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.75rem 1rem',
                background: 'var(--s-bg)',
                border: '1px solid var(--s-border)',
                borderRadius: 'calc(var(--s-radius) / 2)',
              }}
            >
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.8125rem', margin: '0 0 0.25rem' }}>{cat.label}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--s-muted)', margin: 0, lineHeight: 1.5 }}>{cat.desc}</p>
              </div>
              <button
                disabled={cat.fixed}
                onClick={() => {
                  if (cat.fixed) return
                  setDraft((prev) => ({ ...prev, [cat.key]: !prev[cat.key as keyof ConsentState] }))
                }}
                style={{
                  flexShrink: 0,
                  width: '2.75rem',
                  height: '1.5rem',
                  background: cat.value ? 'var(--s-accent)' : 'var(--s-border)',
                  border: 'none',
                  borderRadius: '9999px',
                  cursor: cat.fixed ? 'not-allowed' : 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  opacity: cat.fixed ? 0.6 : 1,
                }}
                aria-label={cat.value ? 'Zapnuto' : 'Vypnuto'}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '0.125rem',
                    left: cat.value ? '1.375rem' : '0.125rem',
                    width: '1.25rem',
                    height: '1.25rem',
                    background: 'white',
                    borderRadius: '50%',
                    transition: 'left 0.2s',
                    display: 'block',
                  }}
                />
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              onClick={() => saveConsent(draft)}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: '1px solid var(--s-border)',
                borderRadius: 'var(--s-radius)',
                color: 'var(--s-text)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
              }}
            >
              Uložit výběr
            </button>
            <button
              onClick={() => saveConsent({ analytics: true, marketing: true })}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                border: 'none',
                borderRadius: 'var(--s-radius)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
              }}
            >
              Přijmout vše
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
