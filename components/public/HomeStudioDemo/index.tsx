'use client'

// HomeStudioDemo — dark "product strip" section on the marketing
// homepage. Left column carries the copy (eyebrow + headline + subline
// + three proof points); right column plays a single looping video
// (public/studio-loop.mp4) that already shows the URL bar, scenario
// tabs, preview pane, build log, prompt bar and deploy toast all
// happening in real recorded motion.
//
// Earlier revision was a full scripted 3-scenario state machine
// (Design / Feature / Content tabs with a typewriter prompt bar and
// hand-rolled preview panes). That is gone now — the video captures
// the same story with higher fidelity, and the maintenance cost of
// keeping the scripted version in sync with the real Studio wasn't
// worth it. See git history if you ever need the scripted version
// back (deleted files: useStudioLoop.ts, scenarios.ts, plus the
// StudioWindow/StudioTabs/Preview/BuildLog/PromptBar/DeployToast
// helpers that used to live in this file).

import { useRef, useEffect } from 'react'

// ── Local design tokens ─────────────────────────────────────────────
// Kept from the earlier state-machine revision so the section's dark
// bg + type stack + accent match the rest of the site's Studio-style
// surfaces (StudioMiniPanel, etc.) without pulling a shared module.
const T = {
  bg: '#0a0a0a',
  border: 'rgba(255,255,255,0.08)',
  text: '#f5f5f7',
  textDim: 'rgba(245,245,247,0.72)',
  textMuted: 'rgba(245,245,247,0.48)',
  accent: 'var(--qp-accent, #D4FF3F)',
  sans: 'var(--qp-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
  mono: 'var(--qp-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace)',
} as const

export interface HomeStudioDemoProps {
  /** Section kicker number. Defaults to '01' — the section is
      currently the first numbered content strip on the homepage.
      Pass a different value if the surrounding numbering changes. */
  sectionNumber?: string
}

export default function HomeStudioDemo({ sectionNumber = '01' }: HomeStudioDemoProps) {
  // sectionRef is kept because a future revision may want to lazy-
  // mount the <video> or only start playback on scroll-into-view; the
  // hook is a stub for now (autoplay + loop covers the current spec).
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    // Reserved for future intersection-observer wiring — see comment
    // above. Deliberately no-op today.
  }, [])

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        padding: 'clamp(4rem,9vw,7rem) 1.5rem',
        background: T.bg,
        color: T.text,
      }}
    >
      {/* 1px grid at ~4% opacity, radially masked so it fades toward
          the edges. Same atmosphere the StudioMiniPanel uses. */}
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
      {/* Soft lime radial glow behind the video */}
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

      {/* Copy on top, centred. Was previously the left column of a 5/7
          split with the video on the right — swapped to a stacked
          layout so the video can render at its full intrinsic aspect
          ratio without object-fit: cover chopping the Studio nav +
          featured product tile off the sides. */}
      <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: T.mono, fontSize: 12,
            color: T.textMuted, letterSpacing: '.10em', textTransform: 'uppercase',
            marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
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
            fontSize: 'clamp(30px,4.6vw,52px)',
            fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05,
            color: T.text, margin: '0 0 16px',
          }}
        >
          Say what to change.{' '}
          <span style={{ color: T.textDim }}>Watch it ship.</span>
        </h2>

        <p
          style={{
            fontFamily: T.sans,
            fontSize: 16, lineHeight: 1.6,
            color: T.textDim, margin: '0 auto 24px',
            maxWidth: 520,
          }}
        >
          Every edit becomes real code — built, repaired if it breaks, and deployed
          to your domain. No templates, no drag-and-drop.
        </p>

        {/* Proof points — horizontal row on desktop, wraps to a stack
            on narrow viewports. */}
        <ul
          style={{
            listStyle: 'none', padding: 0, margin: 0,
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            gap: '14px 28px',
          }}
        >
          {[
            { icon: 'chat',    label: 'Plain-language edits' },
            { icon: 'wrench',  label: 'Self-repairing builds' },
            { icon: 'coin',    label: '1 edit = 1 credit' },
          ].map(p => (
            <li key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ProofIcon variant={p.icon as 'chat' | 'wrench' | 'coin'} />
              <span style={{ fontFamily: T.sans, fontSize: 14, color: T.text }}>{p.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Video below the copy, full container width. No radial mask,
          no object-fit: cover — the video plays at its intrinsic
          aspect ratio (width: 100%; height: auto) so the whole
          recorded frame is visible with nothing clipped. Rounded
          corners + deep drop shadow only. */}
      <div style={{ maxWidth: 1200, margin: 'clamp(2.5rem,6vw,4rem) auto 0', position: 'relative', zIndex: 1 }}>
        <video
          src="/studio-loop.mp4"
          autoPlay muted loop playsInline preload="metadata"
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            borderRadius: 20,
            boxShadow:
              '0 6px 16px -8px rgba(0,0,0,.25), 0 40px 90px -40px rgba(0,0,0,.65)',
          }}
        />
      </div>
    </section>
  )
}

// Small line-art icons for the three proof points. Kept from the
// earlier revision because the copy column still uses them; the rest
// of the file's hand-rolled SVG helpers (URL bar, status pill,
// traffic lights, corner brackets, log icons, coffee bag, mountain
// silhouette, etc.) live in StudioMiniPanel + the per-page preview
// panes now that the state-machine window is gone.
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
