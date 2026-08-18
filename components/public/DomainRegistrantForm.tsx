'use client'

// Registrant contact form — shown right before a domain purchase (Studio's
// Publish panel today, the marketing /domains page once that's wired up).
// This is a legal WHOIS record, not a nice-to-have: without it registerDomain()
// on the server refuses to run, and /api/domains/purchase refuses to even
// create a Stripe session. Client-side validation here is just for instant
// feedback — the server re-validates independently and is the real gate.

import { useState } from 'react'
import { type DomainRegistrant, emptyRegistrant, validateRegistrant, COUNTRY_OPTIONS } from '@/lib/domain-registrant'

export interface DomainRegistrantFormProps {
  domain: string
  price: number
  submitting: boolean
  onCancel: () => void
  onSubmit: (registrant: DomainRegistrant) => void
  /** 'light' = marketing site (CSS vars), 'dark' = Studio (hardcoded dark palette) */
  theme?: 'light' | 'dark'
}

export default function DomainRegistrantForm({
  domain, price, submitting, onCancel, onSubmit, theme = 'light',
}: DomainRegistrantFormProps) {
  const [registrant, setRegistrant] = useState<DomainRegistrant>(emptyRegistrant())
  const [touched, setTouched] = useState(false)

  const error = validateRegistrant(registrant, domain)
  const tld = domain.split('.').slice(1).join('.').toLowerCase()

  function set<K extends keyof DomainRegistrant>(key: K, value: string) {
    setRegistrant((r) => ({ ...r, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (error) return
    onSubmit(registrant)
  }

  const dark = theme === 'dark'
  const c = dark
    ? {
        text: '#e0e0e8', sub: '#8a8a93', border: 'rgba(255,255,255,.08)',
        bg: 'rgba(255,255,255,.04)', accent: '#6f78e6', danger: '#f87171',
        label: '#a8a8b3',
      }
    : {
        text: 'var(--qp-ink)', sub: 'var(--qp-sub)', border: 'var(--qp-line)',
        bg: 'var(--qp-line-soft)', accent: 'var(--qp-accent)', danger: '#D6534A',
        label: 'var(--qp-sub)',
      }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    border: `1px solid ${c.border}`, background: c.bg, color: c.text, outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: c.label, marginBottom: 5,
  }
  const field = (label: string, key: keyof DomainRegistrant, opts?: { placeholder?: string; half?: boolean }) => (
    <div style={{ flex: opts?.half ? '1 1 0' : '1 1 100%', minWidth: 140 }}>
      <label style={labelStyle}>{label}</label>
      <input
        style={inputStyle}
        value={registrant[key]}
        placeholder={opts?.placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: c.text }}>
          Registrant details for {domain}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: c.sub, lineHeight: 1.5 }}>
          Required by the domain registry (WHOIS record) — this is who legally owns the domain, not Quante.
          ${price.toFixed(2)}/yr, charged now.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {field('First name', 'firstName', { half: true })}
        {field('Last name', 'lastName', { half: true })}
      </div>
      {field('Address', 'address1', { placeholder: 'Street and number' })}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {field('City', 'city', { half: true })}
        {field('State / province', 'stateProvince', { half: true })}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {field('Postal code', 'postalCode', { half: true })}
        <div style={{ flex: '1 1 0', minWidth: 140 }}>
          <label style={labelStyle}>Country</label>
          <select
            style={inputStyle}
            value={registrant.country}
            onChange={(e) => set('country', e.target.value)}
          >
            <option value="">Select…</option>
            {COUNTRY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {field('Phone', 'phone', { placeholder: '+420.777123456', half: true })}
        {field('Email', 'email', { placeholder: 'you@example.com', half: true })}
      </div>

      {tld === 'eu' && (
        <p style={{ margin: 0, fontSize: 11, color: c.sub, lineHeight: 1.5 }}>
          .eu domains require an EU/EEA registrant (citizen, resident, or organisation established in the EU/EEA).
        </p>
      )}

      {touched && error && (
        <p style={{ margin: 0, fontSize: 12, color: c.danger }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${c.border}`, background: 'transparent', color: c.sub,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          style={{
            flex: 2, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
            border: 'none', background: c.accent, color: dark ? '#0a0a0e' : '#fff',
            cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Processing…' : `Continue to payment — $${price.toFixed(2)}`}
        </button>
      </div>
    </form>
  )
}
