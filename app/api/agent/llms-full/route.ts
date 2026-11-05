// /llms-full.txt (next.config.ts rewrite) — every page's Markdown + the catalog in one file.
import { llmsFullTxt } from '@/lib/agents/discovery'
import { agentHeaders, agentRuntime, qboxLlms } from '@/lib/agents/runtime'

export function GET() {
  return new Response(llmsFullTxt(agentRuntime(), qboxLlms()), { headers: agentHeaders('text/plain; charset=utf-8') })
}
