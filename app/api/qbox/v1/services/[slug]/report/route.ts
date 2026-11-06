// Report a Qbox service (fraud, phishing, illegal content…): POST {reason, contact?}. Anyone, no key;
// a few reports per IP per hour. The operator reviews them in Admin → Qbox and can block the service.

import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseSlug } from '@/lib/qbox/services/model'
import { addReport, serviceBySlug } from '@/lib/qbox/services/store'

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const ipHash = createHash('sha256').update(getClientIp(request)).digest('hex').slice(0, 32)
  if (!rateLimit(`qbox:report:${ipHash}`, 5, 3_600_000).allowed) return NextResponse.json({ error: 'Too many reports. Try later.' }, { status: 429 })
  const body = (await request.json().catch(() => null)) as { reason?: unknown; contact?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5 || reason.length > 1000) return NextResponse.json({ error: 'reason: 5–1000 characters.' }, { status: 400 })
  const contact = typeof body?.contact === 'string' ? body.contact.trim().slice(0, 200) || null : null
  try {
    const s = await serviceBySlug(parseSlug((await ctx.params).slug))
    if (!s) return NextResponse.json({ error: 'No such service.' }, { status: 404 })
    await addReport(s.id, reason, contact, ipHash)
  } catch {
    return NextResponse.json({ error: 'Could not save the report.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, note: 'Thank you. The operator reviews every report.' })
}
