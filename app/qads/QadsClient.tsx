'use client'

import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'
import { FeatureCard } from '@/components/public/FeatureCard'
import { StudioMiniPanel } from '@/components/public/StudioMiniPanel'
import { Target, PenLine, Image as ImageIcon, Video, ShieldCheck, LineChart } from 'lucide-react'

const GENERATES = [
  { icon: Target, title: 'Strategy & angles', desc: 'Claude reads your store — products, brand, positioning — and drafts audience angles worth testing.' },
  { icon: PenLine, title: 'Ad copy', desc: 'Headlines, primary text, and CTAs written per angle, tuned to each channel’s format.' },
  { icon: ImageIcon, title: 'Static creatives', desc: 'On-brand product imagery generated to match your store’s palette and tone — no stock photos.' },
  { icon: Video, title: 'Video creatives', desc: 'Short-form video built for Reels and TikTok, generated from the same brief.' },
]

const STEPS = [
  { n: '01', title: 'Describe', desc: 'Point Qads at a store already built in Quante. No separate brief to write.' },
  { n: '02', title: 'Generate', desc: 'One pass produces strategy, copy, images, and video as a complete draft campaign.' },
  { n: '03', title: 'Review', desc: 'Everything lands paused. Read it, edit it, regenerate any piece you don’t like.' },
  { n: '04', title: 'Deploy', desc: 'Push to your own Meta and TikTok ad accounts — still paused until you activate it.' },
]

function SectionKicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="qp-kicker" style={{ justifyContent: 'center' }}>
      <span className="qp-dot" /> {n} — {label}
    </div>
  )
}

// Meta-Ads-Manager-style panels used by the hero StudioMiniPanel. The
// "before" state shows a blank campaign form ready to receive Qads's
// output; the "after" state shows the drafted campaign, paused, with
// three ad rows visible — the specific hook the qads page copy makes.
function QadsCampaignBefore() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#f5f7fa 0%,#e8ecf0 100%)',
        padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 18, height: 18, borderRadius: 4, background: '#1877F2' }} />
        <div style={{ fontFamily: 'ui-monospace', fontSize: 9.5, color: '#1c1e21', fontWeight: 600, letterSpacing: '.02em' }}>
          Meta Ads Manager
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: 'ui-monospace', fontSize: 8, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '.10em' }}>
          Draft
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
        {['Campaign name', 'Objective', 'Budget', 'Audience'].map(l => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: 'ui-monospace', fontSize: 8, color: 'rgba(0,0,0,0.5)', width: 78, textAlign: 'right' }}>{l}</div>
            <div style={{ flex: 1, height: 14, borderRadius: 3, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.08)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function QadsCampaignAfter() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#f5f7fa 0%,#e8ecf0 100%)',
        padding: 14, display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 18, height: 18, borderRadius: 4, background: '#1877F2' }} />
        <div style={{ fontFamily: 'ui-monospace', fontSize: 9.5, color: '#1c1e21', fontWeight: 600 }}>
          Dulpra · Coffee
        </div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 99, background: 'rgba(224,160,79,0.15)', border: '1px solid rgba(224,160,79,0.4)' }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#e0a04f' }} />
          <span style={{ fontFamily: 'ui-monospace', fontSize: 7.5, color: '#c47814' }}>Paused</span>
        </div>
      </div>
      {[
        { angle: 'Slow-brew ritual',   copy: 'Coffee that earns your morning.',  ctr: '2.1%' },
        { angle: 'Small-batch daily',  copy: 'Roasted the night before it ships.', ctr: '1.8%' },
        { angle: 'Bean origin story',  copy: 'Colombia · single-origin · 2026 harvest.', ctr: '1.9%' },
      ].map(row => (
        <div key={row.angle}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 7px', borderRadius: 4,
            background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 2, background: 'linear-gradient(135deg,#c9a97c,#3a2b18)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'ui-monospace', fontSize: 8, color: 'rgba(0,0,0,0.6)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {row.angle}
            </div>
            <div style={{ fontFamily: 'inherit', fontSize: 9.5, color: '#141212', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.copy}
            </div>
          </div>
          <div style={{ fontFamily: 'ui-monospace', fontSize: 8, color: '#3ecf8e', fontWeight: 700 }}>
            {row.ctr}
          </div>
        </div>
      ))}
    </div>
  )
}

export function QadsClient() {
  return (
    <div className="qnt-public qp-dark" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,8vw,5.5rem) 1.5rem clamp(2rem,5vw,3rem)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="qads" label="advertising, built on quante" />
          <h1 style={{ fontSize: 'clamp(32px,6vw,54px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1, margin: '0 0 20px' }}>
            Your store, turned into a{' '}
            <span style={{
              background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, var(--qp-accent-light))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              campaign.
            </span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 560, margin: '0 auto' }}>
            Qads is Quante’s ad platform. It reads a store you’ve already built and generates a complete Meta and TikTok campaign — strategy, copy, creatives, and video — ready to review before a single dollar moves.
          </p>

          {/* ── One-shot mini demo — "draft a campaign, paused for review" ──
              Directly under the hero so a visitor immediately sees the
              actual workflow: describe budget → Qads drafts copy +
              creatives → paused for review. Auto-plays once when
              scrolled into view. */}
          <div style={{ maxWidth: 640, margin: '48px auto 0', textAlign: 'left' }}>
            <StudioMiniPanel
              scenario={{
                url: 'dulpra.quantecode.com/qads',
                prompt: 'Launch Meta campaign · $12/day',
                logSteps: [
                  { text: 'Reading store · 24 products', state: 'running' },
                  { text: 'Drafting 3 angles + copy',    state: 'running' },
                  { text: 'Rendering creatives',         state: 'running' },
                  { text: 'Paused for review',           state: 'pass'    },
                ],
                toastLabel: 'Paused · ready for review',
              }}
              previewBefore={<QadsCampaignBefore />}
              previewAfter={<QadsCampaignAfter />}
            />
          </div>
        </div>
      </section>

      {/* ── WHAT IT GENERATES ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -120, left: -120 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 160, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <SectionKicker n="01" label="what it generates" />
          <h2 style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.2, margin: 0 }}>
            One brief. A full campaign.
          </h2>

          <div className="qp-feature-grid" style={{ textAlign: 'left' }}>
            {GENERATES.map(card => (
              <FeatureCard
                key={card.title}
                icon={<card.icon />}
                title={card.title}
                desc={card.desc}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: -100 }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -160, right: -90 }} />
        </div>
        <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <SectionKicker n="02" label="how it works" />
          <h2 style={{ fontSize: 'clamp(24px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.2, margin: 0 }}>
            Nothing goes live without you.
          </h2>

          <div className="qp-feature-grid" style={{ textAlign: 'left', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            {STEPS.map(step => (
              <GlassCard key={step.n} className="qp-feature-card">
                <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 12, color: 'var(--qp-accent)' }}>{step.n}</span>
                <p style={{ display: 'block', margin: '10px 0 8px', fontSize: 16.5, fontWeight: 700, letterSpacing: '-.015em' }}>{step.title}</p>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.55 }}>{step.desc}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── OWNERSHIP & CONTROL ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="03" label="your accounts, your budget" />
          <h2 style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.2, margin: '0 0 30px' }}>
            Qads drafts. You decide.
          </h2>

          <div className="qp-feature-grid" style={{ textAlign: 'left' }}>
            <FeatureCard icon={<ShieldCheck />} variant="mint" title="Paused by default" desc="Every campaign, ad set, and ad is created paused. Activating spend is always a separate, explicit step." />
            <FeatureCard icon={<LineChart />} variant="mint" title="Real accounts, real numbers" desc="Deploys to the Meta and TikTok ad accounts you connect — spend and results stay in your accounts, tracked back in the Studio." />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: 'clamp(4rem,8vw,6rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: '25%' }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -140, right: '25%' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-.03em', margin: '0 0 14px' }}>
            Open Qads in your Studio.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            Build a store first, then generate its first campaign in minutes.
          </p>
          <Link href="/dashboard" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#08080a',
            background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
            boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(212,255,63,.55)',
            padding: '0.85rem 2rem', borderRadius: 99, display: 'inline-block',
          }}>
            Go to your Studio →
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
