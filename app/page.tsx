'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { Rocket, Download, CheckCircle2, MessageSquareText, History, Upload, Globe2, Link2 } from 'lucide-react'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { ShelfBackground } from '@/components/public/ShelfBackground'
import { GlassCard } from '@/components/public/GlassCard'
import { FeatureCard } from '@/components/public/FeatureCard'
import { IconTile } from '@/components/public/IconTile'

// ─── Constants ────────────────────────────────────────────────────────────────

const HERO_SHOWCASE = {
  url: 'https://maison-s-ve.stores.quantecode.com/',
  label: 'Maison Sève',
}

const STACK_CARDS = [
  { n: '01', icon: Rocket, title: 'Live in 3 minutes', desc: 'Click Deploy. Quante provisions hosting, SSL, and your subdomain automatically. Zero server setup, zero DevOps.' },
  { n: '02', icon: Download, title: "It's yours to keep", desc: 'Download the source, host it anywhere, change whatever you want. No lock-in, no strings attached.' },
  { n: '03', icon: CheckCircle2, title: 'It just works', desc: 'The AI handles your design and copy. The code underneath is solid — it builds and runs without issues every time.' },
  { n: '04', icon: MessageSquareText, title: 'Change anything in seconds', desc: '"Make it warmer." "Try a split layout." One message, one credit — and you see it update live.' },
  { n: '05', icon: History, title: 'Nothing gets lost', desc: 'Every change is saved automatically. Went too far? Jump back to any earlier version in one tap.' },
]

const SHOWCASE_PROJECTS = [
  {
    url: 'Alegant.eu', label: 'fashion · CZ/SK', brand: 'ALEGANT', tagline: 'Dress with intention.',
    cta: 'Shop collection', bg: '#f7f4ef', brandColor: '#1a1714', accentBg: '#b8955a', accentText: '#fff',
    brandFont: 'Georgia,serif', taglineSize: 15,
  },
  {
    url: 'FromageBox.cz', label: 'food · subscription', brand: 'FromageBox', tagline: "The world's finest cheeses, curated monthly.",
    cta: 'Start your box', bg: '#faf5ec', brandColor: '#2d1f0e', accentBg: '#c9913a', accentText: '#fff',
    brandFont: 'Georgia,serif', taglineSize: 13,
  },
  {
    url: 'DocThink.app', label: 'SaaS · medtech', brand: 'DocThink', tagline: 'Think clearer. Decide faster.',
    cta: 'Try for free', bg: '#f0f5ff', brandColor: '#0f1729', accentBg: '#2563eb', accentText: '#fff',
    brandFont: 'system-ui,sans-serif', taglineSize: 15,
  },
  {
    url: 'quantecode.com', label: 'AI builder · meta', brand: 'quante', tagline: 'Describe your store.\nWe build it.',
    cta: 'Try it free →', bg: '#f0eeff', brandColor: '#1B1A22', accentBg: '#5B54F0', accentText: '#fff',
    brandFont: 'var(--qp-mono)', taglineSize: 14,
  },
]

const HOSTING_FEATURES = [
  { icon: Upload, variant: 'accent' as const, title: 'One-click deploy', desc: 'Hit Deploy in the Studio. Quante handles the build, CDN and SSL certificate in about 3 minutes.' },
  { icon: Globe2, variant: 'plain' as const, title: 'Your own subdomain', desc: "Every store gets a clean URL like my-store.stores.quantecode.com — live the moment it's ready." },
  { icon: Link2, variant: 'mint' as const, title: 'Custom domain', desc: 'Already own a domain? Point your CNAME and Quante verifies it automatically. No DNS nightmare.' },
  { icon: Download, variant: 'plain' as const, title: 'Or take the code', desc: 'Prefer self-hosting? Export the full Next.js source as a ZIP and deploy anywhere you want.' },
]

// ─── Hero live storefront preview (lazy-loaded on intersection) ───────────────

function HeroStorefront() {
  const [mounted, setMounted] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setMounted(true); obs.disconnect() } },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative', background: '#f2efe9' }}>
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: '#f2efe9',
        opacity: loaded ? 0 : 1,
        transition: 'opacity 0.35s ease',
        pointerEvents: 'none',
      }} />
      {mounted && (
        <iframe
          src={HERO_SHOWCASE.url}
          title={`${HERO_SHOWCASE.label} store preview`}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoaded(true)}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="qnt-public" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,9vw,6rem) 1.5rem clamp(2rem,6vw,3.5rem)', position: 'relative' }}>
        <ShelfBackground variant="a" />
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto' }}>
            <div className="qp-kicker"><span className="qp-dot" /> try free — 25 credits on us</div>
            <h1 style={{
              fontSize: 'clamp(34px,7vw,62px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.08,
              margin: '0 0 18px',
            }}>
              Describe your store.<br />
              <span style={{
                background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, #7A72FF)',
                WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              }}>
                We build it.
              </span>
            </h1>
            <p style={{ fontSize: 16.5, lineHeight: 1.65, color: 'var(--qp-sub)', maxWidth: 430, margin: '0 auto' }}>
              Describe what you want. Get a real, working online shop — deploy it with one click or download and host anywhere.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 30, flexWrap: 'wrap' }}>
              <Link href="/signup" style={{
                fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: '#fff',
                background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
                boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
                padding: '14px 26px', borderRadius: 99,
              }}>
                Try it free →
              </Link>
              <Link href="/showcase" className="qp-glass qp-glass-strong" style={{
                fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: 'var(--qp-ink)',
                padding: '14px 26px', borderRadius: 99, display: 'inline-block',
              }}>
                See showcase
              </Link>
            </div>
          </div>

          {/* hero visual */}
          <div className="qp-hero-visual" style={{ position: 'relative', margin: '56px auto 0', maxWidth: 960, height: 380 }}>
            {[
              { top: '9%', left: '2%', rot: -8, bg: 'accent' as const },
              { bottom: '13%', left: '9%', rot: 6, bg: 'plain' as const },
              { top: '6%', right: '5%', rot: 10, bg: 'mint' as const },
              { bottom: '8%', right: '2%', rot: -6, bg: 'plain' as const },
            ].map((t, i) => (
              <div
                key={i}
                className="qp-hero-float qp-float-slow"
                style={{
                  position: 'absolute', width: 64, height: 64, borderRadius: 20,
                  top: t.top, bottom: t.bottom, left: t.left, right: t.right,
                  transform: `rotate(${t.rot}deg)`,
                }}
              >
                <IconTile variant={t.bg} icon={<CheckCircle2 />} />
              </div>
            ))}

            <div className="qp-liquid-glass qp-hero-store-card" style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: 'min(560px,88%)', height: 320, borderRadius: 26, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0,
                background: 'rgba(255,255,255,.35)', borderBottom: '1px solid var(--qp-glass-border)',
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(27,26,34,.18)' }} />
                ))}
                <span style={{ marginLeft: 8, fontFamily: 'var(--qp-mono)', fontSize: 10.5, color: 'var(--qp-sub)' }}>
                  {HERO_SHOWCASE.label} · live preview
                </span>
              </div>
              <HeroStorefront />
            </div>
          </div>
        </div>
      </section>

      {/* ── MANIFESTO / REVEAL ── */}
      <section style={{ padding: 'clamp(4rem,8vw,7rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: -100 }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -160, right: -90 }} />
        </div>
        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>02 — from idea to live store</div>
          <h2 style={{ fontSize: 'clamp(27px,4.6vw,44px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.18, margin: 0 }}>
            Quante <span style={{ color: 'var(--qp-accent)' }}>builds the store</span> —<br />
            and you&apos;re <span style={{ color: 'var(--qp-mint)' }}>live on your own domain</span> in minutes.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--qp-sub)', maxWidth: 420, margin: '18px auto 0' }}>
            Copy, design, and products — all generated from one description. Then hit Deploy.
          </p>

          <div className="qp-feature-grid manifesto-compare" style={{ maxWidth: 760, textAlign: 'left' }}>
            <GlassCard className="qp-feature-card">
              <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qp-mut)', margin: '0 0 14px' }}>
                The old way
              </p>
              {['Set up a server or Vercel account', 'Configure DNS and SSL yourself', 'DevOps before your first sale', 'Hours before you can share a link'].map(t => (
                <p key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.5, margin: '0 0 10px' }}>
                  <span style={{ color: '#D6534A' }}>✕</span> {t}
                </p>
              ))}
            </GlassCard>
            <GlassCard className="qp-feature-card qp-liquid-glass qp-tint-mint">
              <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qp-mint)', margin: '0 0 14px' }}>
                Quante
              </p>
              {['One click in the Studio', 'SSL included automatically', 'Live on your-store.stores.quantecode.com', 'Ready in about 3 minutes'].map(t => (
                <p key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.5, margin: '0 0 10px' }}>
                  <span style={{ color: 'var(--qp-mint)' }}>✓</span> {t}
                </p>
              ))}
            </GlassCard>
          </div>
        </div>
      </section>

      {/* ── WHY IT'S DIFFERENT ── */}
      <section style={{ padding: 'clamp(4rem,8vw,7rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: '20%', right: -140 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 160, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>03 — why it&apos;s different</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
            Built differently, on purpose.
          </h2>

          <div className="qp-feature-grid">
            {STACK_CARDS.map(card => (
              <FeatureCard
                key={card.n}
                icon={<card.icon />}
                eyebrow={card.n}
                title={card.title}
                desc={card.desc}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── SHOWCASE STRIP ── */}
      <section style={{ padding: 'clamp(4rem,8vw,7rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
            <div className="qp-kicker" style={{ justifyContent: 'center' }}>04 — built with quante</div>
            <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
              Real stores, built in minutes.
            </h2>
          </div>

          <div style={{
            display: 'flex', gap: 18, overflowX: 'auto', padding: '8px 4px 20px', marginTop: 'var(--qp-sp-block)',
            scrollSnapType: 'x proximity',
          }}>
            {SHOWCASE_PROJECTS.map(p => (
              <div key={p.url} style={{
                flex: '0 0 250px', scrollSnapAlign: 'start', borderRadius: 20, overflow: 'hidden',
                background: '#fff', border: '1px solid var(--qp-line-soft)', boxShadow: 'var(--qp-shadow-card)',
              }}>
                <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', background: '#EFEAE0', flexShrink: 0 }}>
                  {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(27,26,34,.18)' }} />)}
                  <span style={{ marginLeft: 6, fontFamily: 'var(--qp-mono)', fontSize: 9, color: 'var(--qp-mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.url}
                  </span>
                </div>
                <div style={{ height: 184, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20, background: p.bg }}>
                  <div style={{
                    fontFamily: p.brandFont, fontWeight: 700, letterSpacing: p.brandFont.includes('mono') ? '-.01em' : '.14em',
                    fontSize: 12.5, color: p.brandColor, marginBottom: 12,
                  }}>
                    {p.brand}
                  </div>
                  <div style={{
                    fontFamily: p.brandFont, fontSize: p.taglineSize, color: p.brandColor, lineHeight: 1.4,
                    marginBottom: 18, whiteSpace: 'pre-line',
                  }}>
                    {p.tagline}
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 600, padding: '7px 16px', borderRadius: 99,
                    background: p.accentBg, color: p.accentText,
                  }}>
                    {p.cta}
                  </div>
                </div>
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--qp-line-soft)' }}>
                  <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 10, color: 'var(--qp-mut)' }}>{p.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOSTING ── */}
      <section style={{ padding: 'clamp(4rem,8vw,7rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-mint" style={{ top: -100, left: '10%' }} />
          <span className="qp-blob qp-blob-accent" style={{ bottom: -140, right: '6%' }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 260, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 520, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>05 — hosting &amp; domains</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
            Click Deploy. You&apos;re live.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--qp-sub)', margin: '20px auto 0' }}>
            No servers to configure, no Vercel account needed. One click and your store is live on a real URL with SSL included.
          </p>
        </div>

        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <div className="qp-feature-grid">
            {HOSTING_FEATURES.map(f => (
              <FeatureCard key={f.title} icon={<f.icon />} variant={f.variant} title={f.title} desc={f.desc} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44, position: 'relative', zIndex: 2, padding: '0 1rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--qp-mint-wash)',
            border: '1px solid rgba(34,178,125,.28)', borderRadius: 99, padding: '9px 18px',
            fontFamily: 'var(--qp-mono)', fontSize: 'clamp(10.5px,3vw,12.5px)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--qp-mint)', boxShadow: '0 0 0 4px var(--qp-mint-wash)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>my-store.stores.quantecode.com</span>
            <span style={{ opacity: 0.65, marginLeft: 2 }}>· live · ssl ✓</span>
          </div>
        </div>
      </section>

      {/* ── PRICING PREVIEW ── */}
      <section style={{ padding: 'clamp(4rem,8vw,7rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -120, right: -100 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 220, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>06 — pricing</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
            Pay only when you create
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--qp-sub)', margin: '20px auto 0' }}>
            Credits for AI creation. Hosting from $9.99/month, SSL and CDN included. 25 free credits on signup — no card required.
          </p>
        </div>

        <div style={{ maxWidth: 780, margin: 'var(--qp-sp-block) auto 0', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="pricing-grid">
            {CREDIT_PACKS.map(pack => (
              <GlassCard
                key={pack.id}
                strong={pack.popular}
                className={`qp-feature-card${pack.popular ? ' qp-liquid-glass' : ''}`}
                style={{ position: 'relative' }}
              >
                {pack.popular && (
                  <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                    background: 'var(--qp-accent)', color: '#fff', padding: '3px 12px', borderRadius: 99,
                  }}>
                    Popular
                  </span>
                )}
                <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 26, fontWeight: 700, margin: '0 0 6px', lineHeight: 1 }}>
                  {pack.priceDisplay}
                </p>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 6px' }}>{pack.label}</p>
                <p style={{ fontSize: 12.5, color: 'var(--qp-sub)', margin: '0 0 14px', lineHeight: 1.5 }}>{pack.description}</p>
                <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', margin: 0 }}>
                  {pack.perCreditDisplay}
                </p>
              </GlassCard>
            ))}
          </div>

          <Link href="/pricing" style={{ display: 'inline-block', marginTop: 32, fontSize: 13, color: 'var(--qp-sub)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Full pricing details →
          </Link>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: 'clamp(4.5rem,10vw,7.5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -160, left: '20%' }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -160, right: '20%' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(27px,4.6vw,42px)', fontWeight: 800, letterSpacing: '-.03em', margin: '0 0 14px' }}>
            Ready to try it?
          </h2>
          <p style={{ fontSize: 15.5, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            Sign up in 30 seconds. 25 free credits included.
          </p>
          <Link href="/signup" style={{
            fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: '#fff',
            background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
            boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
            padding: '14px 26px', borderRadius: 99, display: 'inline-block',
          }}>
            Try it free →
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
