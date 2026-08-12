// Level 3 — shared types + pure decision logic between /api/quante/generate's background
// job, /api/quante/generate/status's poll response, and the polling clients
// (app/(app)/new/page.tsx and, if adopted there too, StudioClient.tsx). See
// docs/update-log.md for the full architecture writeup.

export type GenerationJobStatus = 'running' | 'completed' | 'failed'

export type GenerationPhase =
  | 'designing'
  | 'retrying_fallback'
  | 'parsing'
  | 'saving'
  | 'validating_build'
  | null

// Shape returned by GET /api/quante/generate/status?jobId=...
export interface JobStatusPayload {
  status: GenerationJobStatus
  phase: GenerationPhase
  files: Record<string, string>
  rawOutputTail: string
  summary: string | null
  error: string | null
  projectId: string | null
  deploymentId: string | null
  previewUrl: string | null
  codeVersionId: string | null
}

export type PollDecision =
  | { action: 'continue' }
  | { action: 'navigate'; projectId: string; deploymentId: string | null; codeVersionId: string | null }
  | { action: 'error'; message: string }

/**
 * Given the latest poll response, decides what the client should do next. Pure — no fetch,
 * no timers, no state; every branch is a straight read of `payload`, so this is fully
 * testable without mocking a network call or a React component.
 */
export function decidePollAction(payload: JobStatusPayload): PollDecision {
  if (payload.status === 'completed') {
    if (!payload.projectId) {
      return { action: 'error', message: 'Generation completed but no project was recorded. Please check your dashboard.' }
    }
    return {
      action: 'navigate',
      projectId: payload.projectId,
      deploymentId: payload.deploymentId,
      codeVersionId: payload.codeVersionId,
    }
  }
  if (payload.status === 'failed') {
    return { action: 'error', message: payload.error || 'Generation failed. Please try again.' }
  }
  return { action: 'continue' }
}

/** Maps the server's fine-grained `phase` to the display text the old NDJSON `status`
 * events used to carry directly — kept identical so the UI reads the same as before. */
export function phaseToStatusText(phase: GenerationPhase): string {
  switch (phase) {
    case 'designing': return 'Designing your store…'
    case 'retrying_fallback': return 'Retrying with fallback model…'
    case 'parsing': return 'Parsing generated files…'
    case 'saving': return 'Saving…'
    case 'validating_build': return 'Validating build…'
    default: return 'Working on your store…'
  }
}

// Comfortably past maxDuration (300s) plus a buffer for the job row write + client poll
// latency — a job still 'running' past this age almost certainly means the background
// function was killed (platform-level failure, not something this code can catch) rather
// than that it's still legitimately working. The client treats this as a terminal error
// rather than polling forever.
export const JOB_STUCK_THRESHOLD_MS = 400_000

export function isJobStuck(createdAtMs: number, nowMs: number, thresholdMs: number = JOB_STUCK_THRESHOLD_MS): boolean {
  return nowMs - createdAtMs > thresholdMs
}
