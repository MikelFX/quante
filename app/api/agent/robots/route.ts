// /robots.txt (next.config.ts rewrite): every AI agent and crawler welcome by name, Content-Signal
// yes to search, AI answers and training (owner 2026-11-05), private app areas still disallowed.
import { APP_ORIGIN, SITE_ORIGIN, hostKind } from '@/lib/domains'
import { robotsTxt } from '@/lib/agents/discovery'
import { requestHost } from '@/lib/agents/runtime'

export function GET(req: Request) {
  const host = requestHost(req)
  const kind = hostKind(host)
  const origin = kind === 'site' ? SITE_ORIGIN : kind === 'app' ? APP_ORIGIN : `${req.headers.get('x-forwarded-proto') ?? 'https'}://${host ?? 'localhost'}`
  return new Response(robotsTxt(origin, kind), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  })
}
