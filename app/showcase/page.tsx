'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import Link from 'next/link'

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

const STORE_TYPES = [
  { category: 'Skincare', name: 'Minimal skincare ritual', voice: 'Clean · editorial · warm neutral palette', accent: '#c8a06a', demo: true },
  { category: 'Fashion', name: 'Sustainable streetwear', voice: 'Bold · playful · high contrast', accent: '#e066b8' },
  { category: 'Homeware', name: 'Artisan ceramics studio', voice: 'Earthy · spacious · editorial', accent: '#b8955a' },
  { category: 'Tech', name: 'Developer tools & SaaS', voice: 'Technical · minimal · mono accents', accent: '#6f78e6' },
  { category: 'Food', name: 'Specialty coffee roastery', voice: 'Warm · rich · strong CTA focus', accent: '#c9913a' },
  { category: 'Wellness', name: 'Yoga studio & apparel', voice: 'Soft · playful · pastel palette', accent: '#84d0b8' },
]

export default function ShowcasePage() {
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
          <Link href="/showcase" className="hidden sm:block" style={{ fontSize: 13, color: '#f4f4f6', textDecoration: 'none' }}>Showcase</Link>
          <Link href="/pricing" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Pricing</Link>
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
            textAlign: 'center', position: 'relative', zIndex: 2, maxWidth: 820,
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
              showcase
            </motion.div>

            <div style={{ position: 'relative' }} className="headline-sheen">
              <LineReveal>Stores built</LineReveal>
              <LineReveal delay={0.12} blue>from a sentence.</LineReveal>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              style={{ fontSize: 16, lineHeight: 1.7, color: '#a4a4ad', maxWidth: 520, margin: '24px auto 0' }}
            >
              Each store below was generated from a one-paragraph brief —
              <br />complete, styled, ready to deploy. No manual design.
            </motion.p>
          </motion.div>

          <motion.div className="bob-anim" style={{
            position: 'absolute', bottom: 26, left: '50%', x: '-50%',
            color: '#5b5b64', fontSize: 20, zIndex: 2, opacity: cueOp,
          }}>↓</motion.div>
        </div>
      </section>

      {/* LIVE DEMO */}
      <section style={{
        position: 'relative', padding: '5rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8 }}
            style={{ marginBottom: 32 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.06em',
                    color: '#5b5b64', textTransform: 'uppercase',
                  }}>
                    01 — live demo
                  </span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)',
                  }}>
                    <span className="dot-pulse-el" style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#3ecf8e', boxShadow: '0 0 8px rgba(62,207,142,.7)',
                    }} />
                    interactive
                  </span>
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 4 }}>
                  Aura Skincare
                </h2>
                <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.55 }}>
                  Minimal skincare brand · Warm neutral palette · Playfair Display + DM Sans
                </p>
              </div>
              <Link
                href="/preview/demo"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12, color: '#8a8a93', textDecoration: 'underline',
                  textUnderlineOffset: 4, fontFamily: 'var(--font-geist-mono)',
                }}
              >
                Open full screen ↗
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 1, ease: [0.16, 0.84, 0.24, 1] }}
            style={{
              borderRadius: 16, overflow: 'hidden',
              border: '1px solid rgba(255,255,255,.1)',
              background: '#FAFAF8',
              boxShadow: '0 30px 80px rgba(0,0,0,.5), 0 0 100px rgba(79,91,213,.15)',
              height: 600,
            }}
          >
            {/* browser chrome */}
            <div style={{
              height: 30, background: '#1a1a20',
              display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px',
              borderBottom: '1px solid rgba(255,255,255,.06)',
            }}>
              {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
                <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.9 }} />
              ))}
              <span style={{
                marginLeft: 14, fontSize: 10.5, color: '#5b5b64',
                fontFamily: 'var(--font-geist-mono)',
              }}>
                aura-skincare.preview.quante
              </span>
            </div>
            <iframe
              src="/preview/demo"
              style={{ width: '100%', height: 'calc(100% - 30px)', border: 'none', display: 'block' }}
              title="Aura Skincare — Quante demo store"
              loading="lazy"
            />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.3 }}
            style={{
              fontSize: 12, color: '#5b5b64', marginTop: 14,
              fontStyle: 'italic', textAlign: 'center', maxWidth: 720, marginInline: 'auto',
              lineHeight: 1.6,
            }}
          >
            Generated from brief: &ldquo;A minimal skincare brand. EUR currency. Products: serum,
            moisturiser, cleanser, night oil. Clean editorial vibe, warm neutral palette.&rdquo;
          </motion.p>
        </div>
      </section>

      {/* STORE TYPES GRID */}
      <section style={{
        position: 'relative', padding: '6rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7 }}
            style={{ textAlign: 'center', marginBottom: 48 }}
          >
            <p style={{
              fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
              color: '#5b5b64', marginBottom: 14, textTransform: 'uppercase',
            }}>
              02 — what quante can build
            </p>
            <h2 style={{
              fontSize: 'clamp(26px,4vw,38px)', fontWeight: 700, letterSpacing: '-.025em',
              marginBottom: 14, color: '#f4f4f6',
            }}>
              Any kind of store, any voice.
            </h2>
            <p style={{ fontSize: 14, color: '#8a8a93', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 }}>
              Quante reads the brief and chooses a palette, type, density and copy voice to match.
              Each archetype below takes under 30 seconds.
            </p>
          </motion.div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}>
            {STORE_TYPES.map((store, i) => (
              <motion.div
                key={store.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: [0.16, 0.84, 0.24, 1] }}
                whileHover={{ y: -4, transition: { duration: 0.25 } }}
                style={{
                  background: store.demo ? 'rgba(12,12,16,.85)' : 'rgba(12,12,16,.5)',
                  border: `1px solid ${store.demo ? 'rgba(111,120,230,.3)' : 'rgba(255,255,255,.07)'}`,
                  borderRadius: 14,
                  padding: '20px 22px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                  position: 'relative', overflow: 'hidden',
                  ...(store.demo ? { boxShadow: '0 0 40px rgba(79,91,213,.12)' } : {}),
                }}
              >
                {/* color swatch */}
                <span style={{
                  position: 'absolute', top: 0, right: 0, width: 60, height: 60,
                  background: `radial-gradient(circle at top right, ${store.accent}60, transparent 70%)`,
                  pointerEvents: 'none',
                }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontFamily: 'var(--font-geist-mono)', fontSize: 10.5, letterSpacing: '.04em',
                    color: '#5b5b64', textTransform: 'uppercase',
                  }}>
                    {store.category}
                  </span>
                  {store.demo && (
                    <span style={{
                      fontFamily: 'var(--font-geist-mono)', fontSize: 10,
                      color: '#3ecf8e', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      live above ↑
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', letterSpacing: '-.01em' }}>
                  {store.name}
                </p>
                <p style={{ fontSize: 12.5, color: '#8a8a93', lineHeight: 1.5 }}>
                  {store.voice}
                </p>
                <span style={{
                  marginTop: 4, width: 36, height: 3, borderRadius: 2,
                  background: store.accent,
                  boxShadow: `0 0 12px ${store.accent}88`,
                }} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS strip */}
      <section style={{
        position: 'relative', padding: '6rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />

        <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <p style={{
            fontFamily: 'var(--font-geist-mono)', fontSize: 11.5, letterSpacing: '.06em',
            color: '#5b5b64', marginBottom: 16, textTransform: 'uppercase',
          }}>
            03 — how it works
          </p>
          <h2 style={{
            fontSize: 'clamp(26px,4vw,38px)', fontWeight: 700, letterSpacing: '-.025em',
            marginBottom: 48, color: '#f4f4f6',
          }}>
            Three steps. No filler.
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}>
            {[
              { n: '01', t: 'Describe', d: 'Tell Quante what kind of store you want. One sentence is enough.' },
              { n: '02', t: 'Iterate', d: 'Live preview. Adjust copy, colors, layout in chat. Each tweak is 1 credit.' },
              { n: '03', t: 'Export', d: 'Download a real Next.js project. Host anywhere. Yours forever.' },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.65, delay: i * 0.12 }}
                style={{
                  textAlign: 'left',
                  padding: '24px 22px', borderRadius: 14,
                  background: 'rgba(12,12,16,.6)',
                  border: '1px solid rgba(255,255,255,.07)',
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-geist-mono)', fontSize: 11,
                  color: '#6f78e6', letterSpacing: '.06em',
                }}>
                  {s.n}
                </span>
                <p style={{ fontSize: 18, fontWeight: 700, marginTop: 10, marginBottom: 8, color: '#f4f4f6', letterSpacing: '-.015em' }}>
                  {s.t}
                </p>
                <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.6 }}>
                  {s.d}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        minHeight: 440, display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.07)',
        position: 'relative', overflow: 'hidden',
      }}>
        <Ambient />
        <GrainVignette />
        <div style={{ position: 'relative', zIndex: 2, padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.03em', marginBottom: 14 }}>
            Build yours in minutes.
          </h2>
          <p style={{ fontSize: 15, color: '#8a8a93', marginBottom: 30 }}>
            25 free credits on signup. Describe your brand — Quante does the rest.
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
