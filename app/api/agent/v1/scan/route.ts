// POST /api/agent/v1/scan — Qscan reads a store into structured JSON for an AI agent: brand,
// products with prices, colours, fonts, navigation, texts, images (their original URLs; nothing is
// copied). Body { url, rights: true }. Pay per call over x402 with no account (lib/agents/pay-per-call.ts:
// settled only after the scan succeeded), or Bearer qbx_… from a Qbox balance as /api/agent/v1/review.
// Sites that block bots get an honest error — never worked around.
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeScanUrl } from '@/lib/qscan/net'
import { ScanError, scanStore } from '@/lib/qscan/scan'
import { PLATFORM_LABEL } from '@/lib/qscan/extract'
import { CORS, charge, paidCaller, refund, reply } from '@/lib/agents/paid'
import { agentToolUsd } from '@/lib/agents/paid-price'
import { hasApiKey, payPerCall } from '@/lib/agents/pay-per-call'

export const maxDuration = 120

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { url?: unknown; rights?: unknown } | null
  const url = typeof body?.url === 'string' ? normalizeScanUrl(body.url) : null
  if (!url) return NextResponse.json({ error: 'Send { "url": "<public store address>", "rights": true }.' }, { status: 400, headers: CORS })
  if (body?.rights !== true) return NextResponse.json({ error: 'rights must be true: the store is your person\'s, or they may use its content.' }, { status: 400, headers: CORS })

  if (!hasApiKey(req)) {
    return payPerCall(req, {
      tool: 'scan',
      description: 'Store read into structured JSON: brand, products with prices, colours, fonts, navigation, texts, images',
      call: { method: 'POST', body: {
        url: { type: 'string', description: 'Public store address', example: 'https://www.allbirds.com' },
        rights: { type: 'boolean', description: 'true: the store is your person\'s, or they may use its content', example: true },
      } },
      outputExample: { platform: 'shopify', brand: { name: 'Allbirds' }, currency: 'USD', products: [{ name: "Men's Tree Runner", price: 100, currency: 'USD' }] },
      tags: ['ecommerce', 'scraping', 'store-data', 'brand'],
      perIpHour: 20,
    }, async () => {
      try {
        const r = await scanStore(url.toString())
        return { ok: true, body: { ...r, platformLabel: PLATFORM_LABEL[r.platform] } }
      } catch (err) {
        return { ok: false, status: 422, body: { error: err instanceof ScanError ? err.message : 'Could not read the site.' } }
      }
    })
  }

  const c = await paidCaller(req)
  if (c instanceof NextResponse) return c
  if (!rateLimit(`agent-scan:${c.member.userId}`, 10, 3_600_000).allowed) return reply(c, { error: 'At most 10 scans an hour.' }, 429)

  const booked = await charge(c, 'scan', `scan ${url.host}`)
  if (!booked.ok) return booked.response
  try {
    const r = await scanStore(url.toString())
    return reply(c, { ...r, platformLabel: PLATFORM_LABEL[r.platform], charged: { usd: agentToolUsd('scan') } })
  } catch (err) {
    await refund(c, 'scan', booked.ref)
    return reply(c, { error: err instanceof ScanError ? err.message : 'Could not read the site.', charged: false }, 422)
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
