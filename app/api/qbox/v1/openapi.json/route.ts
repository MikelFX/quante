// Qbox OpenAPI 3.1 document — public, cacheable, CORS-open (agents and tool registries read it).
import { NextResponse } from 'next/server'
import { openApiDocument } from '@/lib/qbox/openapi'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(openApiDocument(), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  })
}
