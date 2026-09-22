'use client'

import Link from 'next/link'
import {
  CREDIT_PACKS,
  ACTION_COSTS,
  AGENCY_MONTHLY_USD,
  formatHostingBoth,
  formatHostingAnnual,
  formatHostingMonthly,
  getPerCreditDisplay,
  getGenerationsCaption,
  getPackDescription,
} from '@/lib/pricing'
import { AGENCY_PROJECT_LIMIT, CREDIT_COSTS } from '@/lib/config'
import { PRICING_FAQ } from '@/lib/faq'
import { AgencyCheckoutButton } from '@/components/AgencyCheckoutButton'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'
import { StudioMiniPanel } from '@/components/public/StudioMiniPanel'

// Hosting details row list — everything numeric pulls from lib/pricing so the
// captions stay honest if a helper changes. "Cost per deploy" reads directly
// off the ACTION_COSTS deploy row, which lib/pricing labels "Free with hosting"
// (backed by the CREDIT_COSTS.deploy = 0 change + the hosting-plan gate in
// /api/deploy).
const HOSTING_ROWS = [
  { label: 'Hosting plan',      value: formatHostingBoth(),                                          mono: true  },
  { label: 'URL format',        value: 'my-store.stores.quantecode.com',                             mono: true  },
  { label: 'Custom domain',     value: 'Bring your own — CNAME verified automatically',              mono: false },
  { label: 'SSL certificate',   value: 'Included, auto-renewed',                                     mono: false },
  { label: 'Cost per deploy',   value: ACTION_COSTS.find(c => c.action.startsWith('Deploy'))!.costLabel + ' · unlimited', mono: true },
  { label: 'Re-deploy after edits', value: 'Same URL, same domain — just updated',                   mono: false },
]

// AGENCY_PROJECT_LIMIT is enforced server-side (see lib/tier.ts and the
// Stripe webhook that sets project_limit on the user row). The marketing
// bullet used to read "Unlimited projects — no active-store cap", which
// contradicts the enforced limit. Bullet re-worded to match the code;
// bump AGENCY_PROJECT_LIMIT in lib/config.ts if the intent is actually
// unlimited. Audit brief 2.1.
const AGENCY_FEATURES = [
  'Batch-generate up to 20 stores in one prompt',
  'Each store gets its own name, niche & design',
  `Up to ${AGENCY_PROJECT_LIMIT} active projects — no active-store cap`,
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

function SectionKicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="qp-kicker" style={{ justifyContent: 'center' }}>
      <span className="qp-dot" /> {n} — {label}
    </div>
  )
}

// Coffee bag illustration used in both product previews below. SVG so
// it stays crisp — draws a small-batch bag shape (tapered top, kraft
// paper texture via layered gradients, cream label with "DULPRA" mark,
// cast shadow beneath). Replaces the earlier flat-brown gradient
// square that read as a placeholder.
function CoffeeBag() {
  return (
    <div
      style={{
        aspectRatio: '1', borderRadius: 6, position: 'relative', overflow: 'hidden',
        background:
          // Cream backdrop with a subtle vignette so the bag sits in
          // its own light circle instead of floating on a flat colour.
          'radial-gradient(ellipse 70% 70% at 50% 45%, rgba(255,255,255,0.5) 0%, transparent 60%),' +
          'linear-gradient(180deg,#f0ebe0 0%,#e2dbca 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 8,
      }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ maxWidth: 90, maxHeight: 90 }} aria-hidden="true">
        <defs>
          <linearGradient id="cb-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#4a3a26" />
            <stop offset="45%"  stopColor="#3a2b18" />
            <stop offset="100%" stopColor="#22180a" />
          </linearGradient>
          <linearGradient id="cb-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="rgba(0,0,0,0.35)" />
            <stop offset="20%" stopColor="rgba(0,0,0,0.0)" />
            <stop offset="80%" stopColor="rgba(0,0,0,0.0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </linearGradient>
          <linearGradient id="cb-label" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f5f2ec" />
            <stop offset="100%" stopColor="#e5ddd0" />
          </linearGradient>
        </defs>

        {/* Ground shadow — soft ellipse under the bag. */}
        <ellipse cx="50" cy="93" rx="34" ry="3" fill="rgba(0,0,0,0.20)" />

        {/* Bag body — trapezoidal, slightly wider at the base, with a
            gently folded top edge. */}
        <path
          d="M 26 20 Q 28 16 32 16 L 68 16 Q 72 16 74 20 L 78 84 Q 78 90 72 90 L 28 90 Q 22 90 22 84 Z"
          fill="url(#cb-body)"
        />
        {/* Highlight/shadow gradient overlay for the side-lit look. */}
        <path
          d="M 26 20 Q 28 16 32 16 L 68 16 Q 72 16 74 20 L 78 84 Q 78 90 72 90 L 28 90 Q 22 90 22 84 Z"
          fill="url(#cb-side)"
        />
        {/* Folded top strip — a thinner darker band across the seal. */}
        <rect x="24" y="15" width="52" height="4" rx="1.5" fill="#1a1108" opacity="0.85" />
        <rect x="24" y="15" width="52" height="1" fill="rgba(255,255,255,0.12)" />

        {/* Paper label — cream card centred on the bag. */}
        <rect x="34" y="32" width="32" height="42" rx="1.5" fill="url(#cb-label)" />
        <rect x="34" y="32" width="32" height="42" rx="1.5" fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth="0.6" />

        {/* Label content — small wordmark + product line + weight. */}
        <text x="50" y="42" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="4.2" fill="#141212" letterSpacing="0.4">DULPRA</text>
        <line x1="42" y1="46" x2="58" y2="46" stroke="#141212" strokeWidth="0.4" />
        <text x="50" y="56" textAnchor="middle" fontFamily="Georgia, serif" fontSize="5" fontStyle="italic" fill="#141212">Slow</text>
        <text x="50" y="63" textAnchor="middle" fontFamily="Georgia, serif" fontSize="5" fontStyle="italic" fill="#141212">Roast</text>
        <text x="50" y="71" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="2.8" fill="rgba(0,0,0,0.6)" letterSpacing="0.3">250 G · DARK</text>

        {/* Bean icon — small oval with centre split, sits under the
            label for a "coffee!" reading. */}
        <g transform="translate(50 82)">
          <ellipse cx="0" cy="0" rx="4" ry="2.5" fill="#0a0704" />
          <path d="M -3 0 Q 0 -1 3 0" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.4" />
        </g>
      </svg>
    </div>
  )
}

// Product-preview panels used by the StudioMiniPanel above — a minimal
// cream-toned coffee product page before/after adding the size picker.
// Hand-rolled DOM (no image) so text stays crisp at any zoom.
function PricingProductBefore() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#faf8f3 0%,#efeae0 100%)',
        padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center',
      }}
    >
      <CoffeeBag />
      <div>
        <div style={{ fontFamily: 'ui-monospace', fontSize: 8, color: 'rgba(0,0,0,0.45)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 4 }}>
          COFFEE · 250 G
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 700, color: '#141212', letterSpacing: '-.01em', marginBottom: 2 }}>
          Slow Roast · Dark
        </div>
        <div style={{ fontFamily: 'inherit', fontSize: 9, color: 'rgba(0,0,0,0.6)', marginBottom: 8 }}>329 CZK</div>
        <div style={{ display: 'inline-block', padding: '4px 9px', borderRadius: 99, background: '#141212', color: '#f5f2ec', fontFamily: 'inherit', fontSize: 8, fontWeight: 600 }}>
          Add to cart
        </div>
      </div>
    </div>
  )
}

function PricingProductAfter() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#faf8f3 0%,#efeae0 100%)',
        padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center',
      }}
    >
      <CoffeeBag />
      <div>
        <div style={{ fontFamily: 'ui-monospace', fontSize: 8, color: 'rgba(0,0,0,0.45)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 4 }}>
          COFFEE · 250 G
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 700, color: '#141212', letterSpacing: '-.01em', marginBottom: 2 }}>
          Slow Roast · Dark
        </div>
        <div style={{ fontFamily: 'inherit', fontSize: 9, color: 'rgba(0,0,0,0.6)', marginBottom: 6 }}>329 CZK</div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'ui-monospace', fontSize: 7, color: 'rgba(0,0,0,0.45)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }}>
            Grind
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {['XS', 'S', 'M', 'L', 'XL'].map((chip, i) => (
              <span
                key={chip}
                style={{
                  padding: '2px 5px', borderRadius: 3,
                  fontFamily: 'ui-monospace', fontSize: 7.5,
                  color: i === 2 ? '#f5f2ec' : '#141212',
                  background: i === 2 ? '#141212' : 'transparent',
                  border: `1px solid ${i === 2 ? '#141212' : 'rgba(0,0,0,0.2)'}`,
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'inline-block', padding: '4px 9px', borderRadius: 99, background: '#141212', color: '#f5f2ec', fontFamily: 'inherit', fontSize: 8, fontWeight: 600 }}>
          Add to cart
        </div>
      </div>
    </div>
  )
}

export function PricingClient() {
  return (
    <div className="qnt-public qp-dark" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,8vw,5.5rem) 1.5rem clamp(2rem,5vw,3rem)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <SectionKicker n="pricing" label="credits · hosting plan · transparent" />
          <h1 style={{ fontSize: 'clamp(32px,6vw,54px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1, margin: '0 0 20px' }}>
            No subscription to build.<br />
            <span style={{
              background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, var(--qp-accent-light))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              Optional hosting.
            </span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--qp-sub)', maxWidth: 560, margin: '0 auto' }}>
            You only pay credits when you generate or iterate. Hosting on Quante is optional ({formatHostingBoth()}) — or export the source and host it anywhere.
            Start with <strong style={{ color: 'var(--qp-ink)' }}>12 free credits</strong>. No card required.
          </p>

          <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
            {[
              { value: String(CREDIT_COSTS.welcome_grant), label: 'free credits' },
              { value: '∞',                             label: 'never expire' },
              { value: formatHostingAnnual().split(' ')[0], label: 'optional hosting' },
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

        {/* ── One-shot mini demo — "1 edit = 1 credit" ──
            Sits directly under the hero stat row so a visitor scanning
            the price page immediately sees the unit of value: an edit
            gets typed → builds → deploys → toast confirms 1 credit
            spent. Auto-plays once when scrolled into view. */}
        <div style={{ maxWidth: 640, margin: '48px auto 0', padding: '0 0.5rem' }}>
          <StudioMiniPanel
            scenario={{
              url: 'dulpra.quantecode.com',
              prompt: 'Add a size picker to the product page',
              logSteps: [
                { text: 'Reading product/[slug].tsx', state: 'running' },
                { text: 'Adding SizePicker',          state: 'running' },
                { text: 'Build passed',               state: 'pass'    },
                { text: 'Deployed',                   state: 'pass'    },
              ],
              toastLabel: 'Deployed · 1 credit',
            }}
            previewBefore={<PricingProductBefore />}
            previewAfter={<PricingProductAfter />}
          />
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
                    background: 'var(--qp-accent)', color: '#08080a', padding: '3px 12px', borderRadius: 99,
                  }}>
                    Popular
                  </span>
                )}
                <div>
                  <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
                    {pack.priceDisplay}
                  </p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>{pack.label} · {pack.credits} credits</p>
                  <p style={{ fontSize: 13, color: 'var(--qp-sub)', lineHeight: 1.55, margin: '0 0 10px' }}>{getGenerationsCaption(pack)}</p>
                  <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', margin: 0 }}>{getPerCreditDisplay(pack)}</p>
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
            {ACTION_COSTS.map((c, i) => (
              <div key={c.action} style={{
                display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 22px',
                borderBottom: i < ACTION_COSTS.length - 1 ? '1px solid var(--qp-line-soft)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <span style={{ fontSize: 14 }}>{c.action}</span>
                  <span style={{
                    fontFamily: 'var(--qp-mono)', fontSize: 13, fontWeight: 600,
                    color: c.cost === 0 ? 'var(--qp-accent)' : 'var(--qp-sub)',
                    whiteSpace: 'nowrap',
                  }}>
                    {c.costLabel}
                  </span>
                </div>
                {c.freeReason && (
                  <span style={{ fontSize: 12, color: 'var(--qp-mut)', lineHeight: 1.5 }}>{c.freeReason}</span>
                )}
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
            Prefer self-hosting? Export the ZIP (free) and deploy anywhere.
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
            {PRICING_FAQ.map(item => (
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
            12 free credits included. No card needed.
          </p>
          <Link href="/signup" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none', color: '#08080a',
            background: 'var(--qp-accent)',
            boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 8px 20px -10px rgba(0,0,0,.35)',
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
