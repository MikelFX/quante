// POST /api/agent/v1/inquiry — an AI agent asks AssetraDigital for a quote for its person
// (lib/agents/inquiry.ts). JSON: { name?, contact, need?, message?, consent: true, agent? }.
import { NextResponse } from 'next/server'
import { submitInquiry } from '@/lib/agents/inquiry'
import { getClientIp } from '@/lib/rate-limit'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400, headers: CORS })
  const r = await submitInquiry(body, getClientIp(req), req.headers.get('user-agent') ?? '')
  return r.ok
    ? NextResponse.json({ ok: true, id: r.id, next: 'AssetraDigital will contact the person. Nothing else is needed.' }, { headers: CORS })
    : NextResponse.json({ error: r.error }, { status: r.status, headers: CORS })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
