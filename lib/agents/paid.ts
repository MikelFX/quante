// Paid agent tools (/api/agent/v1/review, /api/agent/v1/scan). Server-only. The caller is a Qbox
// account (Bearer qbx_… key; an agent opens one by itself over x402 at /api/qbox/v1/accounts), on
// the paid tier. The charge is a negative qbox_topups row (source 'charge') booked only after the
// target page was read; when the work then fails it is returned (source 'refund').
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { authorize, type Caller } from '@/lib/qbox/actions'
import { ensureBalance } from '@/lib/qbox/billing'
import { agentToolUnits, type AgentTool } from './paid-price'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE', 'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED' }

/** The caller, on the paid tier only (a free beta seat does not cover paid tools). */
export async function paidCaller(req: Request): Promise<Caller | NextResponse> {
  recordAgentVisit(req, 'paid')
  const c = await authorize(req)
  if (c instanceof NextResponse) return c
  if (c.member.tier !== 'paid') {
    return NextResponse.json({ error: 'Paid agent tools need Qbox paid access, which is not open yet.' }, { status: 403, headers: CORS })
  }
  return c
}

export type Booked = { ok: true; ref: string } | { ok: false; response: NextResponse }

/** Checks the balance and books the charge (402 with the payment offer when short). */
export async function charge(c: Caller, tool: AgentTool, what: string): Promise<Booked> {
  const units = agentToolUnits(tool)
  const b = await ensureBalance(c.member, c.resource, units)
  if (!b.ok) return { ok: false, response: NextResponse.json(b.body ?? { error: b.error }, { status: b.status, headers: CORS }) }
  const ref = `agent:${tool}:${randomUUID()}`
  const { error } = await supabaseAdmin.from('qbox_topups').insert({ user_id: c.member.userId, vcpu_minutes: -units, source: 'charge', ref, note: what.slice(0, 300) })
  if (error) return { ok: false, response: NextResponse.json({ error: 'Could not book the charge. Try again.' }, { status: 503, headers: CORS }) }
  return { ok: true, ref }
}

/** Returns a charge after the work failed (once: the refund ref is unique). */
export async function refund(c: Caller, tool: AgentTool, ref: string) {
  await supabaseAdmin.from('qbox_topups').insert({ user_id: c.member.userId, vcpu_minutes: agentToolUnits(tool), source: 'refund', ref: `${ref}:refund`, note: 'agent tool failed' })
}

export function reply(c: Caller, body: unknown, status = 200) {
  const headers: Record<string, string> = { ...CORS }
  if (c.paymentResponse) { headers['X-PAYMENT-RESPONSE'] = c.paymentResponse; headers['PAYMENT-RESPONSE'] = c.paymentResponse }
  return NextResponse.json(body, { status, headers })
}
