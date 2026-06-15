'use client'

import { useState } from 'react'
import type { NewsletterProps } from '@/types/manifest'

interface Props {
  props: NewsletterProps
}

export function Newsletter({ props }: Props) {
  const {
    title,
    description,
    placeholder = 'your@email.com',
    buttonLabel = 'Subscribe',
  } = props
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <section
      style={{
        background: 'var(--s-text)',
        color: 'var(--s-bg)',
        padding: `calc(6rem * var(--s-space)) 2rem`,
        textAlign: 'center',
        fontFamily: 'var(--s-font-body)',
      }}
    >
      <div style={{ maxWidth: '36rem', margin: '0 auto' }}>
        <h2
          style={{
            fontFamily: 'var(--s-font-heading)',
            fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
            fontWeight: 700,
            color: 'var(--s-bg)',
            marginBottom: '1rem',
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h2>
        {description && (
          <p
            style={{
              color: 'var(--s-bg)',
              opacity: 0.65,
              marginBottom: '2rem',
              fontSize: '0.9375rem',
              lineHeight: 1.7,
            }}
          >
            {description}
          </p>
        )}
        {submitted ? (
          <p style={{ color: 'var(--s-bg)', opacity: 0.75, fontSize: '0.9375rem' }}>
            You&apos;re in. Welcome.
          </p>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <input
              type="email"
              required
              placeholder={placeholder}
              style={{
                flex: '1',
                minWidth: 'min(220px, 100%)',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 'var(--s-radius)',
                color: 'var(--s-bg)',
                fontFamily: 'var(--s-font-body)',
                fontSize: '0.9375rem',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '0.75rem 1.5rem',
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                border: 'none',
                borderRadius: 'var(--s-radius)',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--s-font-body)',
                fontSize: '0.9375rem',
              }}
            >
              {buttonLabel}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
