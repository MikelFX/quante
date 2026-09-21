// HomeStudioDemo — scenario data.
//
// Everything the loop plays is declared here. Change copy, log
// wording, prompt or transition here without touching the animation
// scheduler or the render tree; the homepage-studio-demo brief calls
// this out on purpose so future copy edits do not require reading
// (or breaking) the state-machine hook.
//
// Naming rule for `logSteps`:
//   - `state: 'running'` — spinner icon, current step.
//   - `state: 'pass'`    — green check, finished step.
//   - `state: 'fail'`    — amber alert, held for `holdMs` then flipped
//                          to 'pass' by the scheduler.
//
// Transition ids map to a switch statement in the Preview component;
// the scheduler doesn't inspect them beyond passing the value through.

export type LogState = 'running' | 'pass' | 'fail'

export interface LogStep {
  text: string
  state: LogState
  /** Only meaningful when state is 'fail'. Milliseconds to hold before flip. */
  holdMs?: number
}

export type TransitionId = 'wipe-dark' | 'size-picker' | 'text-swap-de'

export interface Scenario {
  id: 'design' | 'feature' | 'content'
  label: string
  prompt: string
  logSteps: LogStep[]
  transition: TransitionId
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'design',
    label: 'Design',
    prompt: 'Make the hero darker and add a looping video',
    logSteps: [
      { text: 'Reading hero.tsx',              state: 'running' },
      { text: 'Editing 2 files',               state: 'running' },
      { text: 'Build failed · fixing import',  state: 'fail', holdMs: 1000 },
      { text: 'Build passed',                  state: 'pass' },
      { text: 'Deploying',                     state: 'running' },
      { text: 'Deployed',                      state: 'pass' },
    ],
    transition: 'wipe-dark',
  },
  {
    id: 'feature',
    label: 'Feature',
    prompt: 'Add a size picker to the product page',
    logSteps: [
      { text: 'Reading product/[slug].tsx',    state: 'running' },
      { text: 'Adding SizePicker component',   state: 'running' },
      { text: 'Build passed',                  state: 'pass' },
      { text: 'Deployed',                      state: 'pass' },
    ],
    transition: 'size-picker',
  },
  {
    id: 'content',
    label: 'Content',
    prompt: 'Translate the store to German',
    logSteps: [
      { text: 'Scanning 14 strings',           state: 'running' },
      { text: 'Translating',                   state: 'running' },
      { text: 'Build passed',                  state: 'pass' },
      { text: 'Deployed',                      state: 'pass' },
    ],
    transition: 'text-swap-de',
  },
]

// ── Timing constants (ms) — exposed here so a designer can tune the
// pace without opening the scheduler. Every number matches the
// homepage-studio-demo brief's "Timing per scenario" table.
export const TIMING = {
  /** Per-character type interval on the prompt bar. */
  typeCharMs: 30,
  /** Send-button press animation (scale 0.9 → 1). */
  sendPressMs: 150,
  /** Log-line reveal animation duration. */
  logLineRevealMs: 300,
  /** Interval between log-line reveals. */
  logLineIntervalMs: 400,
  /** Scenario transition (wipe / picker / text-swap). */
  transitionMs: 800,
  /** After transition: wait, then show Live status + toast. */
  liveAtMs: 200,
  /** Hold time on the final state. */
  holdMs: 3000,
  /** Crossfade to next scenario. */
  crossfadeMs: 300,
} as const

// German copy for the Content scenario's text-swap — kept next to
// the scenario so the translation is one edit away.
export const TEXT_SWAP_DE = {
  headline: 'Kaffee, bei Kerzenlicht geröstet.',
  cta: 'Kollektion ansehen',
} as const
