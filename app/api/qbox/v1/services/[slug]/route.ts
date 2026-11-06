// One Qbox service: GET (public), PATCH (seller: name, description, priceUsd, upstream, tags,
// inputSchema, example, status live|paused), DELETE (seller: removed; the slug stays taken).

import { NextResponse } from 'next/server'
import { authorize, toResponse as reply } from '@/lib/qbox/actions'
import { changeService, getService, removeService } from '@/lib/qbox/services/actions'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  const r = await getService((await ctx.params).slug)
  return r.ok
    ? NextResponse.json(r.data, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' } })
    : NextResponse.json({ error: r.error }, { status: r.status })
}

export async function PATCH(request: Request, ctx: Ctx) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await changeService(a, (await ctx.params).slug, await request.json().catch(() => null)), a)
}

export async function DELETE(request: Request, ctx: Ctx) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await removeService(a, (await ctx.params).slug), a)
}
