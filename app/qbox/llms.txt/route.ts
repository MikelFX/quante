// /qbox/llms.txt — Qbox described for language models (llmstxt.org): what it is, the price, how an
// agent starts and pays by itself, and the links. Built from lib/qbox/openapi.ts.
import { llmsTxt } from '@/lib/qbox/openapi'

export const dynamic = 'force-static'

export function GET() {
  return new Response(llmsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  })
}
