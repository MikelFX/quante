// Which agent page (lib/agents/pages.ts) a request path means. Kept tiny and free of content
// imports because proxy.ts runs it on every request.
import type { hostKind } from '@/lib/domains'

type Kind = ReturnType<typeof hostKind>

/** Quante module slugs with a page (content/assetra/modules.ts; a test keeps them equal). */
export const AGENT_MODULE_SLUGS = ['generate', 'qscan', 'qgent', 'qdit', 'qads', 'qails'] as const
const MODULE_SLUGS: readonly string[] = AGENT_MODULE_SLUGS
/** App tools that are also Quante modules: their page is the module's. */
const TOOL_PAGES: Record<string, string> = { qads: 'qads', qscan: 'qscan', qgent: 'qgent' }

/**
 * Which page a request path means, given the host. null = no Markdown version (the HTML page, a
 * redirect or a 404 answers as usual). "/x.md" and "/index.md" are accepted too.
 */
export function agentPageId(pathname: string, kind: Kind): string | null {
  let p = pathname.replace(/\/+$/, '') || '/'
  if (p.endsWith('.md')) p = p.slice(0, -3) || '/'
  if (p === '/index') p = '/'
  const site = kind !== 'app'
  const app = kind !== 'site'
  if (p === '/') return kind === 'app' ? 'quante' : 'ai'
  if (site && p === '/web-eshop') return 'web-eshop'
  if (app && p === '/quante') return 'quante'
  const mod = /^\/quante\/([a-z]+)$/.exec(p)
  if (app && mod && MODULE_SLUGS.includes(mod[1])) return `module:${mod[1]}`
  const tool = /^\/([a-z]+)$/.exec(p)
  if (app && tool && TOOL_PAGES[tool[1]]) return `module:${TOOL_PAGES[tool[1]]}`
  if (app && p === '/qbox') return 'qbox'
  if (app && p === '/agent-shops') return 'agent-shops'
  if (p === '/agents') return 'agents'
  return null
}

