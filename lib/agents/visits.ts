// Who visits the agent layer (pure, no I/O): the rules behind the public counters "agents welcomed"
// (lib/agents/stats.ts). A visit is one agent on one day; the agent is a hash of address + User-Agent
// + salt (never stored in the clear) and the first product token of its User-Agent (so the counters
// can say "GPTBot, ClaudeBot, python-requests…"). lib/agents/visits-record.ts writes the rows.
// Tested in __tests__/agent-stats.test.mjs.
import { createHash } from 'node:crypto'

/** Where the agent came in. */
export const VISIT_KINDS = ['markdown', 'api', 'mcp', 'paid', 'llms', 'discovery'] as const
export type VisitKind = (typeof VISIT_KINDS)[number]

/** Kinds a human in a browser can also reach by typing the address — counted only for agent-looking User-Agents. */
const BROWSABLE: readonly VisitKind[] = ['llms', 'discovery', 'markdown']

const AGENT_WORDS = /bot|crawl|spider|agent|fetch|python|node|curl|wget|go-http|java|okhttp|axios|undici|http[_-]?client|requests|aiohttp|httpx|libwww|scrapy|anthropic|openai|claude|gpt|gemini|perplexity|mistral|cohere|llm|mcp/i

/** True unless the User-Agent is a plain browser (starts with Mozilla/ and names no tool). An empty UA counts as an agent. */
export function isLikelyAgent(ua: string | null | undefined): boolean {
  const s = (ua ?? '').trim()
  if (!s) return true
  if (!/^mozilla\//i.test(s)) return true
  return AGENT_WORDS.test(s)
}

/** Should this request be counted as an agent visit of this kind? */
export function countsAsVisit(kind: VisitKind, ua: string | null | undefined): boolean {
  return BROWSABLE.includes(kind) ? isLikelyAgent(ua) : true
}

/** The first product token of a User-Agent ("GPTBot/1.1", "python-requests/2.32"); browsers are "browser"; unknown = null. */
export function agentName(ua: string | null | undefined): string | null {
  const s = (ua ?? '').trim()
  if (!s) return null
  // Browsers: name the known AI agent inside the UA when there is one (e.g. "… Chrome/… GPTBot/1.0").
  if (/^mozilla\//i.test(s)) {
    const m = s.match(/\b([A-Za-z][\w.-]*(?:bot|crawler|spider|agent|user|fetcher)[\w.-]*)(?:\/([\w.]+))?/i)
    return m ? m[1] + (m[2] ? `/${m[2]}` : '') : 'browser'
  }
  const first = s.split(/[\s(]/)[0] ?? ''
  const token = first.replace(/[^\w./+-]/g, '')
  return token ? token.slice(0, 80) : null
}

/** sha256(ip | ua | salt) cut to 32 hex chars. The salt keeps the hash from being a lookup table of addresses. */
export function agentHash(ip: string, ua: string | null | undefined, salt: string): string {
  return createHash('sha256').update(`${ip}|${ua ?? ''}|${salt}`).digest('hex').slice(0, 32)
}

/** ISO date (UTC) of a moment — the `day` column. */
export function visitDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface VisitRow {
  day: string
  agent_hash: string
  kind: VisitKind
  agent: string | null
}

/** The row to write for one request, or null when it is not an agent visit. */
export function visitRow(kind: VisitKind, ip: string, ua: string | null | undefined, salt: string, now: Date = new Date()): VisitRow | null {
  if (!countsAsVisit(kind, ua)) return null
  return { day: visitDay(now), agent_hash: agentHash(ip, ua, salt), kind, agent: agentName(ua) }
}

/** The instance remembers which (day, hash) pairs it already wrote, so one agent costs one insert a day per instance. */
export class VisitMemory {
  private seen = new Set<string>()
  private day = ''
  private readonly max: number
  constructor(max = 5000) {
    this.max = max
  }
  /** True the first time a pair is seen today. */
  first(row: VisitRow): boolean {
    if (row.day !== this.day) {
      this.day = row.day
      this.seen.clear()
    }
    const key = row.agent_hash
    if (this.seen.has(key)) return false
    if (this.seen.size >= this.max) this.seen.clear()
    this.seen.add(key)
    return true
  }
}
