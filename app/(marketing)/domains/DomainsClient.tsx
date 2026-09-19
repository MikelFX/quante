'use client'

// Real domain search + purchase, backed by /api/domains/search and
// /api/domains/purchase (both call the live Namecheap Reseller API — see
// lib/namecheap.ts). This used to render a hardcoded example table with a
// non-functional "Buy" button; both are now wired to the real endpoints.
//
// Both API routes require a signed-in user (Clerk `auth()`). Anonymous
// visitors can still read the page, but searching/buying prompts them to
// sign up first rather than silently failing on a 401.

import { useState } from 'react'
import Link from 'next/link'
import { domainProvider } from '@/lib/site-config'
import DomainRegistrantForm from '@/components/public/DomainRegistrantForm'
import type { DomainRegistrant } from '@/lib/domain-registrant'

const mono = 'var(--font-geist-mono)'
const accent = 'var(--qp-accent)'

interface SearchResult {
  domain: string
  available: boolean
  price: number
  currency: string
}

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
    a: "Yes. Go to Studio → Publish → Custom Domain, enter your domain, and follow the CNAME instructions. You'll point your existing DNS records to Quante and we'll handle the SSL. No transfer needed.",
  },
  {
    q: "Which TLDs are supported?",
    a: `Quante checks the most common TLDs — .com, .cz, .sk, .eu, .app, .ai, .io, .shop and .store. Availability depends on ${domainProvider.name}'s current reseller inventory. Exact availability and price is shown in the search results.`,
  },
  {
    q: "Is renewal automatic?",
    a: "Domains purchased through Quante are set to auto-renew by default. You can disable this in Studio → Settings → Domain. You'll receive an email reminder 30 days before renewal.",
  },
  {
    q: "Is pricing transparent? Is there a markup?",
    a: `Prices shown are inclusive of all fees — there's no hidden markup layered on top of what's shown at checkout. Quante passes through ${domainProvider.name} reseller rates with a small service margin built into the displayed price. Pricing may vary slightly by TLD and availability period.`,
  },
  {
    q: "What happens to my domain if I cancel my Quante subscription?",
    a: "Your domain registration is yours to keep. If you cancel, you can transfer the domain to any registrar using the EPP/auth code provided in your account settings. Your domain won't be deleted.",
  },
  {
    q: "Why do you need my name and address to buy a domain?",
    a: "Domain registration creates a legal WHOIS record — you, not Quante, are the registrant. We ask for this before checkout so the registration can actually complete (registrars reject incomplete contact data), and WhoisGuard privacy protection is included free so your details aren't publicly listed.",
  },
]

export default function DomainsPage() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [needsAuth, setNeedsAuth] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [pendingBuy, setPendingBuy] = useState<{ domain: string; price: number } | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || searching) return
    setSearching(true)
    setSearched(true)
    setNeedsAuth(false)
    setSearchError(null)
    setResults([])
    try {
      const res = await fetch(`/api/domains/search?q=${encodeURIComponent(query.trim())}`)
      if (res.status === 401) {
        setNeedsAuth(true)
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setSearchError(data.error ?? 'Domain search failed. Please try again.')
        return
      }
      setResults(data.results ?? [])
    } catch {
      setSearchError('Domain search failed. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  async function handleConfirmPurchase(registrant: DomainRegistrant) {
    if (!pendingBuy) return
    setPurchasing(true)
    setPurchaseError(null)
    try {
      const res = await fetch('/api/domains/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: pendingBuy.domain,
          price: pendingBuy.price,
          includeProtection: true,
          registrant,
        }),
      })
      const data = await res.json()
      if (res.status === 401) {
        setNeedsAuth(true)
        setPendingBuy(null)
        return
      }
      if (!res.ok) {
        setPurchaseError(data.error ?? 'Could not start checkout. Please try again.')
        return
      }
      if (data.url) window.location.href = data.url
    } catch {
      setPurchaseError('Something went wrong. Please try again.')
    } finally {
      setPurchasing(false)
    }
  }

  return (
    <div style={{ overflowX: 'clip' }}>

      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', padding: 'clamp(5rem,10vw,9rem) 1.5rem clamp(4rem,7vw,7rem)' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,91,213,.38),transparent 66%)', top: -180, left: -80 }} />
          <span style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(52,211,153,.14),transparent 66%)', bottom: -120, right: -60 }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 16 }}>
            Custom domains
          </p>
          <h1 style={{ fontSize: 'clamp(32px,6vw,56px)', fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.07, marginBottom: 18 }}>
            Your store deserves<br />its own address.
          </h1>
          <p style={{ fontSize: 16, color: 'var(--qp-sub)', lineHeight: 1.65, maxWidth: 520, margin: '0 auto 40px' }}>
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
                background: 'var(--qp-line-soft)',
                border: '1px solid var(--qp-line)',
                borderRadius: 8, color: 'var(--qp-ink)', fontSize: 14,
                outline: 'none',
              }}
            />
            <button type="submit" disabled={searching || !query.trim()} style={{
              height: 44, padding: '0 22px',
              background: accent, color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: searching || !query.trim() ? 'not-allowed' : 'pointer',
              opacity: searching || !query.trim() ? 0.6 : 1,
              boxShadow: '0 0 28px rgba(111,120,230,.35)',
            }}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>
      </section>

      {/* Search results */}
      {searched && (
        <section style={{ padding: '0 1.5rem 4rem', maxWidth: 600, margin: '0 auto' }}>
          {needsAuth ? (
            <div className="qp-glass" style={{ padding: '20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--qp-ink)', marginBottom: 8 }}>
                Sign in to search and buy domains
              </p>
              <p style={{ fontSize: 13, color: 'var(--qp-sub)', marginBottom: 16 }}>
                Domain registration is tied to your Quante account so we can attach it to a store and keep it renewed.
              </p>
              <Link href="/signup" style={{
                display: 'inline-block', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: '#fff',
                background: accent, padding: '0.6rem 1.4rem', borderRadius: 99,
              }}>
                Sign up free →
              </Link>
            </div>
          ) : searchError ? (
            <p style={{ fontSize: 13, color: '#D6534A', textAlign: 'center' }}>{searchError}</p>
          ) : !searching && results.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--qp-sub)', textAlign: 'center' }}>No results — try a different name.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r) => (
                <div key={r.domain} className="qp-glass" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px',
                  borderColor: r.available ? 'rgba(34,178,125,.28)' : undefined,
                }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: r.available ? 'var(--qp-ink)' : 'var(--qp-mut)' }}>
                      {r.domain}
                    </span>
                    <span style={{ marginLeft: 10, fontFamily: mono, fontSize: 10, letterSpacing: '.06em', color: r.available ? 'var(--qp-mint)' : 'var(--qp-mut)' }}>
                      {r.available ? 'available' : 'taken'}
                    </span>
                  </div>
                  {r.available && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--qp-sub)' }}>${r.price.toFixed(2)}/yr</span>
                      <button
                        onClick={() => setPendingBuy({ domain: r.domain, price: r.price })}
                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: accent, color: '#fff', border: 'none', cursor: 'pointer' }}
                      >
                        Buy
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* How it works */}
      <section style={{ borderTop: '1px solid var(--qp-line-soft)', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 12, textAlign: 'center' }}>
            How it works
          </p>
          <h2 style={{ fontSize: 'clamp(24px,4vw,38px)', fontWeight: 700, letterSpacing: '-.03em', textAlign: 'center', marginBottom: 52 }}>
            From search to live — in minutes.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
            {STEPS.map(step => (
              <div key={step.n} className="qp-glass" style={{ padding: '24px 20px' }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: accent, display: 'block', marginBottom: 14 }}>{step.n}</span>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--qp-ink)', marginBottom: 8 }}>{step.title}</p>
                <p style={{ fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, background: 'rgba(52,211,153,.06)', border: '1px solid rgba(52,211,153,.18)', borderRadius: 12, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <p style={{ fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.55, margin: 0 }}>
              <span style={{ color: 'var(--qp-mint)', fontWeight: 600 }}>SSL included automatically.</span>{' '}
              Every domain connected through Quante gets a free TLS certificate, renewed automatically.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ borderTop: '1px solid var(--qp-line-soft)', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 36 }}>
            Frequently asked questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {FAQS.map(faq => (
              <div key={faq.q} style={{ borderBottom: '1px solid var(--qp-line-soft)', paddingBottom: 24 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--qp-ink)', marginBottom: 8 }}>{faq.q}</p>
                <p style={{ fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.65, margin: 0 }}>{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ borderTop: '1px solid var(--qp-line-soft)', padding: 'clamp(4rem,8vw,6rem) 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', width: 480, height: 480, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,91,213,.25),transparent 66%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(22px,4vw,36px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 14 }}>
            Ready to build your store?
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', marginBottom: 28 }}>25 free credits. No credit card required.</p>
          <a href="/signup" style={{
            display: 'inline-block', fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#fff',
            background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
            boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
            padding: '0.75rem 2rem', borderRadius: 99,
          }}>
            Try it free →
          </a>
        </div>
      </section>

      {/* Registrant contact modal */}
      {pendingBuy && (
        <>
          <div
            onClick={() => !purchasing && setPendingBuy(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}
          />
          <div style={{
            position: 'fixed', inset: 0, zIndex: 201,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', pointerEvents: 'none',
          }}>
            <div style={{
              pointerEvents: 'all', width: '100%', maxWidth: 480,
              background: 'var(--qp-surface,#fff)', border: '1px solid var(--qp-line)',
              borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,.25)',
              padding: '20px', maxHeight: '85vh', overflowY: 'auto',
            }}>
              <DomainRegistrantForm
                domain={pendingBuy.domain}
                price={pendingBuy.price}
                submitting={purchasing}
                theme="light"
                onCancel={() => setPendingBuy(null)}
                onSubmit={handleConfirmPurchase}
              />
              {purchaseError && (
                <p style={{ fontSize: 12, color: '#D6534A', marginTop: 10 }}>{purchaseError}</p>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
