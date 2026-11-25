// POST /api/supplier-orders/<id> { t, trackingCode, trackingUrl?, carrier? } | { t, action: 'cannot', reason }
// The supplier confirms a shipment from the link in its order e-mail (CLAUDE.md §13r). No account:
// the link's token is the key (only its sha256 is stored). Per-IP rate limited.
import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseTrackingInput } from '@/lib/suppliers/model'
import { confirmBySupplier } from '@/lib/suppliers/dispatch'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`supplier-order:${getClientIp(request)}`, 20, 60 * 60_000).allowed) {
    return NextResponse.json({ error: 'Příliš mnoho pokusů, zkuste to za chvíli.' }, { status: 429 })
  }
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const input = parseTrackingInput(body)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
  const r = await confirmBySupplier(id, body.t, input.action === 'cannot'
    ? { action: 'cannot', reason: input.reason }
    : { action: 'shipped', trackingCode: input.trackingCode, trackingUrl: input.trackingUrl, carrier: input.carrier })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, status: r.status })
}
