'use client'

// StudioMiniPanel — smaller sibling of HomeStudioDemo's StudioWindow.
// A single scenario auto-plays when the panel scrolls into view, then
// holds the final state. No tabs, no restart, no "scenario switching"
// state machine — just one prompt → build → deploy loop that reads as
// a mini version of the flagship homepage demo.
//
// Reused across marketing pages (/pricing, /qads, /contact,
// /showcase) so the same visual language shows up wherever a page
// needs a "here's what the Studio does with this data" moment. Each
// page passes its own scenario data via props.
//
// SSR: renders the finished state statically so the panel is visible
// (and semantically meaningful) before hydration. The animation is
// progressive enhancement layered on top when JS lands.

import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

// ── Local design tokens ─────────────────────────────────────────────
// Mirrors HomeStudioDemo's palette so a page using both doesn't drift.
const T = {
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

// macOS-authentic traffic-light colours — the flat gray dots the old
// panel used read as an incomplete "wireframe" mock; the real system
// palette lets the browser chrome look like a browser at a glance.
const TRAFFIC_LIGHTS = {
  red:    { base: '#ff5f57', ring: '#e04b42' },
  yellow: { base: '#febc2e', ring: '#dea129' },
  green:  { base: '#28c840', ring: '#1eaa2f' },
} as const

export type MiniLogState = 'running' | 'pass' | 'fail'
export interface MiniLogStep {
  text: string
  state: MiniLogState
  /** Only meaningful when state is 'fail'. Milliseconds to hold before flip. */
  holdMs?: number
}

export interface MiniScenario {
  /** URL shown in the URL bar. */
  url: string
  /** Prompt that gets typed into the prompt bar. */
  prompt: string
  /** Build log lines that enter one at a time. */
  logSteps: MiniLogStep[]
  /** Toast copy shown after the deploy completes. Default: "Live · Ns". */
  toastLabel?: string
}

interface StudioMiniPanelProps {
  scenario: MiniScenario
  /** Preview area content — usually the "before" state; the panel
      swaps to `previewAfter` at the same time the transition plays. */
  previewBefore: ReactNode
  /** Preview area content shown after the transition. Falls back to
      `previewBefore` when omitted (useful for typing-indicator panels
      where the preview doesn't visibly change). */
  previewAfter?: ReactNode
}

interface MiniState {
  typedPrompt: string
  sendPressed: boolean
  logs: { text: string; state: MiniLogState }[]
  status: 'ready' | 'building' | 'live'
  transitionProgress: number
  showToast: boolean
  showPromptCaret: boolean
}

type Action =
  | { type: 'setPrompt'; value: string }
  | { type: 'clearPrompt' }
  | { type: 'sendPress'; pressed: boolean }
  | { type: 'setStatus'; value: MiniState['status'] }
  | { type: 'addLog'; step: MiniState['logs'][number] }
  | { type: 'flipLastLogToPass' }
  | { type: 'setTransition'; progress: number }
  | { type: 'setToast'; value: boolean }
  | { type: 'setCaret'; value: boolean }
  | { type: 'reset' }

const initialState: MiniState = {
  typedPrompt: '',
  sendPressed: false,
  logs: [],
  status: 'ready',
  transitionProgress: 0,
  showToast: false,
  showPromptCaret: true,
}

function reducer(state: MiniState, a: Action): MiniState {
  switch (a.type) {
    case 'setPrompt':       return { ...state, typedPrompt: a.value }
    case 'clearPrompt':     return { ...state, typedPrompt: '' }
    case 'sendPress':       return { ...state, sendPressed: a.pressed }
    case 'setStatus':       return { ...state, status: a.value }
    case 'addLog':          return { ...state, logs: [...state.logs, a.step] }
    case 'flipLastLogToPass': {
      const last = state.logs.length - 1
      if (last < 0) return state
      return { ...state, logs: state.logs.map((s, i) => i === last ? { ...s, state: 'pass' } : s) }
    }
    case 'setTransition':   return { ...state, transitionProgress: a.progress }
    case 'setToast':        return { ...state, showToast: a.value }
    case 'setCaret':        return { ...state, showPromptCaret: a.value }
    case 'reset':           return initialState
    default:                return state
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// One-shot loop constants. Different from HomeStudioDemo's TIMING
// because this is a smaller, faster panel — the whole animation
// completes in ~5s vs ~8s per scenario there.
const MINI_TIMING = {
  typeCharMs: 25,
  sendPressMs: 130,
  logLineInterval: 350,
  transitionMs: 700,
  liveDelay: 150,
  toastDurationMs: 4000, // How long the toast stays up before this panel is "done".
}

const LOG_ROW_HEIGHT = 22
const LOG_MAX_VISIBLE = 3

export function StudioMiniPanel({ scenario, previewBefore, previewAfter }: StudioMiniPanelProps) {
  const reduceMotion = !!useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true) /* one-shot — no un-set */ },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      // Reduced-motion: render finished state, skip animation.
      dispatch({ type: 'setPrompt', value: scenario.prompt })
      scenario.logSteps.forEach(s => dispatch({ type: 'addLog', step: { text: s.text, state: 'pass' } }))
      dispatch({ type: 'setStatus', value: 'live' })
      dispatch({ type: 'setTransition', progress: 1 })
      dispatch({ type: 'setToast', value: true })
      dispatch({ type: 'setCaret', value: false })
      return
    }
    if (!inView) return

    const controller = new AbortController()
    const { signal } = controller

    async function play() {
      try {
        // 1. Type prompt.
        for (let i = 1; i <= scenario.prompt.length; i++) {
          if (signal.aborted) return
          dispatch({ type: 'setPrompt', value: scenario.prompt.slice(0, i) })
          await sleep(MINI_TIMING.typeCharMs, signal)
        }
        // 2. Send press.
        dispatch({ type: 'sendPress', pressed: true })
        await sleep(MINI_TIMING.sendPressMs, signal)
        dispatch({ type: 'sendPress', pressed: false })
        dispatch({ type: 'clearPrompt' })
        dispatch({ type: 'setCaret', value: false })
        dispatch({ type: 'setStatus', value: 'building' })

        // 3. Build log lines.
        for (const step of scenario.logSteps) {
          if (signal.aborted) return
          const initialState = step.state === 'pass' ? 'pass' : step.state
          dispatch({ type: 'addLog', step: { text: step.text, state: initialState } })
          const holdMs = step.state === 'fail' ? (step.holdMs ?? 900) : MINI_TIMING.logLineInterval
          await sleep(holdMs, signal)
          if (step.state === 'fail') {
            dispatch({ type: 'flipLastLogToPass' })
            await sleep(MINI_TIMING.logLineInterval, signal)
          }
        }

        // 4. Preview transition.
        const start = performance.now()
        while (!signal.aborted) {
          const t = Math.min(1, (performance.now() - start) / MINI_TIMING.transitionMs)
          dispatch({ type: 'setTransition', progress: t })
          if (t >= 1) break
          await sleep(16, signal)
        }

        // 5. Live + toast.
        await sleep(MINI_TIMING.liveDelay, signal)
        dispatch({ type: 'setStatus', value: 'live' })
        dispatch({ type: 'setToast', value: true })
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') throw err
      }
    }

    play()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduceMotion])

  const isLive = state.status === 'live'

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Studio demo: ${scenario.prompt}`}
      style={{
        position: 'relative',
        width: '100%',
        // A little breathing room so the corner brackets + soft glow
        // paint outside the panel's border without being clipped.
        padding: 10,
      }}
    >
      {/* Radial chartreuse glow — subtle backlight that intensifies
          slightly when the panel is live, so the eye is pulled to the
          finished state without any hard motion. Sits behind the
          panel via position: absolute + z-index below the card. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: -20,
          background: `radial-gradient(ellipse 70% 60% at 50% 50%, rgba(212,255,63,${isLive ? 0.10 : 0.05}) 0%, transparent 70%)`,
          filter: 'blur(12px)',
          pointerEvents: 'none',
          transition: 'background 400ms ease',
          zIndex: 0,
        }}
      />

      {/* Corner brackets — 4 chartreuse L-shapes anchored to the panel
          corners (offset outward by ~4px). Small, deliberate; the
          "receipt from a machine" cue Vercel/Framer/Linear use to
          make product mocks read as intentionally framed. */}
      <CornerBrackets active={isLive} />

      <div
        style={{
          position: 'relative', zIndex: 1,
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          background: T.surface,
          overflow: 'hidden',
          boxShadow: isLive
            ? '0 20px 60px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,255,63,0.10) inset'
            : '0 20px 60px -30px rgba(0,0,0,0.6)',
          transition: 'box-shadow 400ms ease',
        }}
      >
        {/* URL bar */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderBottom: `1px solid ${T.border}`,
            background: T.surfaceRaised,
          }}
        >
          <TrafficLights />
          <UrlSslIcon status={state.status} />
          <div
            style={{
              flex: 1, minWidth: 0,
              fontFamily: T.mono, fontSize: 11, color: T.textDim,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {scenario.url}
          </div>
          <StatusPill status={state.status} />
        </div>

        <div style={{ padding: 14 }}>
          {/* Preview */}
          <div
            style={{
              position: 'relative', minHeight: 140, aspectRatio: '16 / 9',
              borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}`,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02), 0 6px 20px -12px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, opacity: previewAfter ? 1 - state.transitionProgress : 1, transition: 'opacity 100ms linear' }}>
              {previewBefore}
            </div>
            {previewAfter && (
              <div style={{ position: 'absolute', inset: 0, opacity: state.transitionProgress, transition: 'opacity 100ms linear' }}>
                {previewAfter}
              </div>
            )}
          </div>

          {/* Build log */}
          <div
            aria-live="off"
            style={{
              height: LOG_ROW_HEIGHT * LOG_MAX_VISIBLE,
              overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2,
              marginTop: 10, fontFamily: T.mono, fontSize: 11,
            }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {state.logs.slice(Math.max(0, state.logs.length - LOG_MAX_VISIBLE)).map((step, i) => {
                const absoluteIndex = state.logs.length - Math.min(state.logs.length, LOG_MAX_VISIBLE) + i
                // Fake timestamps that pace with the log-line interval
                // — enough visual variation to look like a real terminal,
                // no clock reads that would go stale in a screenshot.
                const seconds = 1 + absoluteIndex * 0.4
                const timestampMs = seconds.toFixed(1).padStart(4, '0')
                return (
                  <motion.div
                    key={`${absoluteIndex}-${step.text}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, height: LOG_ROW_HEIGHT,
                      color:
                        step.state === 'fail' ? T.amber :
                        step.state === 'pass' ? T.green :
                        T.textDim,
                      // Passed rows get a barely-there chartreuse left tick
                      // — subtle enough to not shout, obvious enough to
                      // reward the eye scanning downwards.
                      borderLeft: step.state === 'pass'
                        ? '2px solid rgba(212,255,63,0.35)'
                        : '2px solid transparent',
                      paddingLeft: 6,
                    }}
                  >
                    <span style={{
                      fontFamily: T.mono, fontSize: 9,
                      color: T.textMuted, letterSpacing: '.02em',
                      minWidth: 26, textAlign: 'right', flexShrink: 0,
                    }}>
                      {timestampMs}s
                    </span>
                    <LogIcon state={step.state} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {step.text}
                    </span>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>

          {/* Prompt bar */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8,
              border: `1px solid ${T.borderStrong}`,
              background: T.surface, marginTop: 10,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            {/* Slash-command hint at the leading edge — reinforces that
                this is a prompt surface, not a URL bar. */}
            <span style={{
              fontFamily: T.mono, fontSize: 10, color: T.textMuted,
              padding: '2px 5px', borderRadius: 4,
              border: `1px solid ${T.border}`,
              flexShrink: 0,
            }}>
              /
            </span>
            <div
              style={{
                flex: 1, minWidth: 0,
                fontFamily: T.mono, fontSize: 11, color: T.text,
                display: 'flex', alignItems: 'center', gap: 1,
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}
            >
              <span>{state.typedPrompt || <span style={{ color: T.textMuted }}>Type an edit…</span>}</span>
              {state.showPromptCaret && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{ display: 'inline-block', width: 2, height: 12, background: T.accent, marginLeft: 2 }}
                />
              )}
            </div>
            {/* ⌘K hint — signals "keyboard-driven, real tool" without
                actually claiming a shortcut we don't own. */}
            <span style={{
              fontFamily: T.mono, fontSize: 9, color: T.textMuted,
              padding: '2px 5px', borderRadius: 4,
              border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.02)',
              letterSpacing: '.04em',
              flexShrink: 0,
            }}>
              ⌘K
            </span>
            <motion.button
              type="button" tabIndex={-1} aria-hidden="true"
              animate={{ scale: state.sendPressed ? 0.9 : 1 }}
              transition={{ duration: 0.13, ease: 'easeOut' }}
              style={{
                border: 'none', cursor: 'default',
                background: T.accent, color: T.accentInk,
                fontFamily: T.mono, fontSize: 10, fontWeight: 700,
                padding: '5px 10px', borderRadius: 5, letterSpacing: '.02em',
                // Subtle backlit glow behind the accent button so it
                // reads as the primary affordance without hover.
                boxShadow: '0 0 12px rgba(212,255,63,0.35), inset 0 1px 0 rgba(255,255,255,0.35)',
              }}
            >
              Send
            </motion.button>
          </div>

          {/* Toast (reserved height so it doesn't cause layout shift) */}
          <div style={{ height: 32, display: 'flex', alignItems: 'center', marginTop: 10 }}>
            <AnimatePresence>
              {state.showToast && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px 6px 10px', borderRadius: 999,
                    background: 'rgba(62,207,142,0.10)',
                    border: '1px solid rgba(62,207,142,0.35)',
                    color: T.green, fontFamily: T.mono, fontSize: 10.5,
                    boxShadow: '0 4px 16px -8px rgba(62,207,142,0.35)',
                  }}
                >
                  <svg viewBox="0 0 12 12" width={12} height={12} style={{ flexShrink: 0 }}>
                    <circle cx="6" cy="6" r="5.5" fill="none" stroke={T.green} strokeWidth={1.2} opacity={0.5} />
                    <path d="M3.5 6.2 L5.3 7.8 L8.5 4.6" fill="none" stroke={T.green} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {scenario.toastLabel ?? 'Live'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrafficLights() {
  // 3D-ish traffic lights: base circle + inner gradient highlight
  // catches a "light source" from the top-left. Deliberately kept
  // small (7px) so they read as native browser chrome instead of
  // dominating the panel header.
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[TRAFFIC_LIGHTS.red, TRAFFIC_LIGHTS.yellow, TRAFFIC_LIGHTS.green].map(l => (
        <span
          key={l.base}
          style={{
            width: 9, height: 9, borderRadius: '50%',
            background: `radial-gradient(circle at 30% 30%, ${l.base} 0%, ${l.base} 55%, ${l.ring} 100%)`,
            boxShadow: 'inset 0 0.5px 0.5px rgba(255,255,255,0.4), 0 0.5px 1px rgba(0,0,0,0.35)',
          }}
        />
      ))}
    </div>
  )
}

function UrlSslIcon({ status }: { status: MiniState['status'] }) {
  // Padlock switches from muted (Ready/Building) to chartreuse (Live)
  // — a tiny detail that syncs with the URL bar visually flipping
  // from "draft" to "live" without any text change.
  const color =
    status === 'live' ? T.accent :
    T.textMuted
  return (
    <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M4 5.5 V4 a2 2 0 0 1 4 0 V5.5" fill="none" stroke={color as string} strokeWidth={1.2} strokeLinecap="round" />
      <rect x="3" y="5.5" width="6" height="4.5" rx="1" fill="none" stroke={color as string} strokeWidth={1.2} />
      <circle cx="6" cy="7.6" r="0.7" fill={color as string} />
    </svg>
  )
}

function CornerBrackets({ active }: { active: boolean }) {
  // Four L-shaped corner brackets, offset outward by 4px so they
  // "frame" the card without touching its border. Get a bit brighter
  // when the demo goes live — same "yes it finished" signal the
  // outer glow uses.
  const stroke = active ? 'var(--qp-accent, #D4FF3F)' : 'rgba(212,255,63,0.40)'
  const opacity = active ? 1 : 0.7
  const armLength = 10
  const inset = 4
  const bracket = (position: 'tl' | 'tr' | 'bl' | 'br') => {
    const isRight = position === 'tr' || position === 'br'
    const isBottom = position === 'bl' || position === 'br'
    // Draw a small L: horizontal arm + vertical arm meeting at the
    // corner. SVG size matches armLength + line width padding.
    const svgSize = armLength + 2
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          [isRight ? 'right' : 'left']: inset,
          [isBottom ? 'bottom' : 'top']: inset,
          width: svgSize, height: svgSize,
          transform: `${isRight ? 'scaleX(-1)' : ''}${isBottom ? ' scaleY(-1)' : ''}`.trim(),
          pointerEvents: 'none',
          opacity,
          transition: 'opacity 400ms ease',
        }}
      >
        <svg viewBox={`0 0 ${svgSize} ${svgSize}`} width={svgSize} height={svgSize}>
          <path
            d={`M 1 ${armLength + 1} L 1 1 L ${armLength + 1} 1`}
            fill="none" stroke={stroke} strokeWidth={1.2} strokeLinecap="round"
          />
        </svg>
      </div>
    )
  }
  return (
    <>
      {bracket('tl')}
      {bracket('tr')}
      {bracket('bl')}
      {bracket('br')}
    </>
  )
}

function StatusPill({ status }: { status: MiniState['status'] }) {
  const stops: Record<MiniState['status'], { label: string; dot: string; text: string; bg: string; border: string }> = {
    ready:    { label: 'Ready',    dot: 'rgba(255,255,255,0.35)', text: T.textDim, bg: 'rgba(255,255,255,0.04)', border: T.border },
    building: { label: 'Building', dot: T.amber,                  text: T.amber,   bg: 'rgba(224,160,79,0.10)',  border: 'rgba(224,160,79,0.35)' },
    live:     { label: 'Live',     dot: T.green,                  text: T.green,   bg: 'rgba(62,207,142,0.10)',  border: 'rgba(62,207,142,0.35)' },
  }
  const s = stops[status]
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 9px 3px 8px', borderRadius: 999,
        fontFamily: T.mono, fontSize: 10, color: s.text,
        background: s.bg, border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
        boxShadow: status === 'live' ? '0 0 12px rgba(62,207,142,0.20)' : undefined,
      }}
    >
      {/* Live/Building dots get a soft outer ring for a "beacon" feel;
          Ready keeps a flat neutral dot. */}
      <span style={{ position: 'relative', width: 6, height: 6, display: 'inline-block' }}>
        {(status === 'live' || status === 'building') && (
          <motion.span
            aria-hidden="true"
            animate={{ opacity: [0.5, 0.15, 0.5], scale: [1, 1.8, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              position: 'absolute', inset: -2, borderRadius: '50%',
              background: s.dot,
              opacity: 0.4,
            }}
          />
        )}
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%', background: s.dot,
        }} />
      </span>
      {s.label}
    </div>
  )
}

function LogIcon({ state }: { state: MiniLogState }) {
  if (state === 'running') {
    return (
      <span style={{ width: 11, height: 11, position: 'relative', flexShrink: 0 }}>
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
      <svg viewBox="0 0 11 11" width={11} height={11} style={{ flexShrink: 0 }}>
        <path d="M5.5 1 L10 9 L1 9 Z" fill="none" stroke={T.amber} strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M5.5 4.5 L5.5 6.5" stroke={T.amber} strokeWidth={1.4} strokeLinecap="round" />
        <circle cx={5.5} cy={7.8} r={0.5} fill={T.amber} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 11 11" width={11} height={11} style={{ flexShrink: 0 }}>
      <path d="M2 6 L4.5 8.5 L9 3" fill="none" stroke={T.green} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
