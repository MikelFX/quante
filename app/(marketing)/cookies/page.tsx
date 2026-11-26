// DRAFT — must be reviewed by a qualified lawyer before relying on this in
// production, especially given cross-border Stripe Connect payments and GDPR obligations.

import { operator, operatorIdentity, isFilled } from '@/lib/site-config'
import { buildMetadata } from '@/lib/seo'
import { ConsentSettingsLink } from '@/components/consent/MarketingConsent'

export const metadata = buildMetadata({
  title: 'Cookie Policy',
  description: 'How Quante uses cookies and browser storage — essential, analytics and marketing categories plus consent controls.',
  path: '/cookies',
})

const EFFECTIVE = '25 November 2026'

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
    name: 'q:consent:v1',
    type: 'Strictly necessary',
    storage: 'localStorage',
    duration: 'Persistent (until cleared or changed)',
    purpose: 'Remembers whether you allowed marketing cookies on quantecode.com, so we ask only once. Stores only your choice and its date.',
  },
  {
    name: '__oppref (OpenAI Ads measurement pixel)',
    type: 'Marketing — only with your consent',
    storage: 'First-party cookie on quantecode.com',
    duration: '30 days',
    purpose: 'Set by the OpenAI measurement pixel only after you click “Allow marketing”. It recognises a visit that came from an ad in ChatGPT so we can learn whether the ad led to a sign-up or a purchase. Data goes to OpenAI (ChatGPT Ads). Never on assetradigital.agency or on stores built with Quante.',
  },
  {
    name: 'Vercel Web Analytics / Speed Insights',
    type: 'Analytics (cookieless)',
    storage: '—',
    duration: '—',
    purpose: 'Aggregate visit and page-speed numbers without cookies; no individual visitor can be identified.',
  },
]

export default function CookiesPage() {
  const email = isFilled(operator.contactEmail) ? operator.contactEmail : null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: 'var(--q-mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 12 }}>
        Legal
      </p>
      <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 8, color: 'var(--qp-ink)' }}>
        Cookie Policy
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--qp-mut)', marginBottom: 48 }}>
        Effective {EFFECTIVE} · {operator.productOf}
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
                <p style={{ fontFamily: 'var(--q-mono)', fontSize: 12.5, color: 'var(--qp-sub)', fontWeight: 600, margin: 0 }}>{c.name}</p>
                <span style={{
                  fontFamily: 'var(--q-mono)', fontSize: 10, letterSpacing: '.06em',
                  background: 'rgb(var(--q-acc-rgb) / .15)', color: 'var(--qp-accent-deep)',
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
        <p style={{ marginTop: 10 }}>To clear the announcement banner preference stored in localStorage, open your browser's developer tools, go to Application → Local Storage → your domain, and delete the <code style={{ fontFamily: 'var(--q-mono)', fontSize: 12, color: 'var(--qp-accent-deep)', background: 'rgb(var(--q-acc2-rgb) / .1)', padding: '1px 5px', borderRadius: 3 }}>quante_banner_v1_dismissed</code> key.</p>
        <p style={{ marginTop: 10 }}>Marketing cookies are off until you allow them in the cookie bar. You can change your choice at any time: <ConsentSettingsLink label="open cookie settings" /> (also linked in the footer as “Cookie settings”).</p>
        <p style={{ marginTop: 10 }}>Most browsers also support clearing all site data via Settings → Privacy. Refer to your browser's help documentation for specific instructions.</p>
      </Section>

      <Section title="4. Third-party cookies">
        <p>Some of our sub-processors (notably Clerk for authentication and Stripe for payments) may set their own cookies when you interact with their embedded components. These are governed by their respective privacy policies.</p>
        <p style={{ marginTop: 10 }}>With your consent only, quantecode.com loads the OpenAI measurement pixel (ChatGPT Ads), which sets the <code>__oppref</code> cookie and tells OpenAI when a visit that came from one of our ChatGPT ads leads to an action on our site. Without consent the pixel is not loaded at all. We do not sell cookie data.</p>
      </Section>

      <Section title="5. Changes to this policy">
        <p>If we introduce new cookies or change how existing ones are used, we will update this policy first. Cookies that need consent are only placed after you give it in the cookie bar.</p>
      </Section>

      <Section title="6. Contact">
        <p>
          {operatorIdentity()}
          {email && <> · <a href={`mailto:${email}`} style={{ color: 'var(--qp-accent-deep)' }}>{email}</a></>}
        </p>
      </Section>
    </div>
  )
}
