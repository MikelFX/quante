// Stand-in for lib/generation/run.ts in unit tests: records each run and marks the job completed
// in the fake database, the way the real pipeline ends.
import { supabaseAdmin } from './supabase-admin.mjs'

export const IN_FLIGHT_WINDOW_MS = 10 * 60_000
export const MAX_BRIEF_CHARS = 20_000
export const __runs = []

export async function runGeneration(params) {
  __runs.push(params)
  await supabaseAdmin.from('generation_jobs').update({ status: 'completed', phase: null, project_id: 'p-' + params.jobId }).eq('id', params.jobId)
}
