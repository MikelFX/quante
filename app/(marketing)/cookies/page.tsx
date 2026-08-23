// DRAFT — must be reviewed by a qualified lawyer before relying on this in
// production, especially given cross-border Stripe Connect payments and GDPR obligations.

import type { Metadata } from 'next'
import { operator } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Cookie Policy — Quante',
  description: 'How Quante uses cookies and browser storage.',
}

const EFFECTIVE = '1 July 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qp-ink)', marginBottom: 12, letterSpacing: '-.02em' }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'var(--qp-sub)', lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

const COOKIES = [
  {
    name: '__session (Clerk)',
    type: 'Strictly necessary',
    storage: 'HTTP-only cookie',
    duration: 'Session / up to 7 days',
    purpose: 'Maintains your authenticated session on the Quante platform. Set by Clerk (our authentication provider). Without this cookie the platform cannot verify your identity.',
  },
  {
    name: '__client_uat (Clerk)',
    type: 'Strictly necessary',
    storage: 'HTTP-only cookie',
    duration: 'Up to 1 year',
    purpose: 'Clerk token used to refresh session state across tabs without requiring a full re-authentication.',
  },
  {
    name: 'quante_banner_v1_dismissed',
    type: 'Functional / preference',
    storage: 'localStorage',
    duration: 'Persistent (until cleared)',
    purpose: 'Stores whether you have dismissed the site-wide announcement banner. No personal data is stored — the value is simply "1" when dismissed.',
  },
  {
    name: 'No analytics cookies currently set',
    type: 'Analytics',
    storage: '—',
    duration: '—',
    purpose: 'Quante does not currently set any third-party analytics cookies. If this changes, this policy will be updated before any analytics cookies are placed.',
  },
]

export default function CookiesPage() {
  const email = operator.contactEmail && !operator.contactEmail.includes('[TO') ? operator.contactEmail : null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 12 }}>
        Legal
      </p>
      <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 8, color: 'var(--qp-ink)' }}>
        Cookie Policy
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--qp-mut)', marginBottom: 48 }}>
        Effective {EFFECTIVE} · {operator.name}
      </p>

      <Section title="1. What are cookies?">
        <p>Cookies are small text files placed on your device by websites you visit. Quante also uses localStorage — a browser mechanism that stores key-value pairs locally on your device and is not transmitted to our servers with each request. Both technologies serve similar purposes: remembering your preferences and keeping you logged in.</p>
      </Section>

      <Section title="2. Cookies and storage we use">
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {COOKIES.map(c => (
            <div key={c.name} style={{
              padding: '16px 18px',
              background: 'var(--qp-line-soft)',
              border: '1px solid var(--qp-line-soft)',
              borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12.5, color: 'var(--qp-sub)', fontWeight: 600, margin: 0 }}>{c.name}</p>
                <span style={{
                  fontFamily: 'var(--font-geist-mono)', fontSize: 10, letterSpacing: '.06em',
                  background: 'rgba(111,120,230,.15)', color: 'var(--qp-accent-deep)',
                  padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                }}>
                  {c.type}
                </span>
              </div>
              <p style={{ margin: '0 0 6px', color: 'var(--qp-sub)' }}>{c.purpose}</p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--qp-mut)' }}>
                Storage: {c.storage} · Duration: {c.duration}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="3. How to control and clear cookies">
        <p>You can control cookies through your browser settings. Disabling cookies may affect the functionality of the Quante platform — in particular, authentication requires the session cookie to function.</p>
        <p style={{ marginTop: 10 }}>To clear the announcement banner preference stored in localStorage, open your browser's developer tools, go to Application → Local Storage → your domain, and delete the <code style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: 'var(--qp-accent-deep)', background: 'rgba(165,171,240,.1)', padding: '1px 5px', borderRadius: 3 }}>quante_banner_v1_dismissed</code> key.</p>
        <p style={{ marginTop: 10 }}>Most browsers also support clearing all site data via Settings → Privacy. Refer to your browser's help documentation for specific instructions.</p>
      </Section>

      <Section title="4. Third-party cookies">
        <p>Some of our sub-processors (notably Clerk for authentication and Stripe for payments) may set their own cookies when you interact with their embedded components. These are governed by their respective privacy policies.</p>
        <p style={{ marginTop: 10 }}>We do not sell or share cookie data with advertising networks. Quante does not currently use any advertising or tracking cookies.</p>
      </Section>

      <Section title="5. Changes to this policy">
        <p>If we introduce new cookies or change how existing ones are used, we will update this policy and notify you via email or an in-app notice before the new cookies are placed.</p>
      </Section>

      <Section title="6. Contact">
        <p>
          {operator.name} · {operator.address}
          {email && <> · <a href={`mailto:${email}`} style={{ color: 'var(--qp-accent)' }}>{email}</a></>}
        </p>
      </Section>
    </div>
  )
}
