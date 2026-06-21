'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import Link from 'next/link'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { AGENCY_MONTHLY_USD } from '@/lib/config'
import { AgencyCheckoutButton } from '@/components/AgencyCheckoutButton'

const GRAIN_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

function cl(v: number, a = 0, b = 1) { return v < a ? a : v > b ? b : v }

function Ambient() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
      <span className="blob-drift1" style={{
        position: 'absolute', borderRadius: '50%', width: 520, height: 520,
        background: 'radial-gradient(circle at center,rgba(79,91,213,.42),transparent 66%)',
        top: -120, left: -60,
      }} />
      <span className="blob-drift2" style={{
        position: 'absolute', borderRadius: '50%', width: 460, height: 460,
        background: 'radial-gradient(circle at center,rgba(62,207,142,.16),transparent 66%)',
        bottom: -150, right: -90,
      }} />
      <span className="blob-drift1r" style={{
        position: 'absolute', borderRadius: '50%', width: 380, height: 380,
        background: 'radial-gradient(circle at center,rgba(111,120,230,.3),transparent 68%)',
        top: '38%', left: '54%',
      }} />
      {[
        { left: '16%', top: '28%', delay: '0s' },
        { left: '78%', top: '34%', delay: '1.4s' },
        { left: '30%', top: '66%', delay: '2.6s' },
        { left: '64%', top: '72%', delay: '0.8s' },
      ].map((m, i) => (
        <span key={i} className="mote-float" style={{
          position: 'absolute', width: 3, height: 3, borderRadius: '50%',
          background: 'rgba(184,192,255,.55)', left: m.left, top: m.top, animationDelay: m.delay,
        }} />
      ))}
    </div>
  )
}

function GrainVignette() {
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
        opacity: 0.045, mixBlendMode: 'overlay',
        backgroundImage: `url("${GRAIN_SVG}")`, backgroundSize: '160px 160px',
      }} />
      <div style={{
        position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.6) 100%)',
      }} />
    </>
  )
}

function LineReveal({ children, delay = 0, blue = false }: { children: string; delay?: number; blue?: boolean }) {
  return (
    <span style={{ display: 'block', overflow: 'hidden' }}>
      <motion.span
        initial={{ y: '112%', opacity: 0, filter: 'blur(8px)' }}
        animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1, delay, ease: [0.16, 0.84, 0.24, 1] }}
        style={{
          display: 'block',
          fontSize: 'clamp(34px,6vw,54px)',
          fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.07,
          color: blue ? '#6f78e6' : '#f4f4f6',
          ...(blue ? { textShadow: '0 0 26px rgba(79,91,213,.55),0 0 64px rgba(79,91,213,.28)' } : {}),
        }}
      >
        {children}
      </motion.span>
    </span>
  )
}

const COSTS = [
  { action: 'Build a store from scratch', cost: '10', unit: 'credits' },
  { action: 'Make a change in chat', cost: '1', unit: 'credit' },
  { action: 'Redo one section', cost: '2', unit: 'credits' },
  { action: 'Add a custom component', cost: '3', unit: 'credits' },
  { action: 'Download your store (ZIP)', cost: '5', unit: 'credits' },
  { action: 'Deploy to Quante hosting', cost: '5', unit: 'credits' },
  { action: 'Quante Hosting Plan', cost: '€99', unit: '/rok' },
  { action: 'Welcome bonus on signup', cost: '+25', unit: 'free' },
]

const FAQ = [
  { q: 'Do credits expire?', a: 'No. Credits never expire. Buy once and use them whenever you feel like it.' },
  { q: 'What if something goes wrong during generation?', a: "Credits are only taken on success. If a generation fails and we can't auto-fix it, nothing is charged." },
  { q: 'Can I export the same store more than once?', a: 'Yes — each export costs 5 credits. Useful when you want to grab the latest version after iterating.' },
  { q: 'What does "Deploy to Quante hosting" mean?', a: 'One click in the Studio and your store goes live on a URL like my-store.quante.app — SSL, CDN and subdomain included, no server setup. Each deploy costs 5 credits. Your store stays live as long as your annual hosting plan is active.' },
  { q: 'Can I self-host instead?', a: "Yes. Export the ZIP (5 credits) and deploy anywhere — Vercel's free Hobby plan, Railway, Fly.io, your own VPS. The ZIP is a plain Next.js project with zero Quante dependency. No hosting plan needed." },
  { q: 'Is hosting a subscription?', a: 'Yes — €99/year, billed annually. This covers hosting, SSL, your quante.app subdomain, CDN, and unlimited deploys (each deploy costs 5 credits on top). Cancel anytime; your store stays live until the period ends.' },
  { q: 'What does the €99/year cover?', a: 'Everything needed to keep your store online: managed hosting, automatic SSL renewal, a quante.app subdomain (or your own custom domain), global CDN, and 24/7 uptime monitoring. You only pay credits on top when you generate, iterate, or deploy.' },
]

export default function PricingPage() {
  const heroRef = useRef<HTMLElement>(null)
  const { scrollYProgress: heroP } = useScroll({ target: heroRef, offset: ['start start', 'end end'] })

  const heroCopyY = useTransform(heroP, p => -p * 60)
  const heroCopyOp = useTransform(heroP, p => cl(1 - p * 0.92))
  const heroCopyFilter = useTransform(heroP, p => `blur(${(p * 4).toFixed(2)}px)`)
  const cueOp = useTransform(heroP, [0, 0.05], [1, 0])

  return (
    <div style={{ background: '#070709', color: '#f4f4f6', overflowX: 'clip' }}>
      {/* Nav */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: '3.5rem', display: 'flex', alignItems: 'center',
        padding: '0 2rem', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        background: 'rgba(7,7,9,.88)', backdropFilter: 'blur(10px)',
      }}>
        <Link href="/" style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 14, fontWeight: 600, color: '#f4f4f6', textDecoration: 'none' }}>quante</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/showcase" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Showcase</Link>
          <Link href="/pricing" className="hidden sm:block" style={{ fontSize: 13, color: '#f4f4f6', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/about" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>About</Link>
          <Link href="/login" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" style={{
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.4rem 0.9rem', borderRadius: 6,
          }}>Try free →</Link>
        </div>
      </header>

      {/* HERO */}
      <section ref={heroRef} style={{ height: 1400, position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 44,
        }}>
          <Ambient />
          <GrainVignette />

          <motion.div style={{
            textAlign: 'center', position: 'relative', zIndex: 2, maxWidth: 800,
            y: heroCopyY, opacity: heroCopyOp, filter: heroCopyFilter,
          }}>
            <motion.div
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.05 }}
              style={{
                fontFamily: 'var(--font-geist-mono)', fontSize: 11.5,
                letterSpacing: '.06em', color: '#5b5b64',
                display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 22,
                textTransform: 'uppercase',
              }}
            >
              <span className="dot-pulse-el" style={{
                width: 7, height: 7, borderRadius: '50%', background: '#6f78e6', display: 'inline-block',
              }} />
              credits · hosting plan · transparent
            </motion.div>

            <div style={{ position: 'relative' }} className="headline-sheen">
              <LineReveal>Credits for AI.</LineReveal>
              <LineReveal delay={0.12} blue>€99/rok hosting.</LineReveal>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              style={{ fontSize: 16, lineHeight: 1.7, color: '#a4a4ad', maxWidth: 520, margin: '24px auto 0' }}
            >
              Kredity platíte jen za to, co vytvoříte. Hosting je jedno roční předplatné — €99/rok, vše ostatní v ceně.
              Začněte s <span style={{ color: '#3ecf8e', fontWeight: 600 }}>25 kredity zdarma</span>. Karta není potřeba.
            </motion.p>

            {/* Mini stat strip */}
            <motion.div
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.65 }}
              style={{
                marginTop: 40, display: 'flex', justifyContent: 'center', gap: 32,
                flexWrap: 'wrap',
              }}
            >
              {[
                { value: '€99', label: 'hosting / rok' },
                { value: '25', label: 'free credits' },
                { value: '∞', label: 'never expire' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 28, fontWeight: 700, color: '#f4f4f6', letterSpacing: '-.02em', textShadow: '0 0 24px rgba(111,120,230,.3)' }}>
                    {s.value}
                  </p>
                  <p style={{ fontSize: 11, color: '#5b5b64', marginTop: 4, letterSpacing: '.04em', textTransform: 'uppercase', fontFamily: 'var(--font-geist-mono)' }}>
                    {s.label}
                  </p>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div className="bob-anim" style={{
            position: 'absolute', bottom: 26, left: '50%', x: '-50%',
            color: '#5b5b64', fontSize: 20, zIndex: 2, opacity: cueOp,
          }}>↓</motion.div>
        </div>
      </section>

      {/* CREDIT PACKS */}
      <section style={{
        position: 'relative', padding: '6rem 1.5rem', borderTop: '1px solid rgba(255,255,255,.07)',
        overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase', textAlign: 'center',
          }}>
            01 — credit packs
          </p>
          <h2 style={{
            fontSize: 'clamp(26px,4vw,38px)', fontWeight: 700, letterSpacing: '-.025em',
            textAlign: 'center', marginBottom: 12, color: '#f4f4f6',
          }}>
            Buy what you need. Stop when you want.
          </h2>
          <p style={{ fontSize: 14, color: '#8a8a93', textAlign: 'center', maxWidth: 480, margin: '0 auto 56px', lineHeight: 1.65 }}>
            One-time payment. Credits never expire. Top up only when you actually run out.
          </p>

          <div className="pricing-grid">
            {CREDIT_PACKS.map((pack, i) => (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 0.84, 0.24, 1] }}
                whileHover={{ y: -4, transition: { duration: 0.25 } }}
                style={{
                  background: pack.popular ? '#101016' : 'rgba(12,12,16,.6)',
                  border: `1px solid ${pack.popular ? 'rgba(111,120,230,.4)' : 'rgba(255,255,255,.07)'}`,
                  borderRadius: 16, padding: '28px 22px', textAlign: 'left', position: 'relative',
                  ...(pack.popular ? { boxShadow: '0 0 50px rgba(79,91,213,.18)' } : {}),
                }}
              >
                {pack.popular && (
                  <span style={{
                    position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                    background: '#6f78e6', color: '#f4f4f6', padding: '3px 10px', borderRadius: 99,
                    boxShadow: '0 0 16px rgba(111,120,230,.5)',
                  }}>
                    Popular
                  </span>
                )}
                <p style={{
                  fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', marginBottom: 6,
                  letterSpacing: '-.02em',
                }}>
                  {pack.priceDisplay}
                </p>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#f4f4f6' }}>{pack.label}</p>
                <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.55, marginBottom: 14 }}>{pack.description}</p>
                <p style={{ fontSize: 11, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', marginBottom: 18 }}>
                  {pack.perCreditDisplay}
                </p>
                <Link href="/signup" style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: pack.popular ? '#6f78e6' : 'rgba(255,255,255,.06)',
                  color: pack.popular ? '#fff' : '#f4f4f6',
                  border: pack.popular ? 'none' : '1px solid rgba(255,255,255,.1)',
                }}>
                  Get started
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* COST TABLE */}
      <section style={{
        position: 'relative', padding: '5rem 1.5rem', borderTop: '1px solid rgba(255,255,255,.07)',
        overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase', textAlign: 'center',
          }}>
            02 — what each action costs
          </p>
          <h2 style={{
            fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 700, letterSpacing: '-.025em',
            textAlign: 'center', marginBottom: 44, color: '#f4f4f6',
          }}>
            Transparent, predictable, fair.
          </h2>

          <div style={{
            background: 'rgba(12,12,16,.6)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 14, overflow: 'hidden',
          }}>
            {COSTS.map((c, i) => (
              <motion.div
                key={c.action}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.55, delay: i * 0.06 }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 22px',
                  borderBottom: i < COSTS.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
                }}
              >
                <span style={{ fontSize: 14, color: '#f4f4f6' }}>{c.action}</span>
                <span style={{
                  fontFamily: 'var(--font-geist-mono)', fontSize: 13, fontWeight: 600,
                  color: c.unit === 'free' ? '#3ecf8e' : c.unit === '/rok' ? '#6f78e6' : '#a4a4ad',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {c.cost}<span style={{ fontSize: 11, color: c.unit === '/rok' ? '#6f78e6' : '#5b5b64' }}>{c.unit}</span>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* HOSTING */}
      <section style={{
        position: 'relative', padding: '5rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase', textAlign: 'center',
          }}>
            03 — hosting &amp; domains
          </p>
          <h2 style={{
            fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 700, letterSpacing: '-.025em',
            textAlign: 'center', marginBottom: 12, color: '#f4f4f6',
          }}>
            Your store, live in 3 minutes.
          </h2>
          <p style={{ fontSize: 14, color: '#8a8a93', textAlign: 'center', maxWidth: 460, margin: '0 auto 40px', lineHeight: 1.65 }}>
            No Vercel account, no server config, no DNS headaches. Click Deploy in the Studio and Quante handles everything.
          </p>

          <div style={{
            background: 'rgba(12,12,16,.6)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 14, overflow: 'hidden',
          }}>
            {[
              { label: 'Annual hosting plan', value: '€99 / rok · billed annually', mono: true },
              { label: 'URL format', value: 'my-store.quante.app', mono: true },
              { label: 'Custom domain', value: 'Bring your own — CNAME verified automatically', mono: false },
              { label: 'SSL certificate', value: 'Included, auto-renewed', mono: false },
              { label: 'Cost per deploy', value: '5 credits · charged on success only', mono: true },
              { label: 'Re-deploy after edits', value: 'Same URL, same domain — just updated', mono: false },
            ].map((row, i, arr) => (
              <div key={row.label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                padding: '14px 22px',
                borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: '#8a8a93' }}>{row.label}</span>
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: '#f4f4f6',
                  fontFamily: row.mono ? 'var(--font-geist-mono)' : 'inherit',
                  textAlign: 'right',
                }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: '#5b5b64', textAlign: 'center', marginTop: 16 }}>
            Prefer self-hosting? Export the ZIP (5 credits) and deploy anywhere.
          </p>
        </div>
      </section>

      {/* AGENCY */}
      <section id="agency" style={{
        position: 'relative', padding: '6rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 920, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase', textAlign: 'center',
          }}>
            04 — agency
          </p>
          <h2 style={{
            fontSize: 'clamp(26px,4vw,40px)', fontWeight: 700, letterSpacing: '-.03em',
            textAlign: 'center', marginBottom: 12, color: '#f4f4f6',
          }}>
            Build stores for clients at scale.
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', textAlign: 'center', maxWidth: 520, margin: '0 auto 56px', lineHeight: 1.65 }}>
            Flat monthly subscription. No credits to count. White-label output — clients get clean code with zero trace of this platform.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginBottom: 40 }}>
            {/* Pricing card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7 }}
              style={{
                background: '#0d1210',
                border: '1px solid rgba(62,207,142,.25)',
                borderRadius: 16, padding: '28px 28px 32px',
                display: 'flex', flexDirection: 'column', gap: 20,
              }}
            >
              <div>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '.07em',
                  padding: '2px 9px', borderRadius: 99,
                  background: 'rgba(62,207,142,.12)',
                  color: '#3ecf8e', border: '1px solid rgba(62,207,142,.25)',
                }}>
                  Agency
                </span>
                <p style={{ fontSize: 38, fontWeight: 800, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.04em', color: '#f4f4f6', margin: '14px 0 0' }}>
                  ${AGENCY_MONTHLY_USD}
                  <span style={{ fontSize: 16, fontWeight: 400, color: '#8a8a93', marginLeft: 4 }}>/month</span>
                </p>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Up to 20 active projects',
                  'Unlimited generations + iterations',
                  'Full ZIP export on every project',
                  'White-label: zero platform traces',
                  'Priority generation queue',
                  'Dedicated support channel',
                ].map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: '#c4c4cc' }}>
                    <span style={{ color: '#3ecf8e', flexShrink: 0, marginTop: 1 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <AgencyCheckoutButton />
              <p style={{ fontSize: 11, color: '#5b5b64', textAlign: 'center', margin: 0 }}>Cancel anytime · billed monthly</p>
            </motion.div>

            {/* What you don't get / positioning copy */}
            <motion.div
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              style={{
                background: 'rgba(12,12,16,.6)',
                border: '1px solid rgba(255,255,255,.07)',
                borderRadius: 16, padding: '28px 28px',
                display: 'flex', flexDirection: 'column', gap: 18,
              }}
            >
              <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', margin: 0 }}>
                Designed for agencies
              </p>
              <p style={{ fontSize: 15, color: '#f4f4f6', fontWeight: 500, lineHeight: 1.55, margin: 0 }}>
                Build stores for clients, hand them off, repeat.
              </p>
              <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.7, margin: 0 }}>
                Agency is a generation tool, not a hosted platform. Your clients receive a clean Next.js project — no Quante dependency, no vendor lock-in. They deploy it themselves or you deploy it for them.
              </p>
              <div style={{ borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['You get', 'Source code — ZIP export'],
                  ['Client gets', 'Fully portable Next.js project'],
                  ['Payments', "Client's own Stripe keys"],
                  ['Hosting', 'Anywhere — Vercel, Railway, VPS'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 12.5, color: '#c4c4cc', textAlign: 'right' }}>{value}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{
        position: 'relative', padding: '5rem 1.5rem 6rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase', textAlign: 'center',
          }}>
            05 — questions
          </p>
          <h2 style={{
            fontSize: 'clamp(24px,3.6vw,32px)', fontWeight: 700, letterSpacing: '-.025em',
            textAlign: 'center', marginBottom: 44, color: '#f4f4f6',
          }}>
            Common questions
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {FAQ.map((item, i) => (
              <motion.div
                key={item.q}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.6, delay: i * 0.07 }}
                style={{
                  padding: '20px 24px',
                  background: 'rgba(12,12,16,.6)',
                  border: '1px solid rgba(255,255,255,.07)',
                  borderRadius: 12,
                }}
              >
                <p style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6', marginBottom: 6 }}>
                  {item.q}
                </p>
                <p style={{ fontSize: 13.5, color: '#a4a4ad', lineHeight: 1.65 }}>
                  {item.a}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.07)',
        position: 'relative', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ position: 'relative', zIndex: 2, padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.03em', marginBottom: 14 }}>
            Give it a try.
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 30 }}>
            25 free credits included. No card needed.
          </p>
          <Link href="/signup" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.75rem 2rem', borderRadius: 8, display: 'inline-block',
          }}>
            Start for free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer" style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '1.5rem 1.25rem' }}>
        <Link href="/" style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: '#5b5b64', textDecoration: 'none' }}>quante</Link>
        <div className="footer-links">
          {[['Pricing', '/pricing'], ['Showcase', '/showcase'], ['About', '/about'], ['Log in', '/login']].map(([l, h]) => (
            <Link key={h} href={h} style={{ fontSize: 12, color: '#5b5b64', textDecoration: 'none' }}>{l}</Link>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>© 2026 Quante</p>
      </footer>
    </div>
  )
}
