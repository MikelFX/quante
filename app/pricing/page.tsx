'use client'

import Link from 'next/link'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { AGENCY_MONTHLY_USD } from '@/lib/config'
import { AgencyCheckoutButton } from '@/components/AgencyCheckoutButton'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'

const COSTS = [
  { action: 'Build a store from scratch', cost: '10', unit: 'credits' },
  { action: 'Make a change in chat', cost: '1', unit: 'credit' },
  { action: 'Redo one section', cost: '2', unit: 'credits' },
  { action: 'Add a custom component', cost: '3', unit: 'credits' },
  { action: 'Download your store (ZIP)', cost: '5', unit: 'credits' },
  { action: 'Deploy to Quante hosting', cost: '5', unit: 'credits' },
  { action: 'Quante Hosting Plan', cost: '$99', unit: '/year or $9.99/mo' },
  { action: 'Welcome bonus on signup', cost: '+25', unit: 'free' },
]

const HOSTING_ROWS = [
  { label: 'Hosting plan', value: '$99 / year · or $9.99 / month', mono: true },
  { label: 'URL format', value: 'my-store.stores.quantecode.com', mono: true },
  { label: 'Custom domain', value: 'Bring your own — CNAME verified automatically', mono: false },
  { label: 'SSL certificate', value: 'Included, auto-renewed', mono: false },
  { label: 'Cost per deploy', value: '5 credits · charged on success only', mono: true },
  { label: 'Re-deploy after edits', value: 'Same URL, same domain — just updated', mono: false },
]

const AGENCY_FEATURES = [
  'Batch-generate up to 20 stores in one prompt',
  'Each store gets its own name, niche & design',
  'Unlimited projects — no active-store cap',
  'Full ZIP export on every project',
  'White-label: zero platform traces',
  'Priority generation queue',
  'Dedicated support channel',
]

const AGENCY_DETAILS: [string, string][] = [
  ['You get', 'Source code — ZIP export'],
  ['Client gets', 'Fully portable Next.js project'],
  ['Payments', "Client's own Stripe keys"],
  ['Hosting', 'Anywhere — Vercel, Railway, VPS'],
]

const FAQ = [
  { q: 'Do credits expire?', a: 'No. Credits never expire. Buy once and use them whenever you feel like it.' },
  { q: 'What if something goes wrong during generation?', a: "Credits are only taken on success. If a generation fails and we can't auto-fix it, nothing is charged." },
  { q: 'Can I export the same store more than once?', a: 'Yes — each export costs 5 credits. Useful when you want to grab the latest version after iterating.' },
  { q: 'What does "Deploy to Quante hosting" mean?', a: 'One click in the Studio and your store goes live on a URL like my-store.stores.quantecode.com — SSL, CDN and subdomain included, no server setup. Each deploy costs 5 credits. Your store stays live as long as your hosting plan is active.' },
  { q: 'Can I self-host instead?', a: "Yes. Export the ZIP (5 credits) and deploy anywhere — Vercel's free Hobby plan, Railway, Fly.io, your own VPS. The ZIP is a plain Next.js project with zero Quante dependency. No hosting plan needed." },
  { q: 'Is hosting a subscription?', a: 'Yes — $99/year (billed annually) or $9.99/month. This covers hosting, SSL, your quantecode.com subdomain, CDN, and unlimited deploys (each deploy costs 5 credits on top). Cancel anytime; your store stays live until the period ends.' },
  { q: 'What does the hosting plan cover?', a: 'Everything needed to keep your store online: managed hosting, automatic SSL renewal, a quantecode.com subdomain (or your own custom domain), global CDN, and 24/7 uptime monitoring. You only pay credits on top when you generate, iterate, or deploy.' },
  { q: 'What happens if my hosting expires?', a: 'Your store is paused and visitors see a maintenance page — nothing is ever deleted. Your products, orders and design are kept safe for at least 90 days. Resubscribe and your store goes back online automatically.' },
]

function SectionKicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="qp-kicker" style={{ justifyContent: 'center' }}>
      <span className="qp-dot" /> {n} — {label}
    </div>
  )
}

export default function PricingPage() {
  return (
    <div className="qnt-public" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,8vw,5.5rem) 1.5rem clamp(2rem,5vw,3rem)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="pricing" label="credits · hosting plan · transparent" />
          <h1 style={{ fontSize: 'clamp(32px,6vw,54px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1, margin: '0 0 20px' }}>
            Credits for AI.<br />
            <span style={{
              background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, #7A72FF)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              $99/year hosting.
            </span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 520, margin: '0 auto' }}>
            Pay only for what you create. Hosting is one simple subscription — $99/year or $9.99/month, everything included.
            Start with <strong style={{ color: 'var(--qp-mint)' }}>25 free credits</strong>. No card required.
          </p>

          <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
            {[
              { value: '$99', label: 'hosting / year' },
              { value: '25', label: 'free credits' },
              { value: '∞', label: 'never expire' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: 11, color: 'var(--qp-mut)', marginTop: 4, letterSpacing: '.04em', textTransform: 'uppercase', fontFamily: 'var(--qp-mono)' }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CREDIT PACKS ── */}
      <section style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -140, left: '30%' }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 200, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <SectionKicker n="01" label="credit packs" />
          <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 800, letterSpacing: '-.025em', textAlign: 'center', margin: '0 0 12px' }}>
            Buy what you need. Stop when you want.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--qp-sub)', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
            One-time payment. Credits never expire. Top up only when you actually run out.
          </p>

          <div className="qp-feature-grid" style={{ maxWidth: 1000 }}>
            {CREDIT_PACKS.map(pack => (
              <GlassCard
                key={pack.id}
                strong={pack.popular}
                className={`qp-feature-card${pack.popular ? ' qp-liquid-glass' : ''}`}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {pack.popular && (
                  <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                    background: 'var(--qp-accent)', color: '#fff', padding: '3px 12px', borderRadius: 99,
                  }}>
                    Popular
                  </span>
                )}
                <div>
                  <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
                    {pack.priceDisplay}
                  </p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>{pack.label}</p>
                  <p style={{ fontSize: 13, color: 'var(--qp-sub)', lineHeight: 1.55, margin: '0 0 10px' }}>{pack.description}</p>
                  <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', margin: 0 }}>{pack.perCreditDisplay}</p>
                </div>
                <Link href="/signup" style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  padding: '9px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600,
                  background: pack.popular ? 'var(--qp-accent)' : 'rgba(27,26,34,.06)',
                  color: pack.popular ? '#fff' : 'var(--qp-ink)',
                }}>
                  Get started
                </Link>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── COST TABLE ── */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <SectionKicker n="02" label="what each action costs" />
          <h2 style={{ fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 800, letterSpacing: '-.025em', textAlign: 'center', margin: '0 0 40px' }}>
            Transparent, predictable, fair.
          </h2>

          <GlassCard strong style={{ overflow: 'hidden' }}>
            {COSTS.map((c, i) => (
              <div key={c.action} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px',
                borderBottom: i < COSTS.length - 1 ? '1px solid var(--qp-line-soft)' : 'none',
              }}>
                <span style={{ fontSize: 14 }}>{c.action}</span>
                <span style={{
                  fontFamily: 'var(--qp-mono)', fontSize: 13, fontWeight: 600,
                  color: c.unit === 'free' ? 'var(--qp-mint)' : c.unit === '/year' ? 'var(--qp-accent)' : 'var(--qp-sub)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {c.cost}<span style={{ fontSize: 11, color: c.unit === '/year' ? 'var(--qp-accent)' : 'var(--qp-mut)' }}>{c.unit}</span>
                </span>
              </div>
            ))}
          </GlassCard>
        </div>
      </section>

      {/* ── HOSTING ── */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <SectionKicker n="03" label="hosting & domains" />
          <h2 style={{ fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 800, letterSpacing: '-.025em', textAlign: 'center', margin: '0 0 12px' }}>
            Your store, live in 3 minutes.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--qp-sub)', textAlign: 'center', maxWidth: 460, margin: '0 auto 40px', lineHeight: 1.65 }}>
            No Vercel account, no server config, no DNS headaches. Click Deploy in the Studio and Quante handles everything.
          </p>

          <GlassCard strong style={{ overflow: 'hidden' }}>
            {HOSTING_ROWS.map((row, i) => (
              <div key={row.label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
                padding: '14px 22px',
                borderBottom: i < HOSTING_ROWS.length - 1 ? '1px solid var(--qp-line-soft)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: 'var(--qp-sub)' }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 500, fontFamily: row.mono ? 'var(--qp-mono)' : 'inherit', textAlign: 'right' }}>
                  {row.value}
                </span>
              </div>
            ))}
          </GlassCard>

          <p style={{ fontSize: 12, color: 'var(--qp-mut)', textAlign: 'center', marginTop: 16 }}>
            Prefer self-hosting? Export the ZIP (5 credits) and deploy anywhere.
          </p>
        </div>
      </section>

      {/* ── AGENCY ── */}
      <section id="agency" style={{ padding: 'clamp(3.5rem,7vw,5rem) 1.5rem', borderTop: '1px solid var(--qp-line-soft)', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient"><span className="qp-blob qp-blob-mint" style={{ top: -100, right: '15%' }} /></div>
        <div style={{ maxWidth: 920, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <SectionKicker n="04" label="agency" />
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', textAlign: 'center', margin: '0 0 12px' }}>
            One prompt. Twenty stores. Done.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
            Write a single brief listing 20 niches — Quante generates each store in parallel, every one with its own name, design, and catalog. Hand them straight to clients.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginTop: 'var(--qp-sp-block)' }}>
            <GlassCard className="qp-liquid-glass qp-tint-mint" style={{
              padding: '28px 28px 32px', display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              <div>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--qp-mono)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em',
                  padding: '2px 9px', borderRadius: 99, background: 'var(--qp-mint-wash)', color: 'var(--qp-mint)',
                  border: '1px solid rgba(34,178,125,.28)',
                }}>
                  Agency
                </span>
                <p style={{ fontSize: 38, fontWeight: 800, fontFamily: 'var(--qp-mono)', letterSpacing: '-.04em', margin: '14px 0 0' }}>
                  ${AGENCY_MONTHLY_USD}
                  <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--qp-sub)', marginLeft: 4 }}>/month</span>
                </p>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {AGENCY_FEATURES.map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: 'var(--qp-sub)' }}>
                    <span style={{ color: 'var(--qp-mint)', flexShrink: 0, marginTop: 1 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <AgencyCheckoutButton style={{ background: 'var(--qp-mint)', color: '#fff' }} />
              <p style={{ fontSize: 11, color: 'var(--qp-mut)', textAlign: 'center', margin: 0 }}>Cancel anytime · billed monthly</p>
            </GlassCard>

            <GlassCard strong style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <p style={{ fontSize: 11, fontFamily: 'var(--qp-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--qp-mut)', margin: 0 }}>
                Batch generation
              </p>
              <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.55, margin: 0 }}>
                Describe the stores you need. Quante builds all of them at once.
              </p>
              <p style={{ fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.7, margin: 0 }}>
                List up to 20 store names and niches in one message — Quante generates each in parallel, with its own identity, palette, and product catalog. Every output is a self-contained Next.js project, ready to hand off or deploy instantly.
              </p>
              <div style={{ borderTop: '1px solid var(--qp-line-soft)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {AGENCY_DETAILS.map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--qp-mut)', fontFamily: 'var(--qp-mono)', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--qp-sub)', textAlign: 'right' }}>{value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem clamp(4rem,7vw,5.5rem)', borderTop: '1px solid var(--qp-line-soft)', background: 'var(--qp-bg-alt)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <SectionKicker n="05" label="questions" />
          <h2 style={{ fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 800, letterSpacing: '-.025em', textAlign: 'center', margin: '0 0 40px' }}>
            Common questions
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FAQ.map(item => (
              <GlassCard key={item.q} style={{ padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>{item.q}</p>
                <p style={{ fontSize: 13.5, color: 'var(--qp-sub)', lineHeight: 1.65, margin: 0 }}>{item.a}</p>
              </GlassCard>
            ))}
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
            Give it a try.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            25 free credits included. No card needed.
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
