// DRAFT — must be reviewed by a qualified lawyer before relying on this in
// production, especially given cross-border Stripe Connect payments and GDPR obligations.

import type { Metadata } from 'next'
import { operator } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Privacy Policy — Quante',
  description: 'How Quante collects, uses, and protects your personal data.',
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

export default function PrivacyPage() {
  const email = operator.contactEmail && !operator.contactEmail.includes('[TO') ? operator.contactEmail : null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 12 }}>
        Legal
      </p>
      <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 8, color: 'var(--qp-ink)' }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--qp-mut)', marginBottom: 48 }}>
        Effective {EFFECTIVE} · {operator.name}
      </p>

      <Section title="1. Who we are and how to reach us">
        <p>The data controller for the Quante platform is:</p>
        <p style={{ marginTop: 8, padding: '12px 16px', background: 'var(--qp-line-soft)', borderRadius: 8, border: '1px solid var(--qp-line-soft)' }}>
          {operator.name} · {operator.role}<br />
          {operator.address}
          {email && <><br /><a href={`mailto:${email}`} style={{ color: 'var(--qp-accent)' }}>{email}</a></>}
        </p>
        <p style={{ marginTop: 10 }}>For questions about this policy or to exercise your rights, contact us at the address above. We will respond within 30 days.</p>
      </Section>

      <Section title="2. Data we collect and why">
        <p><strong style={{ color: 'var(--qp-ink)' }}>Account data.</strong> When you sign up, we collect your email address and (optionally) your name. Legal basis: performance of a contract.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Payment data.</strong> Payment card information is processed exclusively by Stripe. We receive only a token and last-four-digits confirmation; we never store raw card details. Legal basis: performance of a contract.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Store content.</strong> Text, product descriptions, images, and other content you enter into the Studio are stored to provide the Service. Legal basis: performance of a contract.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>AI generation inputs.</strong> Your prompts and the AI-generated manifests are stored per project to support version history and iteration. These inputs are transmitted to Anthropic's API for processing. Legal basis: performance of a contract.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Usage data.</strong> We log which features you use, credit transactions, and error events, primarily for debugging and product improvement. Legal basis: legitimate interests.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Domain registration data.</strong> If you purchase a domain through Quante, your name and address are shared with Namecheap as required for ICANN-compliant domain registration. Legal basis: performance of a contract.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Session & authentication data.</strong> We use Clerk to manage authentication. Clerk stores your session token in a secure HTTP-only cookie. Legal basis: performance of a contract / legitimate interests.</p>
      </Section>

      <Section title="3. Sub-processors">
        <p>We use the following third-party processors who may access your data:</p>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Stripe, Inc.', 'Payment processing, Stripe Connect for merchant payouts', 'United States (EU SCCs / Privacy Shield successor in place)'],
            ['Vercel, Inc.', 'Cloud hosting and serverless infrastructure for the platform', 'United States (EU SCCs)'],
            ['Anthropic, PBC', 'AI model inference (Claude API) for store generation', 'United States (EU SCCs)'],
            ['Namecheap, Inc.', 'Domain registration and DNS management', 'United States (EU SCCs)'],
            ['Clerk, Inc.', 'Authentication and session management', 'United States (EU SCCs)'],
            ['Supabase, Inc.', 'PostgreSQL database hosting', 'EU region'],
          ].map(([name, purpose, transfer]) => (
            <div key={name} style={{ padding: '12px 16px', background: 'var(--qp-line-soft)', borderRadius: 8, border: '1px solid var(--qp-line-soft)' }}>
              <p style={{ fontWeight: 600, color: 'var(--qp-sub)', marginBottom: 4 }}>{name}</p>
              <p style={{ margin: 0 }}>{purpose}</p>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--qp-mut)' }}>{transfer}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="4. Data retention">
        <p>We retain your personal data for as long as your account is active. If you delete your account:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Account data is deleted within 30 days.</li>
          <li>Store content and manifests are deleted within 30 days.</li>
          <li>Payment records are retained for 7 years as required by Czech accounting law.</li>
          <li>Anonymised usage logs may be retained for up to 2 years for product analytics.</li>
        </ul>
      </Section>

      <Section title="5. Your rights under GDPR">
        <p>If you are in the European Economic Area, you have the following rights:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Access.</strong> Request a copy of the personal data we hold about you.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Rectification.</strong> Ask us to correct inaccurate or incomplete data.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Erasure.</strong> Request deletion of your data where there is no overriding legitimate interest or legal obligation.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Restriction.</strong> Ask us to restrict processing in certain circumstances.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Portability.</strong> Receive your data in a structured, machine-readable format.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Objection.</strong> Object to processing based on legitimate interests.</li>
          <li><strong style={{ color: 'var(--qp-sub)' }}>Withdraw consent.</strong> Where processing is based on consent, withdraw it at any time without affecting prior lawful processing.</li>
        </ul>
        <p style={{ marginTop: 10 }}>To exercise any of these rights, contact us{email ? <> at <a href={`mailto:${email}`} style={{ color: 'var(--qp-accent)' }}>{email}</a></> : ' using the contact details in Section 1'}. We will respond within 30 days.</p>
      </Section>

      <Section title="6. Right to complain">
        <p>You have the right to lodge a complaint with the Czech Office for Personal Data Protection (Úřad pro ochranu osobních údajů — ÚOOÚ):</p>
        <p style={{ marginTop: 8 }}>
          Website: <a href="https://www.uoou.cz" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--qp-accent)' }}>www.uoou.cz</a><br />
          Pplk. Sochora 27, 170 00 Prague 7, Czech Republic
        </p>
        <p style={{ marginTop: 10 }}>We would, however, appreciate the chance to address your concerns before you contact the supervisory authority.</p>
      </Section>

      <Section title="7. Security">
        <p>We use industry-standard security measures including encryption in transit (TLS), encryption at rest (for sensitive database fields), short-lived access tokens, and row-level security policies on our database. No system is completely secure; in the event of a data breach that materially affects your rights, we will notify you and the relevant supervisory authority as required by GDPR.</p>
      </Section>

      <Section title="8. Cookies and local storage">
        <p>We use browser cookies and local storage for authentication sessions and user preferences (such as dismissing announcements). See our Cookie Policy for details.</p>
      </Section>

      <Section title="9. Changes to this policy">
        <p>We may update this policy from time to time. Material changes will be notified by email or a prominent in-app notice at least 14 days before they take effect. The "Effective" date at the top of this page reflects the latest revision.</p>
      </Section>
    </div>
  )
}
