// Records one agent visit (server only, best-effort, never blocks the response): the rules are in
// lib/agents/visits.ts, the rows go to agent_visits (supabase/migration-agent-visits.sql). Runs in
// next/server after(), so the agent gets its answer first; without the table the insert fails quietly.
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rate-limit'
import { VisitMemory, visitRow, type VisitKind } from './visits'

const memory = new VisitMemory()

/** No salt set → a fixed one: the hash is still not the address, just linkable across deployments. */
const salt = () => process.env.AGENT_VISIT_SALT || 'quante-agent-visits'

/** Call at the top of every agent-layer handler. Never throws, never awaits. */
export function recordAgentVisit(req: Request, kind: VisitKind): void {
  try {
    const row = visitRow(kind, getClientIp(req), req.headers.get('user-agent'), salt())
    if (!row || !memory.first(row)) return
    after(async () => {
      try {
        await supabaseAdmin.from('agent_visits').upsert(row, { onConflict: 'day,agent_hash', ignoreDuplicates: true })
      } catch {
        // best-effort bookkeeping
      }
    })
  } catch {
    // after() outside a request scope (tests, scripts) or a bad header: never fail the request
  }
}
