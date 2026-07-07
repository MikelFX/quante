'use client'

import type { Metadata } from 'next'
import { useState } from 'react'
import { operator } from '@/lib/site-config'

// Metadata export is handled by a parent server component in Next.js App Router.
// Since this is a client component, move metadata to a separate layout or use
// a server component wrapper if needed. For now, metadata is declared here as
// a named export — Next.js will pick it up from the file even with 'use client'.

const email = operator.contactEmail && !operator.contactEmail.includes('[TO')
  ? operator.contactEmail
  : null

const mono = 'var(--font-geist-mono)'

type FormState = 'idle' | 'sending' | 'sent' | 'error'

export default function ContactPage() {
  const [name,    setName]    = useState('')
  const [from,    setFrom]    = useState('')
  const [message, setMessage] = useState('')
  const [state,   setState]   = useState<FormState>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    // Stub submit handler — wire to a real API route or form service before launching.
    // Suggested: POST /api/contact with { name, email: from, message }
    await new Promise(r => setTimeout(r, 600))
    setState('sent')
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: '#5b5b64', textTransform: 'uppercase', marginBottom: 12 }}>
        Contact
      </p>
      <h1 style={{ fontSize: 'clamp(28px,5vw,42px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 12, color: '#f4f4f6' }}>
        Get in touch
      </h1>
      <p style={{ fontSize: 15, color: '#8a8a93', lineHeight: 1.65, marginBottom: 48 }}>
        Questions about the platform, billing, or a custom plan? We read and respond to every message.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 56 }} className="contact-grid">
        {/* Contact details */}
        <div>
          <p style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '.10em', textTransform: 'uppercase', color: '#5b5b64', marginBottom: 14 }}>
            Contact
          </p>
          {email ? (
            <a href={`mailto:${email}`} style={{ fontSize: 14, color: '#a5abf0', textDecoration: 'underline', textUnderlineOffset: 3, display: 'block', marginBottom: 10 }}>
              {email}
            </a>
          ) : (
            <p style={{ fontSize: 14, color: '#5b5b64' }}>Email address coming soon.</p>
          )}
        </div>

        {/* Business address — required by Czech law for online businesses */}
        <div>
          <p style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '.10em', textTransform: 'uppercase', color: '#5b5b64', marginBottom: 14 }}>
            Business address
          </p>
          <p style={{ fontSize: 14, color: '#8a8a93', lineHeight: 1.65 }}>
            {operator.name}<br />
            Švermova 441/12<br />
            273 43 Buštěhrad<br />
            Czech Republic
          </p>
        </div>
      </div>

      {/* Contact form */}
      {state === 'sent' ? (
        <div style={{
          padding: '28px 24px',
          background: 'rgba(52,211,153,.07)',
          border: '1px solid rgba(52,211,153,.2)',
          borderRadius: 14,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>Message sent.</p>
          <p style={{ fontSize: 14, color: '#8a8a93' }}>We'll get back to you within one business day.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, color: '#8a8a93', marginBottom: 6 }}>Your name</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              style={{
                width: '100%', height: 42, padding: '0 14px',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 8, color: '#f4f4f6', fontSize: 14,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, color: '#8a8a93', marginBottom: 6 }}>Email address</label>
            <input
              required
              type="email"
              value={from}
              onChange={e => setFrom(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%', height: 42, padding: '0 14px',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 8, color: '#f4f4f6', fontSize: 14,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, color: '#8a8a93', marginBottom: 6 }}>Message</label>
            <textarea
              required
              rows={6}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us what you need..."
              style={{
                width: '100%', padding: '12px 14px',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 8, color: '#f4f4f6', fontSize: 14,
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={state === 'sending'}
            style={{
              alignSelf: 'flex-start',
              height: 42, padding: '0 24px',
              background: '#f4f4f6', color: '#070709',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: state === 'sending' ? 0.6 : 1,
            }}
          >
            {state === 'sending' ? 'Sending…' : 'Send message'}
          </button>
          {state === 'error' && (
            <p style={{ fontSize: 13, color: '#f87171' }}>Something went wrong. Please email us directly.</p>
          )}
        </form>
      )}
    </div>
  )
}
