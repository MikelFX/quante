'use client'

// Integration note: the "Search" button below calls POST /api/domains/search.
// That route exists but requires real Namecheap Reseller API credentials in env:
//   NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP
// Until those are set, the search returns mock availability data.
// Do NOT expose live pricing without confirming current Namecheap reseller rates.

import { useState } from 'react'
import { domainProvider } from '@/lib/site-config'

const mono = 'var(--font-geist-mono)'
const accent = '#6f78e6'

const TLD_EXAMPLES = [
  { tld: '.com',   price: '€12.99/yr', available: true  },
  { tld: '.store', price: '€5.99/yr',  available: true  },
  { tld: '.eu',    price: '€8.49/yr',  available: true  },
  { tld: '.cz',    price: '€7.99/yr',  available: false },
]

const STEPS = [
  {
    n: '01',
    title: 'Search & buy',
    desc: `Type the domain you want. Quante checks availability across popular TLDs and lets you purchase in one step — charged to your existing payment method via Stripe. Powered by ${domainProvider.name}.`,
  },
  {
    n: '02',
    title: 'Auto-connect DNS & SSL',
    desc: "Once purchased, Quante sets the DNS records and provisions an SSL certificate automatically. No dashboard logins, no terminal commands.",
  },
  {
    n: '03',
    title: 'Live on your domain',
    desc: "Your store is reachable at your new address within minutes of purchase. The full URL — with HTTPS — is ready to share.",
  },
]

const FAQS = [
  {
    q: "Can I use a domain I already own at another registrar?",
    a: "Yes. Go to Studio → Settings → Custom Domain, enter your domain, and follow the CNAME instructions. You'll point your existing DNS records to Quante and we'll handle the SSL. No transfer needed.",
  },
  {
    q: "Which TLDs are supported?",
    a: `Quante supports the most common TLDs — .com, .store, .net, .org, .eu, .cz, .sk, .de, .shop, .io, and more. Availability depends on ${domainProvider.name}'s current reseller inventory. Exact availability is shown in the search results.`,
  },
  {
    q: "Is renewal automatic?",
    a: "Domains purchased through Quante are set to auto-renew by default. You can disable this in Studio → Settings → Domain. You'll receive an email reminder 30 days before renewal.",
  },
  {
    q: "Is pricing transparent? Is there a markup?",
    a: `Prices shown are inclusive of all fees — there's no hidden markup layered on top. Quante passes through ${domainProvider.name} reseller rates directly. Pricing may vary slightly by TLD and availability period.`,
  },
  {
    q: "What happens to my domain if I cancel my Quante subscription?",
    a: "Your domain registration is yours to keep. If you cancel, you can transfer the domain to any registrar using the EPP/auth code provided in your account settings. Your domain won't be deleted.",
  },
]

export default function DomainsPage() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) setSearched(true)
  }

  const baseName = query.trim().replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '')

  return (
    <div style={{ background: '#070709', color: '#f4f4f6', overflowX: 'clip' }}>

      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', padding: 'clamp(5rem,10vw,9rem) 1.5rem clamp(4rem,7vw,7rem)' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,91,213,.38),transparent 66%)', top: -180, left: -80 }} />
          <span style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(52,211,153,.14),transparent 66%)', bottom: -120, right: -60 }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: '#5b5b64', textTransform: 'uppercase', marginBottom: 16 }}>
            Custom domains
          </p>
          <h1 style={{ fontSize: 'clamp(32px,6vw,56px)', fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.07, marginBottom: 18 }}>
            Your store deserves<br />its own address.
          </h1>
          <p style={{ fontSize: 16, color: '#8a8a93', lineHeight: 1.65, maxWidth: 520, margin: '0 auto 40px' }}>
            Search, buy, and connect a custom domain without ever leaving Quante.
            We handle DNS and SSL automatically — powered by {domainProvider.name}.
          </p>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, maxWidth: 520, margin: '0 auto', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="yourstore"
              aria-label="Domain name to search"
              style={{
                flex: 1, minWidth: 200,
                height: 44, padding: '0 16px',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 8, color: '#f4f4f6', fontSize: 14,
                outline: 'none',
              }}
            />
            <button type="submit" style={{
              height: 44, padding: '0 22px',
              background: accent, color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 0 28px rgba(111,120,230,.35)',
            }}>
              Search
            </button>
          </form>
        </div>
      </section>

      {/* Search results (static demo) */}
      {searched && baseName && (
        <section style={{ padding: '0 1.5rem 4rem', maxWidth: 600, margin: '0 auto' }}>
          <p style={{ fontFamily: mono, fontSize: 11, color: '#5b5b64', letterSpacing: '.06em', marginBottom: 16, textTransform: 'uppercase' }}>
            Illustrative availability — live results require API credentials
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TLD_EXAMPLES.map(({ tld, price, available }) => (
              <div key={tld} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', background: '#0d0d12',
                border: `1px solid ${available ? 'rgba(52,211,153,.2)' : 'rgba(255,255,255,.07)'}`,
                borderRadius: 10,
              }}>
                <div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: available ? '#f4f4f6' : '#5b5b64' }}>
                    {baseName}{tld}
                  </span>
                  <span style={{ marginLeft: 10, fontFamily: mono, fontSize: 10, letterSpacing: '.06em', color: available ? '#34d399' : '#5b5b64' }}>
                    {available ? 'available' : 'taken'}
                  </span>
                </div>
                {available && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: mono, fontSize: 13, color: '#8a8a93' }}>{price}</span>
                    <button style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: accent, color: '#fff', border: 'none', cursor: 'pointer' }}>
                      Buy
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: '#3c3c4c', marginTop: 12, textAlign: 'center' }}>
            Prices shown are illustrative. Connect your store to see live availability and pricing.
          </p>
        </section>
      )}

      {/* How it works */}
      <section style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: '#5b5b64', textTransform: 'uppercase', marginBottom: 12, textAlign: 'center' }}>
            How it works
          </p>
          <h2 style={{ fontSize: 'clamp(24px,4vw,38px)', fontWeight: 700, letterSpacing: '-.03em', textAlign: 'center', marginBottom: 52 }}>
            From search to live — in minutes.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
            {STEPS.map(step => (
              <div key={step.n} style={{ background: 'rgba(12,12,16,.6)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '24px 20px' }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: accent, display: 'block', marginBottom: 14 }}>{step.n}</span>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f6', marginBottom: 8 }}>{step.title}</p>
                <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, background: 'rgba(52,211,153,.06)', border: '1px solid rgba(52,211,153,.18)', borderRadius: 12, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.55, margin: 0 }}>
              <span style={{ color: '#34d399', fontWeight: 600 }}>SSL included automatically.</span>{' '}
              Every domain connected through Quante gets a free TLS certificate, renewed automatically.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 36 }}>
            Frequently asked questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {FAQS.map(faq => (
              <div key={faq.q} style={{ borderBottom: '1px solid rgba(255,255,255,.06)', paddingBottom: 24 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', marginBottom: 8 }}>{faq.q}</p>
                <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.65, margin: 0 }}>{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: 'clamp(4rem,8vw,6rem) 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', width: 480, height: 480, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,91,213,.25),transparent 66%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(22px,4vw,36px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 14 }}>
            Ready to build your store?
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 28 }}>25 free credits. No credit card required.</p>
          <a href="/signup" style={{ display: 'inline-block', fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#070709', background: '#f4f4f6', padding: '0.75rem 2rem', borderRadius: 8 }}>
            Try it free →
          </a>
        </div>
      </section>

    </div>
  )
}
