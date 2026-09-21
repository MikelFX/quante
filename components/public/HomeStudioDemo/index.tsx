'use client'

// HomeStudioDemo — dark "product strip" section on the light marketing
// homepage. Shows the Studio in action across three scenarios
// (Design / Feature / Content). Read the sibling scenarios.ts for
// copy and useStudioLoop.ts for the state machine; this file owns
// the render tree and the visual system only.

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { SCENARIOS, TEXT_SWAP_DE, type Scenario, type TransitionId } from './scenarios'
import { useStudioLoop, type StudioDemoState } from './useStudioLoop'

// ── Local design tokens ─────────────────────────────────────────────
// The section runs on a dark strip regardless of the surrounding
// marketing page (currently light), so it owns its own tone palette
// instead of inheriting from --qp-*. The one shared value is the
// site's chartreuse accent, pulled from the CSS variable so a
// palette swap upstream still cascades.
const T = {
  bg: '#0a0a0a',
  surface: '#111113',
  surfaceRaised: '#161618',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  text: '#f5f5f7',
  textDim: 'rgba(245,245,247,0.72)',
  textMuted: 'rgba(245,245,247,0.48)',
  amber: '#e0a04f',
  green: '#3ecf8e',
  accent: 'var(--qp-accent, #D4FF3F)',
  accentInk: '#08080a',
  mono: 'var(--qp-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace)',
  sans: 'var(--qp-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
} as const

// The URL that shows in the mock browser bar — a live-looking
// customer subdomain rather than a stock placeholder.
const DEMO_URL = 'dulpra.quantecode.com'

// ── Sub-component: URL bar with dots + address + status pill ─────────
function UrlBar({ status }: { status: StudioDemoState['status'] }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surfaceRaised,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1, minWidth: 0,
          fontFamily: T.mono, fontSize: 12, color: T.textDim,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {DEMO_URL}
      </div>
      <StatusPill status={status} />
    </div>
  )
}

function StatusPill({ status }: { status: StudioDemoState['status'] }) {
  const stops: Record<StudioDemoState['status'], { label: string; dot: string; text: string; bg: string; border: string }> = {
    ready:    { label: 'Ready',    dot: 'rgba(255,255,255,0.35)', text: T.textDim, bg: 'rgba(255,255,255,0.04)', border: T.border },
    building: { label: 'Building', dot: T.amber,                  text: T.amber,   bg: 'rgba(224,160,79,0.10)',  border: 'rgba(224,160,79,0.35)' },
    live:     { label: 'Live',     dot: T.green,                  text: T.green,   bg: 'rgba(62,207,142,0.10)',  border: 'rgba(62,207,142,0.35)' },
  }
  const s = stops[status]
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        fontFamily: T.mono, fontSize: 11, color: s.text,
        background: s.bg, border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      <motion.span
        animate={status === 'building' ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: status === 'building' ? Infinity : 0, ease: 'easeInOut' }}
        style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }}
      />
      {s.label}
    </div>
  )
}

// ── Sub-component: Preview pane ──────────────────────────────────────
// Renders one of three states depending on the current scenario +
// transition progress. Every state is real DOM — no screenshots — so
// text stays crisp and can be edited by changing a string.
function Preview({
  scenario,
  transition,
  heroVideoSrc,
  heroVideoPoster,
}: {
  scenario: Scenario
  transition: number
  heroVideoSrc?: string
  heroVideoPoster?: string
}) {
  switch (scenario.transition) {
    case 'wipe-dark':
      return <PreviewDesignWipe transition={transition} heroVideoSrc={heroVideoSrc} heroVideoPoster={heroVideoPoster} />
    case 'size-picker':
      return <PreviewSizePicker transition={transition} />
    case 'text-swap-de':
      return <PreviewTextSwap transition={transition} />
    default:
      return null
  }
}

// Design scenario — light hero wipes to dark hero, 2px lime edge
// travels with the wipe, and (if provided) a background video fades
// in 400 ms after the wipe completes.
function PreviewDesignWipe({
  transition,
  heroVideoSrc,
  heroVideoPoster,
}: {
  transition: number
  heroVideoSrc?: string
  heroVideoPoster?: string
}) {
  // Wipe uses the whole transition window; video fades in on the
  // second half (400 ms after wipe start of an 800 ms wipe).
  const wipe = transition
  const videoFade = Math.max(0, (transition - 0.5) * 2)

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '16 / 10',
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${T.border}`,
      }}
    >
      {/* Light state — always painted; the dark layer wipes over it. */}
      <HeroLight />

      {/* Dark state — masked by the wipe. Uses clip-path from right
          to left driven by transition. */}
      <div
        style={{
          position: 'absolute', inset: 0,
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
          transition: 'clip-path 0ms',
        }}
      >
        <HeroDark videoSrc={heroVideoSrc} videoPoster={heroVideoPoster} videoFade={videoFade} />
      </div>

      {/* 2px lime edge that travels with the wipe. */}
      {wipe > 0 && wipe < 1 && (
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${wipe * 100}%`,
            width: 2, background: T.accent,
            boxShadow: `0 0 12px ${T.accent}, 0 0 24px rgba(212,255,63,0.6)`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

function HeroLight() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#f5f2ec 0%,#ece7dc 100%)',
        padding: 22,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      <div style={{ fontFamily: T.mono, fontSize: 10, color: 'rgba(0,0,0,0.45)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
        DULPRA · KAFFEE
      </div>
      <div>
        <div style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#141212', letterSpacing: '-.02em', lineHeight: 1.05, marginBottom: 6 }}>
          Coffee, roasted by candlelight.
        </div>
        <div style={{ fontFamily: T.sans, fontSize: 11, color: 'rgba(0,0,0,0.6)', maxWidth: 260, marginBottom: 12 }}>
          Small-batch roasted the day before it ships.
        </div>
        <div
          style={{
            display: 'inline-block',
            padding: '7px 14px', borderRadius: 99,
            background: '#141212', color: '#f5f2ec',
            fontFamily: T.sans, fontSize: 11, fontWeight: 600,
          }}
        >
          Shop collection
        </div>
      </div>
    </div>
  )
}

function HeroDark({
  videoSrc,
  videoPoster,
  videoFade,
}: {
  videoSrc?: string
  videoPoster?: string
  videoFade: number
}) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,#0f0f11 0%,#050506 100%)',
        padding: 22,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      <HeroVideoOrPlaceholder src={videoSrc} poster={videoPoster} opacity={videoFade} />

      <div style={{ position: 'relative', zIndex: 1, fontFamily: T.mono, fontSize: 10, color: 'rgba(245,242,236,0.55)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
        DULPRA · KAFFEE
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#f5f2ec', letterSpacing: '-.02em', lineHeight: 1.05, marginBottom: 6 }}>
          Coffee, roasted by candlelight.
        </div>
        <div style={{ fontFamily: T.sans, fontSize: 11, color: 'rgba(245,242,236,0.65)', maxWidth: 260, marginBottom: 12 }}>
          Small-batch roasted the day before it ships.
        </div>
        <div
          style={{
            display: 'inline-block',
            padding: '7px 14px', borderRadius: 99,
            background: '#f5f2ec', color: '#141212',
            fontFamily: T.sans, fontSize: 11, fontWeight: 600,
          }}
        >
          Shop collection
        </div>
      </div>
    </div>
  )
}

// Feature scenario — product block with a size picker that appears
// with scale 0.96 → 1 + fade, 400 ms.
function PreviewSizePicker({ transition }: { transition: number }) {
  const pickerOpacity = transition
  const pickerScale = 0.96 + transition * 0.04

  return (
    <div
      style={{
        position: 'relative', aspectRatio: '16 / 10', borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${T.border}`, padding: 22,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center',
        background: 'linear-gradient(180deg,#faf8f3 0%,#efeae0 100%)',
      }}
    >
      {/* Product image mock */}
      <div
        style={{
          aspectRatio: '1', borderRadius: 6,
          background: 'linear-gradient(135deg,#c9a97c 0%,#8c6d47 60%,#3a2b18 100%)',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', inset: '30% 25%',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.30)',
          }}
        />
      </div>

      {/* Product details */}
      <div>
        <div style={{ fontFamily: T.mono, fontSize: 9, color: 'rgba(0,0,0,0.45)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>
          Coffee · 250 g
        </div>
        <div style={{ fontFamily: 'Georgia,serif', fontSize: 16, fontWeight: 700, color: '#141212', letterSpacing: '-.01em', marginBottom: 4 }}>
          Slow Roast · Dark
        </div>
        <div style={{ fontFamily: T.sans, fontSize: 11, color: 'rgba(0,0,0,0.6)', marginBottom: 10 }}>
          329 CZK
        </div>

        {/* Size picker — appears with the transition */}
        <div
          style={{
            opacity: pickerOpacity,
            transform: `scale(${pickerScale})`,
            transformOrigin: 'left top',
            display: 'flex', flexDirection: 'column', gap: 6,
            marginBottom: 10,
          }}
        >
          <div style={{ fontFamily: T.mono, fontSize: 9, color: 'rgba(0,0,0,0.45)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
            Grind
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['XS', 'S', 'M', 'L', 'XL'].map((chip, i) => (
              <span
                key={chip}
                style={{
                  padding: '3px 7px', borderRadius: 5,
                  fontFamily: T.mono, fontSize: 10,
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

        <div
          style={{
            display: 'inline-block',
            padding: '6px 12px', borderRadius: 99,
            background: '#141212', color: '#f5f2ec',
            fontFamily: T.sans, fontSize: 10, fontWeight: 600,
          }}
        >
          Add to cart
        </div>
      </div>
    </div>
  )
}

// Content scenario — headline and CTA text swap word by word with a
// short blur-out / blur-in.
function PreviewTextSwap({ transition }: { transition: number }) {
  const en = ['Coffee,', 'roasted', 'by', 'candlelight.']
  const de = TEXT_SWAP_DE.headline.split(' ')
  const ctaEn = 'Shop collection'
  const ctaDe = TEXT_SWAP_DE.cta

  // Per-word swap timing — each word transitions at slightly different
  // moments so the whole line staggers. `perWordOffset` gives each word
  // a start point on the 0..1 progress line; `perWordDuration` how long
  // its own blur takes. Words that have started, taken their full time,
  // are fully DE; words not yet started are still EN; in-flight words
  // blur out and swap.
  const wordCount = Math.max(en.length, de.length)
  const perWordDuration = 0.2
  const perWordOffset = (1 - perWordDuration) / Math.max(1, wordCount - 1)

  return (
    <div
      style={{
        position: 'relative', aspectRatio: '16 / 10', borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${T.border}`, padding: 22,
        background: 'linear-gradient(180deg,#f5f2ec 0%,#ece7dc 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      <div style={{ fontFamily: T.mono, fontSize: 10, color: 'rgba(0,0,0,0.45)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
        DULPRA · KAFFEE
      </div>

      <div>
        <div
          style={{
            fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700,
            color: '#141212', letterSpacing: '-.02em', lineHeight: 1.05, marginBottom: 6,
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}
        >
          {Array.from({ length: wordCount }).map((_, i) => {
            const wordStart = i * perWordOffset
            const wordEnd = wordStart + perWordDuration
            const local = Math.max(0, Math.min(1, (transition - wordStart) / perWordDuration))
            const showDe = transition >= wordEnd - 0.001
            const blur = local < 0.5 ? local * 2 : (1 - local) * 2 // 0 → 1 → 0
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  filter: `blur(${blur * 4}px)`,
                  opacity: 1 - blur * 0.4,
                  transition: 'none',
                }}
              >
                {showDe ? (de[i] ?? '') : (en[i] ?? '')}
              </span>
            )
          })}
        </div>

        <div style={{ fontFamily: T.sans, fontSize: 11, color: 'rgba(0,0,0,0.6)', maxWidth: 260, marginBottom: 12 }}>
          Small-batch roasted the day before it ships.
        </div>

        <div
          style={{
            display: 'inline-block',
            padding: '7px 14px', borderRadius: 99,
            background: '#141212', color: '#f5f2ec',
            fontFamily: T.sans, fontSize: 11, fontWeight: 600,
            filter: `blur(${Math.max(0, Math.min(1, transition * 2 - 0.5)) < 0.5
              ? (Math.max(0, Math.min(1, transition * 2 - 0.5)) * 2) * 4
              : ((1 - Math.max(0, Math.min(1, transition * 2 - 0.5))) * 2) * 4}px)`,
          }}
        >
          {transition >= 0.9 ? ctaDe : ctaEn}
        </div>
      </div>
    </div>
  )
}

// ── Sub-component: build log ────────────────────────────────────────
// Reserves a fixed height (4 lines) so the log entering doesn't push
// the prompt bar around and cause layout shift.
const LOG_ROW_HEIGHT = 22
const LOG_MAX_VISIBLE = 4

function BuildLog({ log }: { log: StudioDemoState['log'] }) {
  const visible = log.slice(Math.max(0, log.length - LOG_MAX_VISIBLE))
  return (
    <div
      aria-live="off"
      style={{
        height: LOG_ROW_HEIGHT * LOG_MAX_VISIBLE,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        gap: 2, marginTop: 12,
        fontFamily: T.mono, fontSize: 12,
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((step, i) => (
          <motion.div
            key={`${log.length - visible.length + i}-${step.text}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              height: LOG_ROW_HEIGHT,
              color:
                step.state === 'fail'  ? T.amber :
                step.state === 'pass'  ? T.green :
                T.textDim,
            }}
          >
            <LogIcon state={step.state} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step.text}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function LogIcon({ state }: { state: StudioDemoState['log'][number]['state'] }) {
  if (state === 'running') {
    return (
      <span style={{ width: 12, height: 12, position: 'relative', flexShrink: 0 }}>
        <motion.span
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1.5px solid ${T.textMuted}`, borderTopColor: T.accent,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        />
      </span>
    )
  }
  if (state === 'fail') {
    return (
      <span style={{ width: 12, height: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg viewBox="0 0 12 12" width={12} height={12}>
          <path d="M6 1 L11 10 L1 10 Z" fill="none" stroke={T.amber} strokeWidth={1.5} strokeLinejoin="round" />
          <path d="M6 5 L6 7.5" stroke={T.amber} strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={6} cy={9} r={0.5} fill={T.amber} />
        </svg>
      </span>
    )
  }
  return (
    <span style={{ width: 12, height: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 12 12" width={12} height={12}>
        <path d="M2 6.5 L5 9 L10 3.5" fill="none" stroke={T.green} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

// ── Sub-component: prompt bar ───────────────────────────────────────
function PromptBar({
  typedPrompt,
  sendPressed,
  showCaret,
}: {
  typedPrompt: string
  sendPressed: boolean
  showCaret: boolean
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 8,
        border: `1px solid ${T.borderStrong}`,
        background: T.surface,
        marginTop: 14,
      }}
    >
      <div
        style={{
          flex: 1, minWidth: 0,
          fontFamily: T.mono, fontSize: 12, color: T.text,
          display: 'flex', alignItems: 'center', gap: 1,
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}
      >
        <span>{typedPrompt || <span style={{ color: T.textMuted }}>Type an edit…</span>}</span>
        {showCaret && (
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            style={{
              display: 'inline-block',
              width: 2, height: 14,
              background: T.accent,
              marginLeft: 2,
            }}
          />
        )}
      </div>
      <motion.button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        animate={{ scale: sendPressed ? 0.9 : 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          border: 'none', cursor: 'default',
          background: T.accent, color: T.accentInk,
          fontFamily: T.mono, fontSize: 11, fontWeight: 700,
          padding: '6px 10px', borderRadius: 6,
          letterSpacing: '.02em',
        }}
      >
        Send
      </motion.button>
    </div>
  )
}

// ── Sub-component: deploy toast ─────────────────────────────────────
function DeployToast({ visible, seconds }: { visible: boolean; seconds: number }) {
  // Height is reserved by the outer box (see StudioWindow) so this
  // doesn't cause layout shift when it appears.
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 8,
            background: 'rgba(62,207,142,0.10)', border: '1px solid rgba(62,207,142,0.35)',
            color: T.green,
            fontFamily: T.mono, fontSize: 11,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }} />
          Live · {seconds}s · 1 credit
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Sub-component: scenario tabs with progress fill ─────────────────
function StudioTabs({
  scenarioIdx,
  progress,
  onSelect,
}: {
  scenarioIdx: number
  progress: number
  onSelect: (idx: number) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Studio demo scenarios"
      style={{
        display: 'grid', gridTemplateColumns: `repeat(${SCENARIOS.length}, 1fr)`,
        gap: 8, marginBottom: 14,
      }}
    >
      {SCENARIOS.map((s, i) => {
        const active = i === scenarioIdx
        return (
          <button
            key={s.id}
            role="tab"
            aria-pressed={active}
            aria-controls="home-studio-demo-window"
            onClick={() => onSelect(i)}
            style={{
              position: 'relative', overflow: 'hidden',
              padding: '10px 12px', borderRadius: 8,
              background: active ? T.surfaceRaised : 'transparent',
              border: `1px solid ${active ? T.borderStrong : T.border}`,
              color: active ? T.text : T.textDim,
              fontFamily: T.mono, fontSize: 12,
              textAlign: 'left', cursor: 'pointer',
              transition: 'color 0.2s ease, background 0.2s ease, border-color 0.2s ease',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = T.text }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = T.textDim }}
          >
            <span
              style={{
                fontFamily: T.mono, fontSize: 10,
                color: T.textMuted,
                letterSpacing: '.10em', textTransform: 'uppercase',
                marginRight: 8,
              }}
            >
              0{i + 1}
            </span>
            {s.label}
            {active && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 0, bottom: 0,
                  height: 2, width: `${progress * 100}%`,
                  background: T.accent,
                  boxShadow: `0 0 8px ${T.accent}`,
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Sub-component: hero video-or-placeholder ────────────────────────
// Renders the passed <video> when srcs land, otherwise draws a few
// slowly drifting dark bars so the dark hero doesn't look broken.
function HeroVideoOrPlaceholder({
  src,
  poster,
  opacity,
}: {
  src?: string
  poster?: string
  opacity: number
}) {
  if (src) {
    return (
      <video
        autoPlay muted loop playsInline preload="metadata"
        poster={poster}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          opacity,
          transition: 'opacity 0.2s linear',
        }}
      >
        <source src={src} type="video/mp4" />
        <source src={src.replace(/\.mp4$/, '.webm')} type="video/webm" />
      </video>
    )
  }
  // Placeholder — 3 slow-drifting dark bars. Deliberately subtle.
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, opacity,
        transition: 'opacity 0.2s linear', pointerEvents: 'none',
      }}
    >
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          animate={{ x: ['-10%', '10%', '-10%'] }}
          transition={{ duration: 12 + i * 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', left: 0, right: 0,
            top: `${20 + i * 25}%`,
            height: 20,
            background: `rgba(255,255,255,${0.02 + i * 0.01})`,
            filter: 'blur(6px)',
          }}
        />
      ))}
    </div>
  )
}

// ── Sub-component: Studio window (all the pieces above assembled) ──
function StudioWindow({
  state,
  scenario,
  heroVideoSrc,
  heroVideoPoster,
}: {
  state: StudioDemoState
  scenario: Scenario
  heroVideoSrc?: string
  heroVideoPoster?: string
}) {
  return (
    <div
      role="img"
      id="home-studio-demo-window"
      aria-label={`Live demo of the Quante Studio: ${scenario.label} scenario. Prompt: ${scenario.prompt}`}
      style={{
        borderRadius: 12,
        border: `1px solid ${T.border}`,
        background: T.surface,
        overflow: 'hidden',
        boxShadow: '0 20px 60px -30px rgba(0,0,0,0.6)',
      }}
    >
      <UrlBar status={state.status} />

      <div style={{ padding: 16 }}>
        <Preview
          scenario={scenario}
          transition={state.transitionProgress}
          heroVideoSrc={heroVideoSrc}
          heroVideoPoster={heroVideoPoster}
        />

        <BuildLog log={state.log} />

        <PromptBar
          typedPrompt={state.typedPrompt}
          sendPressed={state.sendPressed}
          showCaret={state.phase === 'typing' || state.phase === 'sending'}
        />

        {/* Toast area: fixed height so the layout doesn't shift when
            it enters. */}
        <div style={{ height: 36, display: 'flex', alignItems: 'center', marginTop: 12 }}>
          <DeployToast visible={state.showToast} seconds={state.deploySeconds} />
        </div>
      </div>
    </div>
  )
}

// ── Main exported component ─────────────────────────────────────────
export interface HomeStudioDemoProps {
  /** MP4 (with matching .webm fallback) that plays inside the Design
      scenario's dark-hero background. Falls back to a placeholder
      animation when unset. */
  heroVideoSrc?: string
  heroVideoPoster?: string
  /** Section kicker number. Defaults to '04' to fit the current
      homepage numbering (03 stays as the SaaS-differentiation
      section). */
  sectionNumber?: string
}

export default function HomeStudioDemo({
  heroVideoSrc,
  heroVideoPoster,
  sectionNumber = '04',
}: HomeStudioDemoProps) {
  const reducedMotion = !!useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  const [playback, setPlayback] = useState({ startIdx: 0, restartKey: 0 })

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const state = useStudioLoop({
    active: inView,
    reducedMotion,
    startIdx: playback.startIdx,
    restartKey: playback.restartKey,
  })

  const scenario = SCENARIOS[state.scenarioIdx]

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        padding: 'clamp(4rem,9vw,7rem) 1.5rem',
        background: T.bg,
        color: T.text,
        overflow: 'hidden',
        // Break out of the surrounding light marketing rhythm on the
        // top and bottom edges so this section reads as its own strip.
      }}
    >
      {/* 1px grid at 4% opacity */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 60% 40%, black 40%, transparent 90%)',
          pointerEvents: 'none',
        }}
      />
      {/* Soft lime radial glow behind the window */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: '-5%', top: '20%',
          width: 720, height: 720,
          background: `radial-gradient(circle, rgba(212,255,63,0.06) 0%, transparent 62%)`,
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div
          className="home-studio-demo-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '5fr 7fr',
            gap: 48,
            alignItems: 'start',
          }}
        >
          {/* Left column — copy */}
          <div>
            <div
              style={{
                fontFamily: T.mono, fontSize: 12,
                color: T.textMuted, letterSpacing: '.10em', textTransform: 'uppercase',
                marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: T.accent, boxShadow: `0 0 0 4px rgba(212,255,63,0.15)`,
                }}
              />
              {sectionNumber} — Inside the Studio
            </div>

            <h2
              style={{
                fontFamily: T.sans,
                fontSize: 'clamp(28px,3.6vw,44px)',
                fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05,
                color: T.text, margin: '0 0 16px',
              }}
            >
              Say what to change.<br />
              <span style={{ color: T.textDim }}>Watch it ship.</span>
            </h2>

            <p
              style={{
                fontFamily: T.sans,
                fontSize: 15.5, lineHeight: 1.6,
                color: T.textDim, margin: '0 0 32px',
                maxWidth: 460,
              }}
            >
              Every edit becomes real code — built, repaired if it breaks, and deployed
              to your domain. No templates, no drag-and-drop.
            </p>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: 'chat',    label: 'Plain-language edits' },
                { icon: 'wrench',  label: 'Self-repairing builds' },
                { icon: 'coin',    label: '1 edit = 1 credit' },
              ].map(p => (
                <li key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ProofIcon variant={p.icon as 'chat' | 'wrench' | 'coin'} />
                  <span style={{ fontFamily: T.sans, fontSize: 14, color: T.text }}>{p.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right column — Studio window, allowed to bleed past the container. */}
          <div
            className="home-studio-demo-window-col"
            style={{
              position: 'relative',
              // Bleed ~40px past the right edge of the container so
              // the window feels like it extends off the page.
              marginRight: -40,
            }}
          >
            <StudioTabs
              scenarioIdx={state.scenarioIdx}
              progress={state.scenarioProgress}
              onSelect={(idx) =>
                setPlayback(p => ({ startIdx: idx, restartKey: p.restartKey + 1 }))
              }
            />

            <StudioWindow
              state={state}
              scenario={scenario}
              heroVideoSrc={heroVideoSrc}
              heroVideoPoster={heroVideoPoster}
            />
          </div>
        </div>
      </div>

      {/* Mobile stack: text first, window full-width. */}
      <style>{`
        @media (max-width: 900px) {
          .home-studio-demo-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
          .home-studio-demo-window-col { margin-right: 0 !important; }
        }
      `}</style>
    </section>
  )
}

// Small line-art icons for the three proof points. Deliberately
// hand-rolled inline SVG so we don't pull an icon set for three shapes.
function ProofIcon({ variant }: { variant: 'chat' | 'wrench' | 'coin' }) {
  const stroke = T.accent
  const common = {
    width: 22, height: 22, viewBox: '0 0 22 22',
    fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  const wrapStyle = {
    width: 34, height: 34, flexShrink: 0,
    borderRadius: 8, background: 'rgba(212,255,63,0.08)',
    border: `1px solid rgba(212,255,63,0.22)`,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <span style={wrapStyle}>
      {variant === 'chat' && (
        <svg {...common}>
          <path d="M4 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3l-3 3v-3H6a2 2 0 0 1-2-2z" />
          <path d="M7 8h8M7 11h5" />
        </svg>
      )}
      {variant === 'wrench' && (
        <svg {...common}>
          <path d="M14.5 3.5a4 4 0 0 0-5.4 4.9l-5.6 5.6a1.4 1.4 0 0 0 2 2l5.6-5.6a4 4 0 0 0 4.9-5.4l-2.4 2.4-1.9-.6-.6-1.9z" />
        </svg>
      )}
      {variant === 'coin' && (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M11 7v8M8.5 9.5c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.5-2.5 1.5-2.5.5-2.5 1.5 1 1.5 2.5 1.5 2.5-.5 2.5-1.5" />
        </svg>
      )}
    </span>
  )
}
