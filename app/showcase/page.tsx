'use client'

import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'

const LIVE_STORES = [
  {
    n: '01',
    name: 'Axiom',
    description: 'Technical outdoor equipment · Bold minimal aesthetic · CZK currency',
    brief: 'A modern outdoor & technical gear brand. CZK currency. Clean, bold design with strong product focus.',
    url: 'https://axiom.stores.quantecode.com/',
    addressBar: 'axiom.stores.quantecode.com',
    accent: '#5B54F0',
  },
  {
    n: '02',
    name: 'Mamut',
    description: 'Outdoor adventure apparel · Rugged editorial style · CZK currency',
    brief: 'An adventure apparel & gear store. CZK currency. Earthy, spacious editorial vibe with a strong CTA focus.',
    url: 'https://mamut.stores.quantecode.com/',
    addressBar: 'mamut.stores.quantecode.com',
    accent: '#b8955a',
  },
]

const STEPS = [
  { n: '01', t: 'Describe', d: 'Tell Quante what kind of store you want. One sentence is enough.' },
  { n: '02', t: 'Iterate', d: 'Live preview. Adjust copy, colors, layout in chat. Each tweak is 1 credit.' },
  { n: '03', t: 'Export', d: 'Download a real Next.js project. Host anywhere. Yours forever.' },
]

function SectionKicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="qp-kicker" style={{ justifyContent: 'center' }}>
      <span className="qp-dot" /> {n} — {label}
    </div>
  )
}

export default function ShowcasePage() {
  return (
    <div className="qnt-public" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,8vw,5.5rem) 1.5rem clamp(2rem,5vw,3rem)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="showcase" label="real stores, live" />
          <h1 style={{ fontSize: 'clamp(32px,6vw,54px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1, margin: '0 0 20px' }}>
            Stores built<br />
            <span style={{
              background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, #7A72FF)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              from a sentence.
            </span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 520, margin: '0 auto' }}>
            Real stores, live on the web — each generated from a one-paragraph brief. Complete, styled, deployed. No manual design.
          </p>
        </div>
      </section>

      {/* ── LIVE STORES ── */}
      {LIVE_STORES.map((store, i) => (
        <section
          key={store.name}
          style={{
            padding: 'clamp(3rem,6vw,4.5rem) 1.5rem',
            borderTop: '1px solid var(--qp-line-soft)',
            background: i % 2 === 1 ? 'var(--qp-bg-alt)' : undefined,
          }}
        >
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, letterSpacing: '.06em', color: 'var(--qp-mut)', textTransform: 'uppercase' }}>
                    {store.n} — live store
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--qp-mint)', fontFamily: 'var(--qp-mono)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--qp-mint)', boxShadow: '0 0 0 3px var(--qp-mint-wash)' }} />
                    interactive
                  </span>
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 4px' }}>{store.name}</h2>
                <p style={{ fontSize: 13, color: 'var(--qp-sub)', lineHeight: 1.55, margin: 0 }}>{store.description}</p>
              </div>
              <a href={store.url} target="_blank" rel="noopener noreferrer" style={{
                fontSize: 12, color: 'var(--qp-sub)', textDecoration: 'underline', textUnderlineOffset: 4, fontFamily: 'var(--qp-mono)',
              }}>
                Open full screen ↗
              </a>
            </div>

            <GlassCard strong style={{ overflow: 'hidden', height: 'min(620px, 70vh)', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px',
                background: 'rgba(255,255,255,.35)', borderBottom: '1px solid var(--qp-glass-border)',
              }}>
                {['#ff5f57', '#febc2e', '#28c840'].map((c, ci) => (
                  <span key={ci} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.85 }} />
                ))}
                <span style={{ marginLeft: 14, fontSize: 10.5, color: 'var(--qp-sub)', fontFamily: 'var(--qp-mono)' }}>
                  {store.addressBar}
                </span>
              </div>
              <iframe
                src={store.url}
                style={{ width: '100%', flex: 1, border: 'none', display: 'block' }}
                title={`${store.name} — live store built with Quante`}
                loading="lazy"
              />
            </GlassCard>

            <p style={{ fontSize: 12, color: 'var(--qp-mut)', marginTop: 14, fontStyle: 'italic', textAlign: 'center', maxWidth: 720, marginInline: 'auto', lineHeight: 1.6 }}>
              Generated from brief: &ldquo;{store.brief}&rdquo;
            </p>
          </div>
        </section>
      ))}

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -120, right: '10%' }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 180, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <SectionKicker n="03" label="how it works" />
          <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 800, letterSpacing: '-.025em', margin: '0 0 var(--qp-sp-block)' }}>
            Three steps. No filler.
          </h2>

          <div className="qp-feature-grid" style={{ maxWidth: 900, textAlign: 'left', marginTop: 0 }}>
            {STEPS.map(s => (
              <GlassCard key={s.n} className="qp-feature-card">
                <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-accent)', letterSpacing: '.06em' }}>{s.n}</span>
                <p style={{ fontSize: 18, fontWeight: 700, margin: '10px 0 8px', letterSpacing: '-.015em' }}>{s.t}</p>
                <p style={{ fontSize: 13, color: 'var(--qp-sub)', lineHeight: 1.6, margin: 0 }}>{s.d}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: 'clamp(4rem,8vw,6rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-mint" style={{ top: -140, left: '25%' }} />
          <span className="qp-blob qp-blob-accent" style={{ bottom: -140, right: '25%' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-.03em', margin: '0 0 14px' }}>
            Build yours in minutes.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            25 free credits on signup. Describe your brand — Quante does the rest.
          </p>
          <Link href="/signup" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#fff',
            background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
            boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
            padding: '0.85rem 2rem', borderRadius: 99, display: 'inline-block',
          }}>
            Start for free →
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
