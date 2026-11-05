// The runtime switches of the agent layer, read from env (server only).
import { isOpenAccess } from '@/lib/qbox/model'
import { x402Config } from '@/lib/qbox/x402'
import { llmsTxt as qboxLlmsTxt } from '@/lib/qbox/openapi'
import type { AgentRuntime } from './catalog'

export function agentRuntime(env: Record<string, string | undefined> = process.env): AgentRuntime {
  const x = x402Config(env)
  return { qboxOpen: isOpenAccess(env), x402: x ? { network: x.network } : null }
}

export const qboxLlms = () => qboxLlmsTxt()

/** Headers for every public agent response: CORS open, cacheable, never indexed twice. */
export function agentHeaders(type: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  }
}

/** Host kind of a request (x-forwarded-host first, as on Vercel). */
export function requestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host') ?? req.headers.get('host')
}
