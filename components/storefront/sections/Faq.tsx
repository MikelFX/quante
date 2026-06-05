'use client'

import { useState } from 'react'
import type { FaqProps } from '@/types/manifest'

interface Props {
  props: FaqProps
}

export function Faq({ props }: Props) {
  const { title, items } = props
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section
      style={{
        background: 'var(--s-bg)',
        padding: `calc(5rem * var(--s-space)) 2rem`,
        fontFamily: 'var(--s-font-body)',
      }}
    >
      <div style={{ maxWidth: '48rem', margin: '0 auto' }}>
        {title && (
          <h2
            style={{
              fontFamily: 'var(--s-font-heading)',
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              fontWeight: 700,
              color: 'var(--s-text)',
              marginBottom: `calc(2.5rem * var(--s-space))`,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>
        )}
        <div>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                borderBottom: '1px solid var(--s-border)',
              }}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1.25rem 0',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--s-font-body)',
                  color: 'var(--s-text)',
                  gap: '1rem',
                }}
              >
                <span style={{ fontWeight: 500, fontSize: '0.9375rem', lineHeight: 1.5 }}>
                  {item.question}
                </span>
                <span
                  style={{
                    color: 'var(--s-muted)',
                    fontSize: '1.25rem',
                    lineHeight: 1,
                    flexShrink: 0,
                    transition: 'transform 0.2s',
                    transform: open === i ? 'rotate(45deg)' : 'rotate(0deg)',
                  }}
                >
                  +
                </span>
              </button>
              {open === i && (
                <div
                  style={{
                    paddingBottom: '1.25rem',
                    color: 'var(--s-muted)',
                    lineHeight: 1.75,
                    fontSize: '0.9375rem',
                  }}
                >
                  {item.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
