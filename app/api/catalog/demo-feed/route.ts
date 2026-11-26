// GET /api/catalog/demo-feed — the demo supplier's product feed (Heureka XML, lib/suppliers/demo.ts),
// read by the normal supplier import. Public: made-up products only, nothing private in it.
import { demoFeedXml } from '@/lib/suppliers/demo'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return new Response(demoFeedXml(new URL(request.url).origin), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' },
  })
}
