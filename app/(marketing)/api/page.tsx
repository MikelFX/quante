'use client'

import { useState } from 'react'

const mono = 'var(--font-geist-mono)'

export default function ApiPage() {
  const [email, setEmail] = useState('')
  const [done,  setDone]  = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDone(true)
    fetch('/api/notify/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})
  }

  return (
    <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(4rem,8vw,8rem) 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>

      {/* ambient orb */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <span style={{ position: 'absolute', width: 640, height: 640, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,91,213,.28),transparent 66%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 580 }}>
        <span style={{
          display: 'inline-block',
          fontFamily: mono, fontSize: 10, letterSpacing: '.12em',
          background: 'rgba(111,120,230,.18)', color: 'var(--qp-accent-deep)',
          border: '1px solid rgba(111,120,230,.28)',
          padding: '4px 12px', borderRadius: 99, marginBottom: 24,
        }}>
          COMING SOON
        </span>

        <h1 style={{ fontSize: 'clamp(28px,6vw,52px)', fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.08, marginBottom: 18 }}>
          Programmatic<br />store generation.
        </h1>

        <p style={{ fontSize: 16, color: 'var(--qp-sub)', lineHeight: 1.65, marginBottom: 40, maxWidth: 460, margin: '0 auto 40px' }}>
          The Quante API will let you generate, iterate, and deploy storefronts programmatically — from your own backend, CI pipeline, or agent workflow. Sign up to be notified when it launches.
        </p>

        {/* Preview of what the API will look like */}
        <div style={{
          background: '#15141C',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: 12, padding: '18px 20px',
          textAlign: 'left', marginBottom: 40,
          overflow: 'auto',
        }}>
          <pre style={{ fontFamily: mono, fontSize: 12.5, color: '#C7C4D6', margin: 0, lineHeight: 1.6 }}>{`POST https://api.quantecode.com/v1/generate
Authorization: Bearer qnt_••••••••••••

{
  "brief": "A minimalist skincare brand called Maison Sève,
            French-inspired, luxury, editorial tone.",
  "currency": "EUR"
}

→ 202 Accepted
{ "projectId": "prj_abc123", "status": "generating" }`}</pre>
        </div>

        {done ? (
          <div style={{
            padding: '18px 24px',
            background: 'rgba(52,211,153,.07)',
            border: '1px solid rgba(52,211,153,.2)',
            borderRadius: 12,
            display: 'inline-block',
          }}>
            <p style={{ fontSize: 14, color: 'var(--qp-mint)', margin: 0 }}>
              You&apos;re on the list. We&apos;ll reach out when the API launches.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <input
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              aria-label="Email for API launch notification"
              style={{
                height: 44, padding: '0 16px', width: 280,
                background: 'var(--qp-line-soft)',
                border: '1px solid var(--qp-line)',
                borderRadius: 8, color: 'var(--qp-ink)', fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                height: 44, padding: '0 22px',
                background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
                color: '#fff',
                border: 'none', borderRadius: 99,
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Notify me
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
