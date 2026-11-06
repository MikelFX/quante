// Qbox services gateway: ANY /api/qbox/v1/x/<slug>/<path> → the seller's service, paid over x402
// straight to the seller's wallet. No API key: the payment is the ticket. lib/qbox/services/gateway.ts.

import { gateway, gatewayOptions } from '@/lib/qbox/services/gateway'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string; path?: string[] }> }

async function handle(request: Request, ctx: Ctx) {
  const { slug, path } = await ctx.params
  return gateway(request, slug, path)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = gatewayOptions
