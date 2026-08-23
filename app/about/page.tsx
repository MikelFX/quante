'use client'

import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'

const TRAP_CARDS = [
  { n: '01', title: 'The subscription trap', desc: 'Most AI builders charge you every month — forever. Stop paying, lose access. Your work was never really yours.' },
  { n: '02', title: 'Export locked behind a tier', desc: 'Want to download your project? Upgrade to the highest plan. Want to self-host? Buy the enterprise add-on. The exit is always paywalled.' },
  { n: '03', title: 'You build on rented land', desc: "Your data, your designs, your business logic — all sitting inside someone else's platform. One pricing change away from being held hostage." },
  { n: '04', title: 'Time spent learning their UI', desc: "Every locked builder has its own quirks. Hours invested learning a tool you can't take with you. Skills that evaporate when you switch." },
]

const ROADMAP = [
  {
    code: 'I', name: 'QuanteCode', status: 'shipping now', statusColor: 'var(--qp-mint)',
    headline: 'E-commerce, built by description.',
    desc: "Describe a store. Get a real Next.js project. Export it, host it, own it. You're using it right now.",
    bullets: ['Manifest-driven generation', 'Live conversational editing', 'One-click ZIP export', 'Self-host anywhere'],
    accent: 'var(--qp-accent)',
  },
  {
    code: 'II', name: 'QuanteCreate', status: 'in research', statusColor: '#C9913A',
    headline: 'Games. Apps. Anything complex.',
    desc: 'The same philosophy applied to richer projects — multiplayer games, internal tools, simulations. Describe the system, own the source.',
    bullets: ['Multi-file project graphs', 'Stateful backends included', 'Game-engine adapters', 'Same export-first promise'],
    accent: '#C2569E',
  },
  {
    code: 'III', name: 'QuanteMarket', status: 'on the horizon', statusColor: 'var(--qp-mut)',
    headline: 'Stock-market analysis that thinks.',
    desc: 'Describe a thesis, a signal, a portfolio. Quante reasons about markets in real time — and gives you the workbook, not just the answer.',
    bullets: ['Live multi-source ingestion', 'Custom signal generation', 'Backtests as code', 'Exportable strategy files'],
    accent: 'var(--qp-mint)',
  },
]

const LOOP = [
  { label: 'Describe', deg: 0, color: 'var(--qp-accent)' },
  { label: 'Generate', deg: 90, color: '#C2569E' },
  { label: 'Export', deg: 180, color: 'var(--qp-mint)' },
  { label: 'Learn', deg: 270, color: 'var(--qp-ink)' },
]

function SectionKicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="qp-kicker" style={{ justifyContent: 'center' }}>
      <span className="qp-dot" /> {n} — {label}
    </div>
  )
}

export default function AboutPage() {
  return (
    <div className="qnt-public" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,8vw,5.5rem) 1.5rem clamp(2rem,5vw,3rem)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="about quante" label="why we built this" />
          <h1 style={{ fontSize: 'clamp(32px,6vw,54px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1, margin: '0 0 20px' }}>
            Not a tool.<br />
            <span style={{
              background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, #7A72FF)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              A path.
            </span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 540, margin: '0 auto' }}>
            Most AI builders rent you access. We hand you the keys. Quante is a project that builds projects — and the next one always goes further than the last.
          </p>
        </div>
      </section>

      {/* ── THE PROBLEM ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -120, left: -120 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 160, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <SectionKicker n="01" label="the problem with AI builders today" />
          <h2 style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.2, margin: 0 }}>
            You build the work. They keep the keys.
          </h2>

          <div className="qp-feature-grid" style={{ textAlign: 'left' }}>
            {TRAP_CARDS.map(card => (
              <GlassCard key={card.n} className="qp-feature-card">
                <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 12, color: '#D6534A' }}>{card.n}</span>
                <p style={{ display: 'block', margin: '10px 0 8px', fontSize: 16.5, fontWeight: 700, letterSpacing: '-.015em' }}>{card.title}</p>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.55 }}>{card.desc}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── MANIFESTO ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: -100 }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -160, right: -90 }} />
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <SectionKicker n="02" label="what we believe" />
          <h2 style={{ fontSize: 'clamp(24px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.2, margin: 0 }}>
            The AI you use should make you <span style={{ color: 'var(--qp-accent)' }}>more independent</span>,{' '}
            not <span style={{ fontStyle: 'italic', color: 'var(--qp-mut)' }}>more dependent.</span>
          </h2>
          <p style={{ fontSize: 'clamp(16px,2.4vw,20px)', fontWeight: 600, color: 'var(--qp-sub)', margin: '18px 0 0' }}>
            So we built something different — a builder that{' '}
            <span style={{ color: 'var(--qp-mint)' }}>hands you everything</span> when it&apos;s done.
          </p>

          <div className="qp-feature-grid manifesto-compare" style={{ maxWidth: 760, textAlign: 'left' }}>
            <GlassCard className="qp-feature-card">
              <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#D6534A', margin: '0 0 14px' }}>
                Other AI builders
              </p>
              {['Monthly subscription forever', 'Export is a premium add-on', 'Your code lives in their cloud', 'Pricing changes = held hostage'].map(t => (
                <p key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.5, margin: '0 0 10px' }}>
                  <span style={{ color: '#D6534A' }}>✕</span> {t}
                </p>
              ))}
            </GlassCard>
            <GlassCard className="qp-feature-card qp-liquid-glass qp-tint-mint">
              <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qp-mint)', margin: '0 0 14px' }}>
                Quante
              </p>
              {['Pay only when you create', 'Export ships day one', 'Your code, in your hands', 'Host anywhere, forever'].map(t => (
                <p key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.5, margin: '0 0 10px' }}>
                  <span style={{ color: 'var(--qp-mint)' }}>✓</span> {t}
                </p>
              ))}
            </GlassCard>
          </div>
        </div>
      </section>

      {/* ── ROADMAP ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-mint" style={{ top: -140, right: -100 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 220, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
            <SectionKicker n="03" label="the roadmap" />
            <h2 style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.2, margin: 0 }}>
              One project. Many futures.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--qp-sub)', margin: '14px 0 0', lineHeight: 1.6 }}>
              Quante isn&apos;t a single app — it&apos;s a series. Each release ships what the last one taught us.
            </p>
          </div>

          <div className="qp-feature-grid" style={{ maxWidth: 1100, textAlign: 'left', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            {ROADMAP.map((node, i) => (
              <GlassCard key={node.code} strong className="qp-feature-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, borderColor: `${node.accent}55` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontFamily: 'var(--qp-mono)', fontSize: 11, fontWeight: 700, color: node.accent,
                    padding: '3px 10px', borderRadius: 99, border: `1px solid ${node.accent}44`,
                    background: `${node.accent}14`, letterSpacing: '.08em',
                  }}>
                    {node.code}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--qp-mono)', fontSize: 10.5, color: node.statusColor, letterSpacing: '.04em' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: node.statusColor }} className={i === 0 ? 'dot-pulse-el' : ''} />
                    {node.status}
                  </span>
                </div>
                <div>
                  <h3 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.1, margin: '0 0 6px' }}>{node.name}</h3>
                  <p style={{ fontSize: 14.5, color: 'var(--qp-sub)', lineHeight: 1.45, fontWeight: 500, margin: 0 }}>{node.headline}</p>
                </div>
                <p style={{ fontSize: 13, color: 'var(--qp-sub)', lineHeight: 1.6, margin: 0 }}>{node.desc}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {node.bullets.map(b => (
                    <li key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--qp-sub)' }}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: node.accent, flexShrink: 0 }} />
                      {b}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE LOOP ── */}
      <section style={{ padding: 'clamp(4rem,8vw,6rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="04" label="the loop" />
          <h2 style={{ fontSize: 'clamp(26px,4.6vw,42px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: '0 0 20px' }}>
            Quante builds projects.<br />Those projects teach Quante.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 540, margin: '0 auto var(--qp-sp-block)' }}>
            Every store, every game, every signal makes the next generation sharper. Compounding intelligence — out in the open, exported to your machine.
          </p>

          <div style={{ position: 'relative', width: 'min(340px, 100%)', aspectRatio: '1', margin: '0 auto' }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px dashed rgba(91,84,240,.28)', animation: 'spin 60s linear infinite' }} />
            <span style={{ position: 'absolute', inset: 22, borderRadius: '50%', border: '1px dashed rgba(34,178,125,.28)', animation: 'spin 80s linear infinite reverse' }} />
            {LOOP.map(({ label, deg, color }) => {
              const x = 50 + 44 * Math.cos((deg - 90) * Math.PI / 180)
              const y = 50 + 44 * Math.sin((deg - 90) * Math.PI / 180)
              return (
                <span key={label} className="qp-glass qp-glass-strong" style={{
                  position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)',
                  fontFamily: 'var(--qp-mono)', fontSize: 12, fontWeight: 600, color,
                  padding: '6px 14px', borderRadius: 99,
                }}>
                  {label}
                </span>
              )
            })}
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontFamily: 'var(--qp-mono)', fontSize: 12, color: 'var(--qp-mut)' }}>
              quante
            </span>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: 'clamp(4rem,8vw,6rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: '25%' }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -140, right: '25%' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-.03em', margin: '0 0 14px' }}>
            Start with QuanteCode today.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            25 free credits when you sign up. No card. No subscription.
          </p>
          <Link href="/signup" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#fff',
            background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
            boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
            padding: '0.85rem 2rem', borderRadius: 99, display: 'inline-block',
          }}>
            Try it free →
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
