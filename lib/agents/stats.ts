// The public agent numbers (server only): how many agents we have welcomed (agent_visits, see
// lib/agents/visits.ts), how many paid (x402 payers with no account + agent accounts in Qbox) and how
// many paid calls there were. Every figure comes from a table; a table that is not there yet gives
// null, never an invented number. "Agents that sold" waits for the Qbox services marketplace
// (lib/qbox/services, its own thread) — until then `sellers` is null and `marketplace` says so.
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface AgentStats {
  /** Distinct agents (address + User-Agent, hashed) that ever reached the agent layer. */
  agentsWelcomed: number | null
  agentsToday: number | null
  agentsLast30Days: number | null
  /** Distinct agents by door: markdown, api, mcp, paid, llms, discovery. */
  byKind: Record<string, number> | null
  /** The most frequent agent names (first User-Agent token). */
  topAgents: { agent: string; agents: number }[] | null
  /** Distinct payers: x402 wallets with no account + agent accounts opened in Qbox. */
  agentsPaid: number | null
  /** Settled pay-per-call payments + charged calls from agent accounts. */
  paidCalls: number | null
  /** USD paid per call (x402 without an account), settled. */
  paidUsd: number | null
  /** Agents that sold something to other agents — the Qbox services marketplace; null until it exists. */
  sellers: number | null
  marketplace: 'planned' | 'live'
  since: string | null
  generatedAt: string
}

const STATS_CACHE_MS = 60_000
let cache: { at: number; value: AgentStats } | null = null

async function visitStats(): Promise<Partial<AgentStats>> {
  const { data, error } = await supabaseAdmin.rpc('agent_public_stats')
  if (error || !data || typeof data !== 'object') return {}
  const d = data as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
  return {
    agentsWelcomed: n(d.agentsWelcomed),
    agentsToday: n(d.agentsToday),
    agentsLast30Days: n(d.agentsLast30Days),
    byKind: d.byKind && typeof d.byKind === 'object' ? Object.fromEntries(Object.entries(d.byKind as Record<string, unknown>).map(([k, v]) => [k, n(v) ?? 0])) : null,
    topAgents: Array.isArray(d.topAgents) ? (d.topAgents as { agent: string; agents: number }[]).filter((t) => typeof t?.agent === 'string').map((t) => ({ agent: t.agent, agents: n(t.agents) ?? 0 })) : null,
    since: typeof d.since === 'string' ? d.since : null,
  }
}

async function paymentStats(): Promise<Partial<AgentStats>> {
  const out: Partial<AgentStats> = {}
  const calls = await supabaseAdmin.from('agent_x402_calls').select('payer, usd_micros').limit(10_000)
  const agents = await supabaseAdmin.from('qbox_agents').select('user_id, payer').limit(10_000)
  const charges = await supabaseAdmin.from('qbox_topups').select('id', { count: 'exact', head: true }).eq('source', 'charge').like('user_id', 'agent\\_%')
  const payers = new Set<string>()
  if (!calls.error && calls.data) {
    for (const r of calls.data) if (r.payer) payers.add(String(r.payer).toLowerCase())
    out.paidUsd = Math.round(calls.data.reduce((s, r) => s + (Number(r.usd_micros) || 0), 0) / 10_000) / 100
  }
  if (!agents.error && agents.data) {
    for (const r of agents.data) payers.add(r.payer ? String(r.payer).toLowerCase() : String(r.user_id))
  }
  if (!calls.error || !agents.error) out.agentsPaid = payers.size
  if (!calls.error || !charges.error) out.paidCalls = (calls.error ? 0 : calls.data?.length ?? 0) + (charges.error ? 0 : charges.count ?? 0)
  return out
}

/** All public numbers, cached a minute per instance. Never throws. */
export async function agentStats(): Promise<AgentStats> {
  if (cache && Date.now() - cache.at < STATS_CACHE_MS) return cache.value
  const base: AgentStats = {
    agentsWelcomed: null, agentsToday: null, agentsLast30Days: null, byKind: null, topAgents: null,
    agentsPaid: null, paidCalls: null, paidUsd: null, sellers: null, marketplace: 'planned', since: null,
    generatedAt: new Date().toISOString(),
  }
  try {
    const [v, p] = await Promise.all([visitStats().catch(() => ({})), paymentStats().catch(() => ({}))])
    const value = { ...base, ...v, ...p }
    cache = { at: Date.now(), value }
    return value
  } catch {
    return base
  }
}
