'use client'

import { useRef, useEffect, useState } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import Link from 'next/link'
import { CREDIT_PACKS } from '@/lib/credit-packs'

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAIN_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

const STACK_CARDS = [
  { n: '01', title: "It's yours to keep", desc: "Download your store, host it anywhere, change whatever you want. No lock-in, no strings attached." },
  { n: '02', title: 'It just works', desc: "The AI handles your design and copy. The code underneath is solid — it builds and runs without issues every time." },
  { n: '03', title: 'Change anything in seconds', desc: '"Make it warmer." "Try a split layout." One message, one credit — and you see it update live.' },
  { n: '04', title: 'Nothing gets lost', desc: "Every change is saved automatically. Went too far? Jump back to any earlier version in one tap." },
]

const SHOWCASE_PROJECTS = [
  {
    url: 'Alegant.eu',
    label: 'fashion · CZ/SK',
    brand: 'ALEGANT',
    tagline: 'Dress with intention.',
    cta: 'Shop collection',
    navRight: 'Cart (0)',
    bg: '#f7f4ef',
    navBg: '#f7f4ef',
    heroBg: '#f0ece4',
    brandColor: '#1a1714',
    accentBg: '#b8955a',
    accentText: '#fff',
    brandFont: 'Georgia,serif',
    taglineSize: 15,
  },
  {
    url: 'Alegant.cz',
    label: 'fashion · CZ',
    brand: 'ALEGANT',
    tagline: 'Styl, který zůstane.',
    cta: 'Prozkoumat kolekci',
    navRight: 'Košík (0)',
    bg: '#f5f0ea',
    navBg: '#f5f0ea',
    heroBg: '#ede7dd',
    brandColor: '#1a1714',
    accentBg: '#9c7a46',
    accentText: '#fff',
    brandFont: 'Georgia,serif',
    taglineSize: 14,
  },
  {
    url: 'FromageBox.cz',
    label: 'food · subscription',
    brand: 'FromageBox',
    tagline: 'The world\'s finest cheeses, curated monthly.',
    cta: 'Start your box',
    navRight: 'My box',
    bg: '#faf5ec',
    navBg: '#faf5ec',
    heroBg: '#f2e9d8',
    brandColor: '#2d1f0e',
    accentBg: '#c9913a',
    accentText: '#fff',
    brandFont: 'Georgia,serif',
    taglineSize: 13,
  },
  {
    url: 'DocThink.app',
    label: 'SaaS · medtech',
    brand: 'DocThink',
    tagline: 'Think clearer. Decide faster.',
    cta: 'Try for free',
    navRight: 'Sign in',
    bg: '#f0f5ff',
    navBg: '#ffffff',
    heroBg: '#e8efff',
    brandColor: '#0f1729',
    accentBg: '#2563eb',
    accentText: '#fff',
    brandFont: 'system-ui,sans-serif',
    taglineSize: 15,
  },
  {
    url: 'QuanteCode',
    label: 'AI builder · meta',
    brand: 'quante',
    tagline: 'Describe your store.\nWe build it.',
    cta: 'Try it free →',
    navRight: 'Log in',
    bg: '#070709',
    navBg: 'rgba(7,7,9,.9)',
    heroBg: '#0c0c12',
    brandColor: '#f4f4f6',
    accentBg: '#6f78e6',
    accentText: '#fff',
    brandFont: 'var(--font-geist-mono)',
    taglineSize: 14,
  },
]

// ─── Math helpers ─────────────────────────────────────────────────────────────

function cl(v: number, a = 0, b = 1) { return v < a ? a : v > b ? b : v }
function eOut(p: number) { return 1 - Math.pow(1 - p, 3) }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function fp(p: number) { return eOut(cl((p - 0.12) / 0.7)) }

// ─── Sub-components ───────────────────────────────────────────────────────────

function Ambient() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
      <span className="blob-drift1" style={{
        position: 'absolute', borderRadius: '50%',
        width: 520, height: 520,
        background: 'radial-gradient(circle at center,rgba(79,91,213,.42),transparent 66%)',
        top: -120, left: -60,
      }} />
      <span className="blob-drift2" style={{
        position: 'absolute', borderRadius: '50%',
        width: 460, height: 460,
        background: 'radial-gradient(circle at center,rgba(62,207,142,.16),transparent 66%)',
        bottom: -150, right: -90,
      }} />
      <span className="blob-drift1r" style={{
        position: 'absolute', borderRadius: '50%',
        width: 380, height: 380,
        background: 'radial-gradient(circle at center,rgba(111,120,230,.30),transparent 68%)',
        top: '38%', left: '54%',
      }} />
      {[
        { left: '16%', top: '28%', delay: '0s' },
        { left: '78%', top: '34%', delay: '1.4s' },
        { left: '30%', top: '66%', delay: '2.6s' },
        { left: '64%', top: '72%', delay: '0.8s' },
        { left: '48%', top: '20%', delay: '3.4s' },
      ].map((m, i) => (
        <span key={i} className="mote-float" style={{
          position: 'absolute',
          width: 3, height: 3, borderRadius: '50%',
          background: 'rgba(184,192,255,.55)',
          left: m.left, top: m.top,
          animationDelay: m.delay,
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
          fontSize: 'clamp(34px,6.2vw,56px)',
          fontWeight: 800,
          letterSpacing: '-.035em',
          lineHeight: 1.07,
          color: blue ? '#6f78e6' : '#f4f4f6',
          ...(blue ? { textShadow: '0 0 26px rgba(79,91,213,.55),0 0 64px rgba(79,91,213,.28)' } : {}),
        }}
      >
        {children}
      </motion.span>
    </span>
  )
}

function StackCard({ card, index, total, progress }: {
  card: typeof STACK_CARDS[0]
  index: number
  total: number
  progress: MotionValue<number>
}) {
  const transform = useTransform(progress, p => {
    const f = p * (total - 1)
    const d = f - index
    const ad = Math.abs(d)
    const ty = d <= 0 ? (-d) * 72 : -d * 22
    const sc = d <= 0 ? Math.max(0.8, 1 - (-d) * 0.05) : Math.max(0.78, 1 - d * 0.07)
    return `translate(-50%,calc(-50% + ${ty.toFixed(1)}px)) scale(${sc.toFixed(3)})`
  })

  const opacity = useTransform(progress, p => {
    const f = p * (total - 1)
    const d = f - index
    return d <= 0 ? cl(1 - (-d) * 0.62) : cl(1 - d * 0.32)
  })

  const filter = useTransform(progress, p => {
    const f = p * (total - 1)
    const d = f - index
    const ad = Math.abs(d)
    const blurPx = d > 0 ? cl(d, 0, 3) * 2.4 : cl(-d, 0, 3) * 1.3
    const br = 1 - cl(ad, 0, 3) * 0.1
    return `blur(${blurPx.toFixed(2)}px) brightness(${br.toFixed(3)})`
  })

  const zIndex = useTransform(progress, p => {
    const f = p * (total - 1)
    const d = f - index
    return 120 - Math.round(Math.abs(d) * 12)
  })

  const boxShadow = useTransform(progress, p => {
    const f = p * (total - 1)
    return Math.abs(f - index) < 0.45 ? '0 0 70px rgba(79,91,213,.22)' : 'none'
  })

  return (
    <motion.div
      style={{
        position: 'absolute', left: '50%', top: '50%', width: '100%',
        background: '#101016',
        border: '1px solid rgba(255,255,255,.13)',
        borderRadius: 16, padding: 30, textAlign: 'left',
        transform, opacity, filter, zIndex, boxShadow,
      }}
    >
      <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: '#6f78e6' }}>
        {card.n}
      </span>
      <b style={{ display: 'block', margin: '14px 0 10px', fontSize: 21, fontWeight: 700, letterSpacing: '-.02em', color: '#f4f4f6' }}>
        {card.title}
      </b>
      <p style={{ margin: 0, fontSize: 14, color: '#8a8a93', lineHeight: 1.55 }}>
        {card.desc}
      </p>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const heroRef  = useRef<HTMLElement>(null)
  const stackRef = useRef<HTMLElement>(null)
  const horizRef = useRef<HTMLElement>(null)
  const hTrackRef = useRef<HTMLDivElement>(null)
  const hStageRef = useRef<HTMLDivElement>(null)
  const [maxX, setMaxX] = useState(900)

  const { scrollYProgress: heroP  } = useScroll({ target: heroRef,  offset: ['start start', 'end end'] })
  const { scrollYProgress: stackP } = useScroll({ target: stackRef, offset: ['start start', 'end end'] })
  const { scrollYProgress: horizP } = useScroll({ target: horizRef, offset: ['start start', 'end end'] })

  useEffect(() => {
    function measure() {
      if (hTrackRef.current && hStageRef.current) {
        setMaxX(Math.max(0, hTrackRef.current.scrollWidth - hStageRef.current.clientWidth))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // ── Hero transforms ──────────────────────────────────────────────────────
  const heroCopyY      = useTransform(heroP, p => -p * 72)
  const heroCopyOp     = useTransform(heroP, p => cl(1 - p * 0.92))
  const heroCopyFilter = useTransform(heroP, p => `blur(${(p * 5).toFixed(2)}px)`)

  const glowOp    = useTransform(heroP, p => cl((p - 0.1) / 0.3) * 0.95)
  const glowScale = useTransform(heroP, p => lerp(0.7, 1.28, fp(p)))

  const storeOp     = useTransform(heroP, p => Math.min(1, 0.8 + p * 2))
  const storeW      = useTransform(heroP, p => lerp(50, 98, fp(p)) + '%')
  const storeH      = useTransform(heroP, p => lerp(210, 332, fp(p)) + 'px')
  const storeR      = useTransform(heroP, p => lerp(16, 8, fp(p)) + 'px')
  const storeTrn    = useTransform(heroP, p =>
    `translateY(${lerp(28, -42, fp(p)).toFixed(1)}px) scale(${lerp(0.955, 1, fp(p)).toFixed(3)})`
  )
  const cueOp = useTransform(heroP, [0, 0.05], [1, 0])

  // ── Horizontal track ─────────────────────────────────────────────────────
  const hTrackX    = useTransform(horizP, p => -(p * maxX))
  const hProgWidth = useTransform(horizP, p => `${(p * 100).toFixed(1)}%`)

  return (
    <div style={{ background: '#070709', color: '#f4f4f6', overflowX: 'clip' }}>

      {/* ── Nav ── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: '3.5rem', display: 'flex', alignItems: 'center',
        padding: '0 2rem', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        background: 'rgba(7,7,9,.88)', backdropFilter: 'blur(10px)',
      }}>
        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }}>
          quante
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/showcase" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Showcase</Link>
          <Link href="/pricing" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/login" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" style={{
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.4rem 0.9rem', borderRadius: 6,
          }}>
            Try free →
          </Link>
        </div>
      </header>

      {/* ── HERO ── */}
      <section ref={heroRef} style={{ height: 2200, position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 44,
        }}>
          <Ambient />
          <GrainVignette />

          {/* store glow */}
          <motion.div style={{
            position: 'absolute', left: '50%', top: '60%',
            width: '62%', height: 300,
            background: 'radial-gradient(ellipse at center,rgba(79,91,213,.55),transparent 70%)',
            filter: 'blur(26px)', zIndex: 1, pointerEvents: 'none',
            x: '-50%', y: '-50%',
            opacity: glowOp, scale: glowScale,
          }} />

          {/* hero copy */}
          <motion.div style={{
            textAlign: 'center', position: 'relative', zIndex: 2,
            y: heroCopyY, opacity: heroCopyOp, filter: heroCopyFilter,
          }}>
            <motion.div
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.05 }}
              style={{
                fontFamily: 'var(--font-geist-mono)', fontSize: 11.5,
                letterSpacing: '.04em', color: '#5b5b64',
                display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20,
              }}
            >
              <span className="dot-pulse-el" style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#6f78e6', display: 'inline-block',
              }} />
              try free — 25 credits on us
            </motion.div>

            <div style={{ position: 'relative' }} className="headline-sheen">
              <LineReveal>Describe your store.</LineReveal>
              <LineReveal delay={0.13} blue>We build it.</LineReveal>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.34 }}
              style={{ fontSize: 15, lineHeight: 1.6, color: '#8a8a93', maxWidth: 430, margin: '18px auto 0' }}
            >
              Describe what you want. Get a real, working online shop — yours to download and host anywhere.
            </motion.p>
          </motion.div>

          {/* store frame */}
          <motion.div style={{
            marginTop: 32,
            background: '#f2efe9',
            border: '1px solid rgba(255,255,255,.13)',
            overflow: 'hidden', position: 'relative', zIndex: 2,
            opacity: storeOp, width: storeW, height: storeH,
            borderRadius: storeR, transform: storeTrn,
          }}>
            <div style={{ height: 24, background: '#e6e3db', display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px' }}>
              {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c4c0b5', display: 'inline-block' }} />)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
              <b style={{ fontFamily: 'Georgia,serif', letterSpacing: '.2em', fontSize: 12, color: '#1a1a18' }}>AURA</b>
              <span style={{ fontSize: 10, color: '#7a7a74' }}>Cart (0)</span>
            </div>
            <div style={{ padding: '26px 16px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Georgia,serif', fontSize: 'clamp(16px,2.6vw,24px)', color: '#1a1a18', lineHeight: 1.08 }}>
                Skin that speaks for itself.
              </div>
              <div style={{
                marginTop: 16, display: 'inline-block', fontSize: 11,
                padding: '8px 16px', borderRadius: 6,
                background: '#c8a06a', color: '#2a1e0c',
                boxShadow: '0 0 24px rgba(200,160,106,.35)',
              }}>
                Shop the ritual
              </div>
            </div>
          </motion.div>

          {/* scroll cue */}
          <motion.div className="bob-anim" style={{
            position: 'absolute', bottom: 18, left: '50%', x: '-50%',
            color: '#5b5b64', fontSize: 20, zIndex: 2, opacity: cueOp,
          }}>
            ↓
          </motion.div>
        </div>
      </section>

      {/* ── STACK — "built differently" ── */}
      <section ref={stackRef} style={{ height: 2800, position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 44,
        }}>
          <Ambient />
          <GrainVignette />

          <div style={{
            position: 'absolute', top: 42, left: 0, right: 0, textAlign: 'center', zIndex: 2,
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.04em', color: '#5b5b64',
          }}>
            02 — why it's different
          </div>

          <div style={{ position: 'relative', width: '100%', maxWidth: 460, height: 296, zIndex: 2 }}>
            {STACK_CARDS.map((card, i) => (
              <StackCard key={i} card={card} index={i} total={STACK_CARDS.length} progress={stackP} />
            ))}
          </div>
        </div>
      </section>

      {/* ── HORIZONTAL — "what quante can build" ── */}
      <section ref={horizRef} style={{ height: 2600, position: 'relative' }}>
        <div
          ref={hStageRef}
          style={{
            position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)',
            maskImage: 'linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)',
          }}
        >
          <Ambient />
          <GrainVignette />

          <div style={{
            position: 'absolute', top: 42, left: 0, right: 0, textAlign: 'center', zIndex: 2,
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.04em', color: '#5b5b64',
          }}>
            03 — built with quante →
          </div>

          <motion.div
            ref={hTrackRef}
            style={{
              display: 'flex', gap: 20, padding: '0 64px',
              position: 'relative', zIndex: 2,
              x: hTrackX,
            }}
          >
            {SHOWCASE_PROJECTS.map(p => (
              <div key={p.url} style={{
                flex: '0 0 272px',
                background: '#0c0c10',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 16, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,.5)',
              }}>
                {/* browser chrome */}
                <div style={{ height: 26, background: '#1a1a20', display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', flexShrink: 0 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i === 0 ? '#ff5f57' : i === 1 ? '#febc2e' : '#28c840', display: 'inline-block', opacity: 0.85 }} />)}
                  <span style={{
                    flex: 1, marginLeft: 8, fontSize: 9.5, color: '#5b5b64',
                    fontFamily: 'var(--font-geist-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.url}
                  </span>
                </div>

                {/* store content */}
                <div style={{ background: p.bg, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* store nav */}
                  <div style={{
                    background: p.navBg, borderBottom: `1px solid rgba(0,0,0,${p.bg === '#070709' ? '.3' : '.06'})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 14px',
                  }}>
                    <b style={{ fontFamily: p.brandFont, letterSpacing: p.brandFont.includes('mono') ? '-.01em' : '.18em', fontSize: 11, color: p.brandColor, fontWeight: p.brandFont.includes('mono') ? 600 : 700 }}>
                      {p.brand}
                    </b>
                    <span style={{ fontSize: 9, color: p.brandColor, opacity: 0.45 }}>{p.navRight}</span>
                  </div>

                  {/* hero */}
                  <div style={{
                    flex: 1, background: p.heroBg,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    padding: '22px 16px',
                    textAlign: 'center',
                  }}>
                    <div style={{
                      fontFamily: p.brandFont,
                      fontSize: p.taglineSize,
                      color: p.brandColor,
                      lineHeight: 1.25,
                      fontWeight: p.brandFont.includes('mono') ? 700 : 400,
                      letterSpacing: p.brandFont.includes('mono') ? '-.02em' : '-.01em',
                      marginBottom: 16,
                      whiteSpace: 'pre-line',
                      ...(p.bg === '#070709' ? { textShadow: '0 0 24px rgba(111,120,230,.4)' } : {}),
                    }}>
                      {p.tagline}
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 600,
                      padding: '6px 14px', borderRadius: 6,
                      background: p.accentBg, color: p.accentText,
                      boxShadow: `0 0 18px ${p.accentBg}55`,
                      letterSpacing: '-.005em',
                    }}>
                      {p.cta}
                    </div>
                  </div>
                </div>

                {/* label */}
                <div style={{
                  flexShrink: 0, padding: '9px 14px',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                  background: '#0c0c10',
                }}>
                  <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10, color: '#5b5b64' }}>{p.label}</span>
                </div>
              </div>
            ))}
          </motion.div>

          {/* progress bar */}
          <div style={{
            position: 'absolute', bottom: 34, left: 56, right: 56,
            height: 2, background: 'rgba(255,255,255,.07)', borderRadius: 2, zIndex: 2,
          }}>
            <motion.span style={{
              display: 'block', height: '100%',
              background: '#6f78e6', borderRadius: 2,
              boxShadow: '0 0 10px rgba(111,120,230,.8)',
              width: hProgWidth,
            }} />
          </div>
        </div>
      </section>

      {/* ── PRICING PREVIEW ── */}
      <section style={{
        borderTop: '1px solid rgba(255,255,255,.07)',
        padding: '7rem 2rem',
        position: 'relative', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.04em', color: '#5b5b64', marginBottom: 12 }}>
            04 — pricing
          </p>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 12 }}>
            Pay only when you create
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 48, maxWidth: 380, margin: '0 auto 48px' }}>
            No subscription. Get 25 free credits when you sign up — enough for two complete stores, no card needed.
          </p>

          <div className="pricing-grid">
            {CREDIT_PACKS.map(pack => (
              <div key={pack.id} style={{
                background: pack.popular ? '#101016' : 'transparent',
                border: `1px solid ${pack.popular ? 'rgba(111,120,230,.4)' : 'rgba(255,255,255,.07)'}`,
                borderRadius: 14, padding: '24px 20px', textAlign: 'left', position: 'relative',
                ...(pack.popular ? { boxShadow: '0 0 40px rgba(79,91,213,.15)' } : {}),
              }}>
                {pack.popular && (
                  <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                    background: '#6f78e6', color: '#f4f4f6', padding: '2px 10px', borderRadius: 99,
                  }}>
                    Popular
                  </span>
                )}
                <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', marginBottom: 4 }}>
                  {pack.priceDisplay}
                </p>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{pack.label}</p>
                <p style={{ fontSize: 12, color: '#8a8a93', marginBottom: 10 }}>{pack.description}</p>
                <p style={{ fontSize: 11, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)' }}>
                  {pack.perCreditDisplay}
                </p>
              </div>
            ))}
          </div>

          <Link href="/pricing" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Full pricing details →
          </Link>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{
        minHeight: 560, display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.07)',
        position: 'relative', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.03em', marginBottom: 16 }}>
            Ready to try it?
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 32 }}>
            Sign up in 30 seconds. 25 free credits included.
          </p>
          <Link href="/signup" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.75rem 2rem', borderRadius: 8, display: 'inline-block',
          }}>
            Try it free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer" style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '1.5rem 1.25rem' }}>
        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: '#5b5b64' }}>quante</span>
        <div className="footer-links">
          {[['Pricing', '/pricing'], ['Showcase', '/showcase'], ['Log in', '/login']].map(([l, h]) => (
            <Link key={h} href={h} style={{ fontSize: 12, color: '#5b5b64', textDecoration: 'none' }}>{l}</Link>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>© 2026 Quante</p>
      </footer>
    </div>
  )
}
