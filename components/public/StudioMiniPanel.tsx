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

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Studio demo: ${scenario.prompt}`}
      style={{
        borderRadius: 12,
        border: `1px solid ${T.border}`,
        background: T.surface,
        overflow: 'hidden',
        boxShadow: '0 20px 60px -30px rgba(0,0,0,0.6)',
        width: '100%',
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
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
          ))}
        </div>
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
            {state.logs.slice(Math.max(0, state.logs.length - LOG_MAX_VISIBLE)).map((step, i) => (
              <motion.div
                key={`${state.logs.length - Math.min(state.logs.length, LOG_MAX_VISIBLE) + i}-${step.text}`}
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

        {/* Prompt bar */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 8,
            border: `1px solid ${T.borderStrong}`,
            background: T.surface, marginTop: 10,
          }}
        >
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
          <motion.button
            type="button" tabIndex={-1} aria-hidden="true"
            animate={{ scale: state.sendPressed ? 0.9 : 1 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            style={{
              border: 'none', cursor: 'default',
              background: T.accent, color: T.accentInk,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              padding: '5px 9px', borderRadius: 5, letterSpacing: '.02em',
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
                  padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(62,207,142,0.10)',
                  border: '1px solid rgba(62,207,142,0.35)',
                  color: T.green, fontFamily: T.mono, fontSize: 10.5,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }} />
                {scenario.toastLabel ?? 'Live'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
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
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 999,
        fontFamily: T.mono, fontSize: 10, color: s.text,
        background: s.bg, border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      <motion.span
        animate={status === 'building' ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: status === 'building' ? Infinity : 0, ease: 'easeInOut' }}
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot }}
      />
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
