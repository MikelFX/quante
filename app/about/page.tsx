'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import Link from 'next/link'

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAIN_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

const TRAP_CARDS = [
  {
    n: '01',
    title: 'The subscription trap',
    desc: 'Most AI builders charge you every month — forever. Stop paying, lose access. Your work was never really yours.',
  },
  {
    n: '02',
    title: 'Export locked behind a tier',
    desc: 'Want to download your project? Upgrade to the highest plan. Want to self-host? Buy the enterprise add-on. The exit is always paywalled.',
  },
  {
    n: '03',
    title: 'You build on rented land',
    desc: 'Your data, your designs, your business logic — all sitting inside someone else\'s platform. One pricing change away from being held hostage.',
  },
  {
    n: '04',
    title: 'Time spent learning their UI',
    desc: 'Every locked builder has its own quirks. Hours invested learning a tool you can\'t take with you. Skills that evaporate when you switch.',
  },
]

const ROADMAP = [
  {
    code: 'I',
    name: 'QuanteCode',
    status: 'shipping now',
    statusColor: '#3ecf8e',
    headline: 'E-commerce, built by description.',
    desc: 'Describe a store. Get a real Next.js project. Export it, host it, own it. You\'re using it right now.',
    bullets: ['Manifest-driven generation', 'Live conversational editing', 'One-click ZIP export', 'Self-host anywhere'],
    accent: '#6f78e6',
    glow: 'rgba(111,120,230,.55)',
  },
  {
    code: 'II',
    name: 'QuanteCreate',
    status: 'in research',
    statusColor: '#febc2e',
    headline: 'Games. Apps. Anything complex.',
    desc: 'The same philosophy applied to richer projects — multiplayer games, internal tools, simulations. Describe the system, own the source.',
    bullets: ['Multi-file project graphs', 'Stateful backends included', 'Game-engine adapters', 'Same export-first promise'],
    accent: '#e066b8',
    glow: 'rgba(224,102,184,.5)',
  },
  {
    code: 'III',
    name: 'QuanteMarket',
    status: 'on the horizon',
    statusColor: '#5b5b64',
    headline: 'Stock-market analysis that thinks.',
    desc: 'Describe a thesis, a signal, a portfolio. Quante reasons about markets in real time — and gives you the workbook, not just the answer.',
    bullets: ['Live multi-source ingestion', 'Custom signal generation', 'Backtests as code', 'Exportable strategy files'],
    accent: '#3ecf8e',
    glow: 'rgba(62,207,142,.5)',
  },
]

// ─── Math helpers ─────────────────────────────────────────────────────────────

function cl(v: number, a = 0, b = 1) { return v < a ? a : v > b ? b : v }

// ─── Shared chrome ────────────────────────────────────────────────────────────

function Ambient({ palette }: { palette?: 'violet' | 'pink' | 'green' }) {
  const c1 = palette === 'pink' ? 'rgba(224,102,184,.34)' : palette === 'green' ? 'rgba(62,207,142,.32)' : 'rgba(79,91,213,.42)'
  const c2 = palette === 'pink' ? 'rgba(111,120,230,.22)' : palette === 'green' ? 'rgba(111,120,230,.2)' : 'rgba(62,207,142,.16)'
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
      <span className="blob-drift1" style={{
        position: 'absolute', borderRadius: '50%', width: 520, height: 520,
        background: `radial-gradient(circle at center,${c1},transparent 66%)`,
        top: -120, left: -60,
      }} />
      <span className="blob-drift2" style={{
        position: 'absolute', borderRadius: '50%', width: 460, height: 460,
        background: `radial-gradient(circle at center,${c2},transparent 66%)`,
        bottom: -150, right: -90,
      }} />
      <span className="blob-drift1r" style={{
        position: 'absolute', borderRadius: '50%', width: 380, height: 380,
        background: `radial-gradient(circle at center,${c1.replace('.42', '.28').replace('.34', '.22').replace('.32', '.22')},transparent 68%)`,
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

function LineReveal({ children, delay = 0, blue = false, italic = false }: { children: string; delay?: number; blue?: boolean; italic?: boolean }) {
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
          fontStyle: italic ? 'italic' : 'normal',
          ...(blue ? { textShadow: '0 0 26px rgba(79,91,213,.55),0 0 64px rgba(79,91,213,.28)' } : {}),
        }}
      >
        {children}
      </motion.span>
    </span>
  )
}

// ─── Trap cards (sticky stack) ────────────────────────────────────────────────

function TrapCard({ card, index, total, progress }: {
  card: typeof TRAP_CARDS[0]
  index: number
  total: number
  progress: MotionValue<number>
}) {
  const transform = useTransform(progress, p => {
    const f = p * (total - 1)
    const d = f - index
    const ty = d <= 0 ? (-d) * 72 : -d * 22
    const sc = d <= 0 ? Math.max(0.8, 1 - (-d) * 0.05) : Math.max(0.78, 1 - d * 0.07)
    return `translate(-50%,calc(-50% + ${ty.toFixed(1)}px)) scale(${sc.toFixed(3)})`
  })
  const opacity = useTransform(progress, p => {
    const f = p * (total - 1); const d = f - index
    return d <= 0 ? cl(1 - (-d) * 0.62) : cl(1 - d * 0.32)
  })
  const filter = useTransform(progress, p => {
    const f = p * (total - 1); const d = f - index; const ad = Math.abs(d)
    const blurPx = d > 0 ? cl(d, 0, 3) * 2.4 : cl(-d, 0, 3) * 1.3
    const br = 1 - cl(ad, 0, 3) * 0.1
    return `blur(${blurPx.toFixed(2)}px) brightness(${br.toFixed(3)})`
  })
  const zIndex = useTransform(progress, p => {
    const f = p * (total - 1); const d = f - index
    return 120 - Math.round(Math.abs(d) * 12)
  })
  const boxShadow = useTransform(progress, p => {
    const f = p * (total - 1)
    return Math.abs(f - index) < 0.45 ? '0 0 70px rgba(248,113,113,.18)' : 'none'
  })

  return (
    <motion.div style={{
      position: 'absolute', left: '50%', top: '50%', width: '100%',
      background: '#101016',
      border: '1px solid rgba(248,113,113,.18)',
      borderRadius: 16, padding: 30, textAlign: 'left',
      transform, opacity, filter, zIndex, boxShadow,
    }}>
      <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: '#f87171' }}>
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

// ─── Roadmap node ─────────────────────────────────────────────────────────────

function RoadmapNode({ node, trackX, cardCenter, stageW, index, cardRef }: {
  node: typeof ROADMAP[0]
  trackX: MotionValue<number>
  cardCenter: number
  stageW: number
  index: number
  cardRef: (el: HTMLDivElement | null) => void
}) {
  // distance from screen center, normalised by ~40% of stage width
  const dist = useTransform(trackX, x => {
    if (!stageW) return 1
    const screenX = cardCenter + x // card center after translation, in stage-relative px
    return Math.abs(screenX - stageW / 2) / (stageW * 0.4)
  })

  const localOpacity = useTransform(dist, d => cl(1 - d * 0.85, 0.16, 1))
  const localScale = useTransform(dist, d => cl(1.02 - d * 0.07, 0.92, 1.02))
  const nodeGlow = useTransform(dist, d => {
    const intensity = cl(1 - d, 0, 1)
    if (intensity < 0.15) return `0 0 0 ${node.glow.replace(/[\d.]+\)$/, '0)')}`
    const softGlow = node.glow.replace(/[\d.]+\)$/, `${(0.25 * intensity).toFixed(3)})`)
    return `0 0 ${(80 * intensity).toFixed(0)}px ${node.glow.replace(/[\d.]+\)$/, `${(0.55 * intensity).toFixed(3)})`)}, 0 0 ${(160 * intensity).toFixed(0)}px ${softGlow}`
  })

  return (
    <motion.div
      ref={cardRef}
      style={{
        flex: '0 0 460px', display: 'flex', flexDirection: 'column', gap: 20,
        padding: '36px 32px', background: '#0c0c10',
        border: `1px solid ${node.accent}33`,
        borderRadius: 20, position: 'relative',
        opacity: localOpacity, scale: localScale,
        boxShadow: nodeGlow,
      }}>
      {/* badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontFamily: 'var(--font-geist-mono)', fontSize: 11, fontWeight: 700,
          color: node.accent,
          padding: '3px 10px', borderRadius: 99,
          border: `1px solid ${node.accent}44`,
          background: `${node.accent}10`,
          letterSpacing: '.08em',
        }}>
          {node.code}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-geist-mono)', fontSize: 10.5, color: node.statusColor, letterSpacing: '.04em' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: node.statusColor,
            boxShadow: `0 0 8px ${node.statusColor}`,
          }} className={index === 0 ? 'dot-pulse-el' : ''} />
          {node.status}
        </span>
      </div>

      <div>
        <h3 style={{
          fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.08,
          color: '#f4f4f6', marginBottom: 8,
          textShadow: `0 0 28px ${node.glow}`,
        }}>
          {node.name}
        </h3>
        <p style={{ fontSize: 16, color: '#c4c4cc', lineHeight: 1.45, fontWeight: 500 }}>
          {node.headline}
        </p>
      </div>

      <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.65, margin: 0 }}>
        {node.desc}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {node.bullets.map(b => (
          <li key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#a4a4ad' }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: node.accent, flexShrink: 0 }} />
            {b}
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AboutPage() {
  const heroRef = useRef<HTMLElement>(null)
  const trapRef = useRef<HTMLElement>(null)
  const manifestoRef = useRef<HTMLElement>(null)
  const roadmapRef = useRef<HTMLElement>(null)
  const hStageRef = useRef<HTMLDivElement>(null)
  const hTrackRef = useRef<HTMLDivElement>(null)
  const cardElsRef = useRef<(HTMLDivElement | null)[]>([])
  const [maxX, setMaxX] = useState(0)
  const [stageW, setStageW] = useState(0)
  const [cardCenters, setCardCenters] = useState<number[]>([])

  const { scrollYProgress: heroP } = useScroll({ target: heroRef, offset: ['start start', 'end end'] })
  const { scrollYProgress: trapP } = useScroll({ target: trapRef, offset: ['start start', 'end end'] })
  const { scrollYProgress: manifestoP } = useScroll({ target: manifestoRef, offset: ['start end', 'end start'] })
  const { scrollYProgress: roadmapP } = useScroll({ target: roadmapRef, offset: ['start start', 'end end'] })

  useEffect(() => {
    function measure() {
      if (!hTrackRef.current || !hStageRef.current) return
      const trackW = hTrackRef.current.scrollWidth
      const stageWidth = hStageRef.current.clientWidth
      setStageW(stageWidth)
      setMaxX(Math.max(0, trackW - stageWidth))
      setCardCenters(cardElsRef.current.map(el => el ? el.offsetLeft + el.offsetWidth / 2 : 0))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // hero
  const heroCopyY = useTransform(heroP, p => -p * 72)
  const heroCopyOp = useTransform(heroP, p => cl(1 - p * 0.92))
  const heroCopyFilter = useTransform(heroP, p => `blur(${(p * 5).toFixed(2)}px)`)
  const cueOp = useTransform(heroP, [0, 0.05], [1, 0])

  // manifesto — large words slide in based on scroll
  const mLine1Op = useTransform(manifestoP, [0.05, 0.25], [0, 1])
  const mLine1Y = useTransform(manifestoP, [0.05, 0.25], [40, 0])
  const mLine2Op = useTransform(manifestoP, [0.18, 0.38], [0, 1])
  const mLine2Y = useTransform(manifestoP, [0.18, 0.38], [40, 0])
  const mLine3Op = useTransform(manifestoP, [0.32, 0.52], [0, 1])
  const mLine3Y = useTransform(manifestoP, [0.32, 0.52], [40, 0])
  const mLine4Op = useTransform(manifestoP, [0.5, 0.7], [0, 1])
  const mLine4Y = useTransform(manifestoP, [0.5, 0.7], [40, 0])

  // roadmap horizontal scroll — measured in pixels so cards align correctly
  const roadmapX = useTransform(roadmapP, p => -cl(p) * maxX)
  const roadmapProgress = useTransform(roadmapP, p => `${(cl(p) * 100).toFixed(1)}%`)

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
        <Link href="/" style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em', color: '#f4f4f6', textDecoration: 'none' }}>
          quante
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/showcase" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Showcase</Link>
          <Link href="/pricing" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/about" className="hidden sm:block" style={{ fontSize: 13, color: '#f4f4f6', textDecoration: 'none' }}>About</Link>
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
      <section ref={heroRef} style={{ height: 1800, position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 44,
        }}>
          <Ambient />
          <GrainVignette />

          <motion.div style={{
            textAlign: 'center', position: 'relative', zIndex: 2, maxWidth: 880,
            y: heroCopyY, opacity: heroCopyOp, filter: heroCopyFilter,
          }}>
            <motion.div
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.05 }}
              style={{
                fontFamily: 'var(--font-geist-mono)', fontSize: 11.5,
                letterSpacing: '.06em', color: '#5b5b64',
                display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 26,
                textTransform: 'uppercase',
              }}
            >
              <span className="dot-pulse-el" style={{
                width: 7, height: 7, borderRadius: '50%', background: '#6f78e6', display: 'inline-block',
              }} />
              about quante
            </motion.div>

            <div style={{ position: 'relative' }} className="headline-sheen">
              <LineReveal>Not a tool.</LineReveal>
              <LineReveal delay={0.12} blue>A path.</LineReveal>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              style={{ fontSize: 16, lineHeight: 1.7, color: '#a4a4ad', maxWidth: 540, margin: '26px auto 0' }}
            >
              Most AI builders rent you access. We hand you the keys.
              Quante is a project that builds projects — and the next one always goes further than the last.
            </motion.p>
          </motion.div>

          <motion.div className="bob-anim" style={{
            position: 'absolute', bottom: 26, left: '50%', x: '-50%',
            color: '#5b5b64', fontSize: 20, zIndex: 2, opacity: cueOp,
          }}>
            ↓
          </motion.div>
        </div>
      </section>

      {/* ── TRAP — sticky stacked cards ── */}
      <section ref={trapRef} style={{ height: 2800, position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 44,
        }}>
          <Ambient />
          <GrainVignette />

          <div style={{
            position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', zIndex: 2,
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em', color: '#5b5b64',
            textTransform: 'uppercase',
          }}>
            01 — the problem with AI builders today
          </div>

          <div style={{ position: 'absolute', top: 110, left: 0, right: 0, textAlign: 'center', zIndex: 2, padding: '0 24px' }}>
            <h2 style={{
              fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 700, letterSpacing: '-.025em',
              color: '#f4f4f6', maxWidth: 640, margin: '0 auto', lineHeight: 1.15,
            }}>
              You build the work. They keep the keys.
            </h2>
          </div>

          <div style={{ position: 'relative', width: '100%', maxWidth: 460, height: 296, zIndex: 2, marginTop: 80 }}>
            {TRAP_CARDS.map((card, i) => (
              <TrapCard key={i} card={card} index={i} total={TRAP_CARDS.length} progress={trapP} />
            ))}
          </div>
        </div>
      </section>

      {/* ── MANIFESTO — large staggered text ── */}
      <section ref={manifestoRef} style={{
        position: 'relative', padding: '8rem 1.5rem', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 36, textTransform: 'uppercase', textAlign: 'center',
          }}>
            02 — what we believe
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45em', fontSize: 'clamp(28px,4.6vw,52px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.08 }}>
            <motion.span style={{ opacity: mLine1Op, y: mLine1Y, color: '#f4f4f6' }}>
              The AI you use should make you <span style={{ color: '#6f78e6', textShadow: '0 0 32px rgba(111,120,230,.55)' }}>more independent</span>,
            </motion.span>
            <motion.span style={{ opacity: mLine2Op, y: mLine2Y, color: '#f4f4f6' }}>
              not <span style={{ fontStyle: 'italic', color: '#8a8a93' }}>more dependent.</span>
            </motion.span>
            <motion.span style={{ opacity: mLine3Op, y: mLine3Y, color: '#a4a4ad', fontSize: 'clamp(20px,3.2vw,32px)', fontWeight: 600, marginTop: '0.4em' }}>
              So we built something different —
            </motion.span>
            <motion.span style={{ opacity: mLine4Op, y: mLine4Y, color: '#f4f4f6' }}>
              a builder that <span style={{ color: '#3ecf8e', textShadow: '0 0 32px rgba(62,207,142,.55)' }}>hands you everything</span> when it's done.
            </motion.span>
          </div>

          {/* Comparison strip */}
          <div style={{
            marginTop: 80, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
            maxWidth: 880, marginInline: 'auto',
          }} className="manifesto-compare">
            <div style={{
              padding: '24px 22px', borderRadius: 14,
              border: '1px solid rgba(248,113,113,.18)',
              background: 'rgba(248,113,113,.04)',
            }}>
              <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: '#f87171', letterSpacing: '.06em', marginBottom: 10, textTransform: 'uppercase' }}>
                Other AI builders
              </p>
              {['Monthly subscription forever', 'Export is a premium add-on', 'Your code lives in their cloud', 'Pricing changes = held hostage'].map(t => (
                <p key={t} style={{ fontSize: 13.5, color: '#c4c4cc', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#f87171' }}>✕</span> {t}
                </p>
              ))}
            </div>
            <div style={{
              padding: '24px 22px', borderRadius: 14,
              border: '1px solid rgba(62,207,142,.25)',
              background: 'rgba(62,207,142,.05)',
              boxShadow: '0 0 50px rgba(62,207,142,.08)',
            }}>
              <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: '#3ecf8e', letterSpacing: '.06em', marginBottom: 10, textTransform: 'uppercase' }}>
                Quante
              </p>
              {['Pay only when you create', 'Export ships day one', 'Your code, in your hands', 'Host anywhere, forever'].map(t => (
                <p key={t} style={{ fontSize: 13.5, color: '#c4c4cc', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#3ecf8e' }}>✓</span> {t}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ROADMAP — horizontal scroll ── */}
      <section ref={roadmapRef} style={{ height: 3600, position: 'relative' }}>
        <div
          ref={hStageRef}
          style={{
            position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)',
            maskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)',
          }}
        >
          <Ambient />
          <GrainVignette />

          <div style={{
            position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', zIndex: 3,
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em', color: '#5b5b64',
            textTransform: 'uppercase',
          }}>
            03 — the roadmap
          </div>

          <div style={{ position: 'absolute', top: 110, left: 0, right: 0, textAlign: 'center', zIndex: 3, padding: '0 24px' }}>
            <h2 style={{
              fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 700, letterSpacing: '-.025em',
              color: '#f4f4f6', maxWidth: 720, margin: '0 auto', lineHeight: 1.15,
            }}>
              One project. Many futures.
            </h2>
            <p style={{ fontSize: 14, color: '#8a8a93', maxWidth: 540, margin: '14px auto 0', lineHeight: 1.6 }}>
              Quante isn't a single app — it's a series. Each release ships what the last one taught us.
            </p>
          </div>

          {/* Track */}
          <motion.div
            ref={hTrackRef}
            style={{
              display: 'flex', gap: 32, padding: '0 calc(50vw - 230px)',
              position: 'relative', zIndex: 2,
              x: roadmapX,
              alignItems: 'center',
            }}
          >
            {ROADMAP.map((node, i) => (
              <div key={node.code} style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                <RoadmapNode
                  node={node}
                  trackX={roadmapX}
                  cardCenter={cardCenters[i] ?? 0}
                  stageW={stageW}
                  index={i}
                  cardRef={el => { cardElsRef.current[i] = el }}
                />
                {i < ROADMAP.length - 1 && (
                  <div style={{
                    flex: '0 0 120px', height: 2,
                    background: `linear-gradient(90deg, ${node.accent}66, ${ROADMAP[i + 1].accent}66)`,
                    position: 'relative',
                    boxShadow: `0 0 12px ${node.accent}55`,
                  }}>
                    <span style={{
                      position: 'absolute', right: -7, top: -6, color: ROADMAP[i + 1].accent,
                      fontSize: 18, lineHeight: 1,
                    }}>
                      ▶
                    </span>
                  </div>
                )}
              </div>
            ))}
          </motion.div>

          {/* progress bar */}
          <div style={{
            position: 'absolute', bottom: 50, left: '10%', right: '10%',
            height: 2, background: 'rgba(255,255,255,.07)', borderRadius: 2, zIndex: 3,
          }}>
            <motion.span style={{
              display: 'block', height: '100%',
              background: 'linear-gradient(90deg,#6f78e6,#e066b8,#3ecf8e)',
              borderRadius: 2,
              boxShadow: '0 0 10px rgba(111,120,230,.6)',
              width: roadmapProgress,
            }} />
          </div>

          <div style={{
            position: 'absolute', bottom: 22, left: 0, right: 0, textAlign: 'center', zIndex: 3,
            fontFamily: 'var(--font-geist-mono)', fontSize: 10.5, color: '#5b5b64', letterSpacing: '.06em',
          }}>
            scroll →
          </div>
        </div>
      </section>

      {/* ── SELF-IMPROVING ── */}
      <section style={{
        position: 'relative', padding: '7rem 1.5rem', borderTop: '1px solid rgba(255,255,255,.07)',
        overflow: 'hidden',
      }}>
        <Ambient palette="green" />
        <GrainVignette />

        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 16, textTransform: 'uppercase',
          }}>
            04 — the loop
          </p>
          <h2 style={{
            fontSize: 'clamp(28px,4.6vw,44px)', fontWeight: 800, letterSpacing: '-.03em',
            lineHeight: 1.1, color: '#f4f4f6', marginBottom: 22,
          }}>
            Quante builds projects.
            <br />
            Those projects teach Quante.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.7, color: '#a4a4ad', maxWidth: 540, margin: '0 auto 56px' }}>
            Every store, every game, every signal makes the next generation sharper.
            Compounding intelligence — out in the open, exported to your machine.
          </p>

          {/* Cycle diagram */}
          <div style={{ position: 'relative', width: 360, height: 360, margin: '0 auto' }}>
            <span style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              border: '1px dashed rgba(111,120,230,.22)',
              animation: 'spin 60s linear infinite',
            }} />
            <span style={{
              position: 'absolute', inset: 22,
              borderRadius: '50%',
              border: '1px dashed rgba(62,207,142,.22)',
              animation: 'spin 80s linear infinite reverse',
            }} />
            {[
              { label: 'Describe', deg: 0, color: '#6f78e6' },
              { label: 'Generate', deg: 90, color: '#e066b8' },
              { label: 'Export', deg: 180, color: '#3ecf8e' },
              { label: 'Learn', deg: 270, color: '#f4f4f6' },
            ].map(({ label, deg, color }) => {
              const x = 50 + 44 * Math.cos((deg - 90) * Math.PI / 180)
              const y = 50 + 44 * Math.sin((deg - 90) * Math.PI / 180)
              return (
                <span key={label} style={{
                  position: 'absolute',
                  left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)',
                  fontFamily: 'var(--font-geist-mono)', fontSize: 12, fontWeight: 600,
                  color, padding: '6px 14px', borderRadius: 99,
                  background: '#0c0c10',
                  border: `1px solid ${color}55`,
                  boxShadow: `0 0 22px ${color}33`,
                }}>
                  {label}
                </span>
              )
            })}
            <span style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%,-50%)',
              fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: '#5b5b64',
            }}>
              quante
            </span>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{
        minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.07)',
        position: 'relative', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ position: 'relative', zIndex: 2, padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.03em', marginBottom: 14 }}>
            Start with QuanteCode today.
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 30 }}>
            25 free credits when you sign up. No card. No subscription.
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
