'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { Rocket, Download, CheckCircle2, MessageSquareText, History, Globe2, Link2 } from 'lucide-react'
import { CREDIT_PACKS, getPerCreditDisplay, getGenerationsCaption, formatHostingMonthly } from '@/lib/pricing'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'
import { GlassCard } from '@/components/public/GlassCard'
import { FeatureCard } from '@/components/public/FeatureCard'
import { IconTile } from '@/components/public/IconTile'
import { ZoomGallery } from '@/components/public/ZoomGallery'
import HomeStudioDemo from '@/components/public/HomeStudioDemo'

// ─── Constants ────────────────────────────────────────────────────────────────

const HERO_SHOWCASE = {
  url: 'https://maison-s-ve.stores.quantecode.com/',
  label: 'Maison Sève',
}

const STACK_CARDS = [
  { n: '01', icon: Rocket, title: 'Live in 3 minutes', desc: 'Click Deploy. Quante provisions hosting, SSL, and your subdomain automatically. Zero server setup, zero DevOps.' },
  { n: '02', icon: Download, title: "It's yours to keep", desc: 'Download the source, host it anywhere, change whatever you want. No lock-in, no strings attached.' },
  { n: '03', icon: CheckCircle2, title: 'It just works', desc: 'The AI handles your design and copy. Every build is compiled and checked before you’re charged — nothing lands broken.' },
  { n: '04', icon: MessageSquareText, title: 'Change anything in seconds', desc: '"Make it warmer." "Try a split layout." One message, one credit — and you see it update live.' },
  { n: '05', icon: History, title: 'Nothing gets lost', desc: 'Every change is saved automatically. Went too far? Jump back to any earlier version in one tap.' },
]

const STEPS = [
  { n: '01', title: 'Describe', desc: 'A few sentences about what you sell and who to.' },
  { n: '02', title: 'Generate', desc: 'The AI builds design, copy, and catalog at once.', active: true },
  { n: '03', title: 'Publish', desc: 'One click — your store is live on its own domain.' },
]

const TERMINAL_LINES = ['npx quante generate', 'designing storefront...', 'store is live → quantecode.com']

// ─── Hero ambient background (grid + scanline + cursor glow) ──────────────────

function HeroBgFX() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      document.documentElement.style.setProperty('--qp-mx', e.clientX + 'px')
      document.documentElement.style.setProperty('--qp-my', e.clientY + 'px')
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])
  return (
    <div ref={ref}>
      <div className="qp-bg-grid" />
      <div className="qp-bg-scan" />
      <div className="qp-bg-cursor" />
    </div>
  )
}

function TerminalTypewriter() {
  const elRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    let li = 0, ci = 0, deleting = false
    let timer: ReturnType<typeof setTimeout>
    function tick() {
      const full = TERMINAL_LINES[li]
      if (!deleting) {
        ci++
        el!.textContent = full.slice(0, ci)
        if (ci === full.length) { deleting = true; timer = setTimeout(tick, 1400); return }
      } else {
        ci--
        el!.textContent = full.slice(0, ci)
        if (ci === 0) { deleting = false; li = (li + 1) % TERMINAL_LINES.length }
      }
      timer = setTimeout(tick, deleting ? 28 : 45)
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="qp-terminal">
      <span className="qp-prompt">$</span><span ref={elRef} /><span className="qp-cursor">▍</span>
    </div>
  )
}

// ─── Step flow (3-step process with dashed connector + traveling dot) ─────────

function StepFlow() {
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add('qp-reveal'); obs.disconnect() } },
      { threshold: 0.3 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <section style={{ padding: 'clamp(2.5rem,6vw,4rem) 1.5rem', position: 'relative' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
        <div className="qp-steps-wrap" ref={wrapRef}>
          <div className="qp-flow-line" />
          <div className="qp-flow-dot" />
          <div className="qp-steps">
            {STEPS.map(s => (
              <div key={s.n} className={`qp-step${s.active ? ' qp-step-active' : ''}`}>
                <div className="qp-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

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

// ─── Bento feature grid ("everything Quante gives you") ───────────────────────

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add('qp-reveal'); obs.disconnect() } },
      { threshold: 0.2 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div className="qp-bento" ref={ref}>
      <div className="qp-tile qp-t-export">
        <div className="qp-t-head"><h3>Your code. Anytime.</h3><span className="qp-t-go">↗</span></div>
        <span className="qp-t-badge">no vendor lock-in</span>
        <p className="qp-t-desc">The full source is yours from the first generation. Export and leave our hosting in one click — no restrictions, no questions asked.</p>
        <div className="qp-t-term"><span className="qp-prompt">$</span> npx quante export<br />→ <span className="qp-ok">✓</span> nextjs-project.zip downloaded</div>
      </div>
      <div className="qp-tile qp-t-admin">
        <div className="qp-t-head"><h3>Admin panel</h3><span className="qp-t-go">↗</span></div>
        <p className="qp-t-desc">Orders, products, customers — all in one place.</p>
        <div className="qp-mini-rows">
          <div className="qp-mini-row"><span>Automatic invoices</span><div className="qp-toggle" /></div>
          <div className="qp-mini-row"><span>Low-stock alerts</span><div className="qp-toggle qp-off" /></div>
        </div>
      </div>
      <div className="qp-tile qp-t-analytics">
        <div className="qp-t-head"><h3>Analytics</h3><span className="qp-t-go">↗</span></div>
        <p className="qp-t-desc">Revenue, traffic, and conversion in real time.</p>
        <div className="qp-bar-chart"><span /><span /><span /><span /><span /><span /></div>
      </div>
      <div className="qp-tile qp-t-hosting">
        <div className="qp-t-head"><h3>Hosting</h3><span className="qp-t-go">↗</span></div>
        <div className="qp-big-num">99.9<span style={{ fontSize: 16 }}>%</span></div>
        <div className="qp-big-cap">uptime target, global CDN</div>
      </div>
      <div className="qp-tile qp-t-checkout">
        <div className="qp-t-head"><h3>Payments</h3><span className="qp-t-go">↗</span></div>
        <p className="qp-t-desc">Stripe Checkout built in from day one.</p>
        <div className="qp-mini-card"><span className="qp-dot-sq" /> Payment received — $49.00</div>
      </div>
      <div className="qp-tile qp-t-domains">
        <div className="qp-t-head"><h3>Domains</h3><span className="qp-t-go">↗</span></div>
        <p className="qp-t-desc">Bring your own domain in a couple of clicks.</p>
        <div className="qp-mini-card"><span className="qp-url">yourstore.com</span><span className="qp-ssl">SSL active ✓</span></div>
      </div>
      <div className="qp-tile qp-t-ai">
        <div className="qp-t-head"><h3>AI generation</h3><span className="qp-t-go">↗</span></div>
        <p className="qp-t-desc">Describe it → done in a couple of minutes.</p>
        <div className="qp-pulse-dot" />
      </div>
    </div>
  )
}

// ─── Qads homepage teaser (2nd section, right after the hero) ─────────────────
// Video is a placeholder until the user supplies the real clip — see the
// comment inside .qp-tilt-frame below for exactly what to swap in.

// Real preview clip lives in /public/qads-preview.mp4. The audit brief
// 2.3 temporarily hid the tilted panel behind a feature flag while the
// clip was missing; now that the real asset ships in the repo, the
// panel renders unconditionally. Swap the src below (or drop a new
// file at the same path) whenever a fresh cut lands — no other change
// needed, the surrounding .qp-tilt-frame styling handles the rest.
const QADS_TEASER_VIDEO_SRC = '/qads-preview.mp4'

function QadsTeaser() {
  const frameRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add('qp-reveal'); obs.disconnect() } },
      { threshold: 0.25 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section style={{ padding: 'clamp(2.5rem,6vw,4.5rem) 1.5rem', position: 'relative', overflow: 'hidden' }}>
      <div className="qp-ambient">
        <span className="qp-blob qp-blob-accent" style={{ top: -160, left: '50%', transform: 'translateX(-50%)' }} />
      </div>
      <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
        <div className="qp-kicker" style={{ justifyContent: 'center' }}><span className="qp-dot" /> new — qads</div>
        <h2 style={{ fontSize: 'clamp(24px,4.4vw,38px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.18, margin: '0 0 14px' }}>
          Now Quante builds your <span style={{ color: 'var(--qp-accent)' }}>ad campaigns</span> too.
        </h2>
        <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--qp-sub)', maxWidth: 520, margin: '0 auto' }}>
          Same store, one more description away from a full Meta and TikTok campaign — strategy, copy, creatives, and video, drafted and paused for your review.
        </p>
        <Link href="/qads" className="qp-glass qp-glass-strong" style={{
          display: 'inline-block', marginTop: 22, fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
          color: 'var(--qp-ink)', padding: '11px 22px', borderRadius: 99,
        }}>
          See how Qads works →
        </Link>
      </div>

      <div className="qp-tilt-stage" style={{ marginTop: 'clamp(2.5rem,6vw,3.5rem)' }}>
        <div className="qp-tilt-frame" ref={frameRef}>
          {/* The .qp-tilt-frame wrapper carries the radius / soft shadow /
              feathered-edge mask so the clip reads as embedded in the
              page rather than pasted on top of it. The <video> just
              needs to fill the frame. */}
          <video src={QADS_TEASER_VIDEO_SRC} autoPlay muted loop playsInline preload="metadata" poster="" />
        </div>
      </div>
    </section>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function HomePageClient() {
  return (
    <div className="qnt-public qp-home" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeroBgFX />
      <PublicNav />

      {/* ── HERO ── */}
      <section style={{ padding: 'clamp(3rem,9vw,6rem) 1.5rem clamp(2rem,6vw,3.5rem)', position: 'relative' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto' }}>
            <TerminalTypewriter />
            <div className="qp-kicker"><span className="qp-dot" /> try free — 12 credits on us</div>
            <h1 style={{
              fontSize: 'clamp(34px,7vw,62px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.08,
              margin: '0 0 18px',
            }}>
              Describe your store.<br />
              <span style={{
                background: 'linear-gradient(100deg,var(--qp-accent-deep),var(--qp-accent) 45%, var(--qp-accent-light))',
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
                fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: '#08080a',
                background: 'var(--qp-accent)',
                boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 8px 20px -10px rgba(0,0,0,.35)',
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
            <div className="qp-glow-ring" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(560px,88%)', height: 320 }} />
            {[
              // Each badge previously reused the same checkmark icon and only
              // 3 colour tiles existed, so two of the four landed on an
              // identical "plain + checkmark" look. Now every badge has its
              // own colour (accent/mint/plain/ink) and its own icon, plus a
              // slight size variation so they don't read as four copies of
              // one asset stamped around the card.
              { top: '9%', left: '2%', rot: -8, size: 64, bg: 'accent' as const, icon: <Rocket /> },
              { bottom: '13%', left: '9%', rot: 6, size: 56, bg: 'plain' as const, icon: <Globe2 /> },
              { top: '6%', right: '5%', rot: 10, size: 64, bg: 'mint' as const, icon: <CheckCircle2 /> },
              { bottom: '8%', right: '2%', rot: -6, size: 58, bg: 'ink' as const, icon: <Link2 /> },
            ].map((t, i) => (
              <div
                key={i}
                className="qp-hero-float qp-float-slow"
                style={{
                  position: 'absolute', width: t.size, height: t.size, borderRadius: 20,
                  top: t.top, bottom: t.bottom, left: t.left, right: t.right,
                  transform: `rotate(${t.rot}deg)`,
                }}
              >
                <IconTile variant={t.bg} icon={t.icon} size={t.size} />
              </div>
            ))}

            <div className="qp-liquid-glass qp-hero-store-card" style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: 'min(560px,88%)', height: 320, borderRadius: 26, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0,
                background: 'rgba(255,255,255,.05)', borderBottom: '1px solid var(--qp-line-soft)',
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,.16)' }} />
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

      {/* ── STEP FLOW ── */}
      <StepFlow />

      {/* ── QADS TEASER — moved from directly under the hero so a first-time
          visitor understands the core product (describe → generate → publish
          via the Studio) before being pitched an add-on capability. Audit
          brief 2.4. */}
      <QadsTeaser />

      {/* ── LIVING GALLERY (scroll-linked page zoom + accumulating chat) ── */}
      <section style={{ padding: 'clamp(3rem,7vw,5rem) 1.5rem', position: 'relative' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 13, color: 'var(--qp-mut)', margin: '0 0 14px', textAlign: 'center' }}>
            {'// scroll — one store, the AI zooms deeper into its pages as the chat grows alongside it'}
          </p>
          <ZoomGallery />
        </div>
      </section>

      {/* ── MANIFESTO / REVEAL ──
          No borderTop/background band here on purpose — the whole page now
          sits on one continuous --qp-bg with the fixed grid/scan/cursor
          layers running underneath uninterrupted, per "one long page, not
          separate boxed sections" feedback. Content is still visually
          distinguished by spacing and scroll-reveal, just not by hard
          seams (hairlines) or alternating background bands. */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', position: 'relative', overflow: 'hidden' }}>
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
                  <span style={{ color: '#B8443A' }}>✕</span> {t}
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
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', position: 'relative', overflow: 'hidden' }}>
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

      {/* ── INSIDE THE STUDIO — animated demo of the actual iteration loop.
          Replaces the previous "// the same system inside the Studio" chat
          + video panel (which was flagged as template-y in the brief).
          Numbered 04 so it slots between "why it's different" (03) and
          "everything you get" (05). */}
      <HomeStudioDemo sectionNumber="04" />

      {/* ── EVERYTHING YOU GET (bento grid) ── */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-mint" style={{ top: -100, left: '10%' }} />
          <span className="qp-blob qp-blob-accent" style={{ bottom: -140, right: '6%' }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 260, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 560, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>05 — everything you get</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
            Click Deploy. You&apos;re live.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--qp-sub)', margin: '20px auto 0' }}>
            No servers to configure, no Vercel account needed — hosting, payments, and the full source code, all in one place.
          </p>
        </div>

        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <BentoGrid />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44, position: 'relative', zIndex: 2, padding: '0 1rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--qp-accent-wash)',
            border: '1px solid var(--qp-line)', borderRadius: 99, padding: '9px 18px',
            fontFamily: 'var(--qp-mono)', fontSize: 'clamp(10.5px,3vw,12.5px)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--qp-accent)', boxShadow: '0 0 0 4px var(--qp-accent-wash)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>my-store.stores.quantecode.com</span>
            <span style={{ opacity: 0.65, marginLeft: 2 }}>· live · ssl ✓</span>
          </div>
        </div>
      </section>

      {/* ── PRICING PREVIEW ── */}
      <section style={{ padding: 'clamp(3rem,6vw,4.5rem) 1.5rem', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -120, right: -100 }} />
          <span className="qp-blob qp-blob-wide" style={{ top: 220, left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div className="qp-kicker" style={{ justifyContent: 'center' }}>06 — pricing</div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15, margin: 0 }}>
            No subscription to build.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--qp-sub)', margin: '20px auto 0' }}>
            Credits for AI creation. Optional hosting from {formatHostingMonthly()} with SSL and CDN. 12 free credits on signup — no card required.
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
                    background: 'var(--qp-accent)', color: '#08080a', padding: '3px 12px', borderRadius: 99,
                  }}>
                    Popular
                  </span>
                )}
                <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 26, fontWeight: 700, margin: '0 0 6px', lineHeight: 1 }}>
                  {pack.priceDisplay}
                </p>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 6px' }}>{pack.label} · {pack.credits} credits</p>
                <p style={{ fontSize: 12.5, color: 'var(--qp-sub)', margin: '0 0 14px', lineHeight: 1.5 }}>{getGenerationsCaption(pack)}</p>
                <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', margin: 0 }}>
                  {getPerCreditDisplay(pack)}
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
      <section style={{ padding: 'clamp(3.5rem,8vw,6rem) 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="qp-ambient">
          <span className="qp-blob qp-blob-accent" style={{ top: -160, left: '20%' }} />
          <span className="qp-blob qp-blob-mint" style={{ bottom: -160, right: '20%' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 'clamp(27px,4.6vw,42px)', fontWeight: 800, letterSpacing: '-.03em', margin: '0 0 14px' }}>
            Ready to try it?
          </h2>
          <p style={{ fontSize: 15.5, color: 'var(--qp-sub)', margin: '0 0 30px' }}>
            Sign up in 30 seconds. 12 free credits included.
          </p>
          <Link href="/signup" style={{
            fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: '#08080a',
            background: 'var(--qp-accent)',
            boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 8px 20px -10px rgba(0,0,0,.35)',
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
