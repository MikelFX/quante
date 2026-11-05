// /llms.txt (next.config.ts rewrite) — per host: the website leads with AssetraDigital, quantecode.com with Quante.
import { hostKind } from '@/lib/domains'
import { llmsTxt } from '@/lib/agents/discovery'
import { agentHeaders, agentRuntime, requestHost } from '@/lib/agents/runtime'

export function GET(req: Request) {
  return new Response(llmsTxt(hostKind(requestHost(req)), agentRuntime()), { headers: agentHeaders('text/plain; charset=utf-8') })
}
