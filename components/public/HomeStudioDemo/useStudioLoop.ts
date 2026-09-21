'use client'

// HomeStudioDemo — state machine hook.
//
// One async loop drives the whole demo. Every phase awaits a
// cancelable sleep; cancellation happens via AbortController when
// the section scrolls out of view, the user clicks a different
// scenario tab, or the component unmounts. There are no nested
// setTimeouts because they are miserable to reset cleanly on tab
// switch — the brief calls this out explicitly and the abort-token
// pattern below matches it.
//
// Tab-click semantics: parent tracks `{ startIdx, restartKey }`.
// Clicking a tab sets startIdx to that scenario AND bumps restartKey,
// which changes the effect deps → old loop aborts, new one starts at
// startIdx. Clicking the SAME tab still bumps restartKey, which
// visibly restarts the current scenario from the beginning
// (brief-mandated behaviour).
//
// The hook returns the derived UI state (which scenario, which phase,
// typed prompt, log rows, status, toast visibility, transition
// progress). The component render tree just reads state; it doesn't
// own any timers.

import { useEffect, useReducer } from 'react'
import { SCENARIOS, TIMING, type LogState, type Scenario } from './scenarios'

export type Phase =
  | 'typing'          // prompt is being typed one character at a time
  | 'sending'         // send button press animation
  | 'building'        // log lines are entering
  | 'transitioning'   // preview-side transition is playing
  | 'live'            // status flipped to Live, toast is up
  | 'holding'         // final state is being read
  | 'switching'       // crossfade to the next scenario

export interface DisplayedLogStep {
  text: string
  state: LogState
}

export interface StudioDemoState {
  scenarioIdx: number
  phase: Phase
  typedPrompt: string
  sendPressed: boolean
  log: DisplayedLogStep[]
  status: 'ready' | 'building' | 'live'
  showToast: boolean
  /** Elapsed seconds shown in the toast ("Live · Ns · 1 credit"). */
  deploySeconds: number
  /** 0 → 1 progress through the current scenario, for the tab fill bar. */
  scenarioProgress: number
  /** Transition-in-flight value (0 → 1). Preview uses this to drive the wipe / size-picker / text-swap. */
  transitionProgress: number
}

type Action =
  | { type: 'reset'; scenarioIdx: number }
  | { type: 'setPrompt'; value: string }
  | { type: 'sendPress'; pressed: boolean }
  | { type: 'clearPrompt' }
  | { type: 'setStatus'; value: 'ready' | 'building' | 'live' }
  | { type: 'addLog'; step: DisplayedLogStep }
  | { type: 'flipLastLogToPass' }
  | { type: 'setTransition'; progress: number }
  | { type: 'setToast'; value: boolean; seconds?: number }
  | { type: 'setPhase'; value: Phase }
  | { type: 'setScenarioProgress'; value: number }

const initialState = (idx = 0): StudioDemoState => ({
  scenarioIdx: idx,
  phase: 'typing',
  typedPrompt: '',
  sendPressed: false,
  log: [],
  status: 'ready',
  showToast: false,
  deploySeconds: 0,
  scenarioProgress: 0,
  transitionProgress: 0,
})

function reducer(state: StudioDemoState, action: Action): StudioDemoState {
  switch (action.type) {
    case 'reset':
      return initialState(action.scenarioIdx)
    case 'setPrompt':
      return { ...state, typedPrompt: action.value }
    case 'sendPress':
      return { ...state, sendPressed: action.pressed }
    case 'clearPrompt':
      return { ...state, typedPrompt: '' }
    case 'setStatus':
      return { ...state, status: action.value }
    case 'addLog':
      return { ...state, log: [...state.log, action.step] }
    case 'flipLastLogToPass': {
      const last = state.log.length - 1
      if (last < 0) return state
      return {
        ...state,
        log: state.log.map((s, i) => (i === last ? { ...s, state: 'pass' } : s)),
      }
    }
    case 'setTransition':
      return { ...state, transitionProgress: action.progress }
    case 'setToast':
      return {
        ...state,
        showToast: action.value,
        deploySeconds: action.seconds ?? state.deploySeconds,
      }
    case 'setPhase':
      return { ...state, phase: action.value }
    case 'setScenarioProgress':
      return { ...state, scenarioProgress: action.value }
    default:
      return state
  }
}

/**
 * Cancelable sleep. Rejects with a DOMException on abort, which the
 * outer loop catches to stop cleanly instead of throwing to React.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface UseStudioLoopOptions {
  /** Loop runs only when this is true (typically an IntersectionObserver flag). */
  active: boolean
  /** Reduced-motion users get a static final-state render; loop never starts. */
  reducedMotion: boolean
  /** Scenario index to begin the loop at. Loop advances through the rest cyclically. */
  startIdx: number
  /** Bump this to force a restart (tab click sets startIdx + bumps this). */
  restartKey: number
}

export function useStudioLoop({
  active,
  reducedMotion,
  startIdx,
  restartKey,
}: UseStudioLoopOptions) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(startIdx))

  useEffect(() => {
    if (reducedMotion) {
      // Show the Design scenario's final state statically. No loop.
      // Reduced-motion visitors don't get the demo; they get the outcome.
      const design = SCENARIOS[0]
      dispatch({ type: 'reset', scenarioIdx: 0 })
      dispatch({ type: 'setPrompt', value: design.prompt })
      design.logSteps.forEach(step => {
        dispatch({ type: 'addLog', step: { text: step.text, state: 'pass' } })
      })
      dispatch({ type: 'setStatus', value: 'live' })
      dispatch({ type: 'setTransition', progress: 1 })
      dispatch({ type: 'setToast', value: true, seconds: 4 })
      dispatch({ type: 'setPhase', value: 'holding' })
      dispatch({ type: 'setScenarioProgress', value: 1 })
      return
    }

    if (!active) return

    const controller = new AbortController()
    const { signal } = controller

    async function run() {
      try {
        let idx = startIdx
        while (!signal.aborted) {
          await playScenario(idx, signal)
          idx = (idx + 1) % SCENARIOS.length
        }
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') throw err
      }
    }

    async function playScenario(idx: number, sig: AbortSignal) {
      const scenario: Scenario = SCENARIOS[idx]

      // Fresh state per scenario.
      dispatch({ type: 'reset', scenarioIdx: idx })
      dispatch({ type: 'setStatus', value: 'ready' })

      // ── 1. Type the prompt. ──
      dispatch({ type: 'setPhase', value: 'typing' })
      for (let i = 1; i <= scenario.prompt.length; i++) {
        if (sig.aborted) return
        dispatch({ type: 'setPrompt', value: scenario.prompt.slice(0, i) })
        await sleep(TIMING.typeCharMs, sig)
        dispatch({
          type: 'setScenarioProgress',
          value: (i / scenario.prompt.length) * 0.17,
        })
      }

      // ── 2. Send-button press. ──
      dispatch({ type: 'setPhase', value: 'sending' })
      dispatch({ type: 'sendPress', pressed: true })
      await sleep(TIMING.sendPressMs, sig)
      dispatch({ type: 'sendPress', pressed: false })
      dispatch({ type: 'clearPrompt' })
      dispatch({ type: 'setStatus', value: 'building' })

      // ── 3. Log lines enter one at a time. Fail step holds then flips. ──
      dispatch({ type: 'setPhase', value: 'building' })
      for (let i = 0; i < scenario.logSteps.length; i++) {
        if (sig.aborted) return
        const step = scenario.logSteps[i]
        // Insert as running first (unless it's already a natural pass
        // — e.g. "Build passed" / "Deployed" — in which case it enters
        // already green so the icon doesn't spin).
        const isPassOnEntry = step.state === 'pass'
        dispatch({
          type: 'addLog',
          step: { text: step.text, state: isPassOnEntry ? 'pass' : step.state },
        })
        const holdForThisStep = step.state === 'fail'
          ? (step.holdMs ?? 1000)
          : TIMING.logLineIntervalMs
        await sleep(holdForThisStep, sig)
        if (step.state === 'fail') {
          dispatch({ type: 'flipLastLogToPass' })
          await sleep(TIMING.logLineIntervalMs, sig)
        }
        dispatch({
          type: 'setScenarioProgress',
          value: 0.17 + ((i + 1) / scenario.logSteps.length) * 0.43,
        })
      }

      // ── 4. Preview transition. ──
      dispatch({ type: 'setPhase', value: 'transitioning' })
      const transitionStart = performance.now()
      const transitionEnd = transitionStart + TIMING.transitionMs
      while (!sig.aborted) {
        const t = Math.min(1, (performance.now() - transitionStart) / TIMING.transitionMs)
        dispatch({ type: 'setTransition', progress: t })
        dispatch({
          type: 'setScenarioProgress',
          value: 0.60 + t * 0.30,
        })
        if (performance.now() >= transitionEnd) break
        await sleep(16, sig)
      }
      dispatch({ type: 'setTransition', progress: 1 })

      // ── 5. Live + toast. ──
      await sleep(TIMING.liveAtMs, sig)
      dispatch({ type: 'setPhase', value: 'live' })
      dispatch({ type: 'setStatus', value: 'live' })
      const deployElapsed = Math.max(
        1,
        Math.round(
          (scenario.prompt.length * TIMING.typeCharMs
            + TIMING.sendPressMs
            + scenario.logSteps.reduce(
              (a, s) =>
                a + (s.state === 'fail' ? (s.holdMs ?? 1000) + TIMING.logLineIntervalMs : TIMING.logLineIntervalMs),
              0,
            )
            + TIMING.transitionMs
            + TIMING.liveAtMs) / 1000,
        ),
      )
      dispatch({ type: 'setToast', value: true, seconds: deployElapsed })

      // ── 6. Hold. ──
      dispatch({ type: 'setPhase', value: 'holding' })
      const holdStart = performance.now()
      const holdEnd = holdStart + TIMING.holdMs
      while (!sig.aborted && performance.now() < holdEnd) {
        const held = performance.now() - holdStart
        dispatch({
          type: 'setScenarioProgress',
          value: 0.90 + Math.min(1, held / TIMING.holdMs) * 0.10,
        })
        await sleep(50, sig)
      }

      // ── 7. Crossfade to next. ──
      dispatch({ type: 'setPhase', value: 'switching' })
      dispatch({ type: 'setToast', value: false })
      await sleep(TIMING.crossfadeMs, sig)
    }

    run()

    return () => {
      controller.abort()
    }
    // Effect intentionally reruns on every restartKey bump — tab clicks
    // set both startIdx and restartKey so a click on the SAME tab still
    // restarts the current scenario (brief-mandated behaviour).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reducedMotion, startIdx, restartKey])

  return state
}
