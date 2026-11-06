// Qbox operations shared by the REST API (app/api/qbox/v1/sandboxes/**) and the MCP server
// (app/api/qbox/v1/mcp). Server-only. Each returns a plain result (`ok` + data, or an HTTP-style
// error), so both front doors answer the same way and enforce the same limits.

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import {
  QBOX_BETA, QboxInputError, admitCreate, clipOutput, globalCaps, isLive, networkFor, parseCreate, parseExec,
  publicSandbox, reserveVcpuMinutes, sandboxPath,
} from './model'
import { authenticate, globalLoad, markEnded, memberSandboxes, ownSandbox, type BetaMember, type FullRow } from './store'
import { engine } from './vercel'
import { EngineUnavailableError, SandboxGoneError } from './provider'
import { chargeOperation, ensureBalance, payIfOffered } from './billing'

export type Result<T> = { ok: true; data: T; status?: number } | { ok: false; status: number; error: string; body?: Record<string, unknown> }
/** Who calls, and the URL they called (named as the resource in a 402 payment offer). */
export interface Caller { member: BetaMember; keyId: string; resource: string; paymentResponse?: string }

/**
 * The API key → the caller. On the paid tier an X-PAYMENT header (the x402 retry after our 402) is
 * settled and booked first, so the request that follows is already paid for.
 */
export async function authorize(request: Request): Promise<Caller | NextResponse> {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const caller: Caller = { ...a, resource: request.url }
  const paid = await payIfOffered(request, a.member)
  if (paid instanceof NextResponse) return paid
  if (paid) caller.paymentResponse = paid.header
  return caller
}

/** A Result as the REST API's JSON response (with X-PAYMENT-RESPONSE after an x402 payment). */
export function toResponse<T>(r: Result<T>, caller?: Caller) {
  const headers = caller?.paymentResponse ? { 'X-PAYMENT-RESPONSE': caller.paymentResponse, 'PAYMENT-RESPONSE': caller.paymentResponse } : undefined
  return r.ok
    ? NextResponse.json(r.data, { status: r.status ?? 200, headers })
    : NextResponse.json(r.body ?? { error: r.error }, { status: r.status, headers })
}

const fail = (status: number, error: string) => ({ ok: false as const, status, error })
const NOT_SET_UP = fail(503, 'Qbox is not set up yet.')
const STOPPED = fail(409, 'The sandbox has stopped. Start a new one.')

async function previewsOf(id: string, ports: number[]) {
  const previews: Record<string, string> = {}
  for (const p of ports) {
    const url = await engine().previewUrl(id, p).catch(() => null)
    if (url) previews[String(p)] = url
  }
  return previews
}

export async function createSandbox({ member, keyId, resource }: Caller, body: unknown) {
  if (!rateLimit(`qbox:create:${member.userId}`, 5, 60_000).allowed) return fail(429, 'At most 5 new sandboxes a minute.')
  let input
  try {
    input = parseCreate(body, member)
  } catch (e) {
    return fail(400, e instanceof QboxInputError ? e.message : 'Invalid request body.')
  }
  const now = Date.now()
  let rows, load
  try {
    ;[rows, load] = await Promise.all([memberSandboxes(member.userId, now), globalLoad(now)])
  } catch {
    return NOT_SET_UP
  }
  const admit = admitCreate(rows, { ...member, vcpus: input.vcpus }, input.timeoutMs, now, load, globalCaps(process.env))
  if (!admit.ok) return fail(admit.status, admit.error)
  // Paid tier: the whole lifetime must be covered by the prepaid balance before anything starts.
  const covered = await ensureBalance(member, resource, reserveVcpuMinutes(input.timeoutMs, input.vcpus))
  if (!covered.ok) return covered

  const id = randomUUID()
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + input.timeoutMs).toISOString()
  const network = networkFor(input.internet, member.network)
  // The row comes first: it reserves the slot and the minutes before the engine spends anything.
  // `vcpus` / `billed` exist after supabase/migration-qbox-open.sql; the paid tier needs them, so
  // it fails closed without them. Free beta rows still work before it.
  const row = {
    id, user_id: member.userId, key_id: keyId, created_at: createdAt, expires_at: expiresAt,
    status: 'running', engine: engine().name, template: input.template, ports: input.ports, metadata: input.metadata,
  }
  const billed = member.tier === 'paid'
  let { error: insErr } = await supabaseAdmin.from('qbox_sandboxes').insert({ ...row, vcpus: input.vcpus, billed })
  if (insErr && !billed && input.vcpus === QBOX_BETA.vcpus && /vcpus|billed/.test(insErr.message ?? '')) {
    ;({ error: insErr } = await supabaseAdmin.from('qbox_sandboxes').insert(row))
  }
  if (insErr) return NOT_SET_UP

  try {
    await engine().create({
      id, template: input.template, timeoutMs: input.timeoutMs, ports: input.ports,
      network, env: input.env, vcpus: input.vcpus, tags: { sandbox: id, tier: member.tier },
    })
  } catch (e) {
    console.error('[qbox] create failed', e)
    await markEnded(id, 'failed', String((e as Error)?.message ?? e))
    if (e instanceof EngineUnavailableError) return fail(503, 'Sandboxes are not available right now.')
    return fail(502, 'The sandbox could not be started. Nothing was counted; try again.')
  }
  const out = { id, status: 'running' as const, created_at: createdAt, expires_at: expiresAt, ended_at: null, template: input.template, ports: input.ports, vcpus: input.vcpus }
  const cost = billed ? { reservedVcpuMinutes: reserveVcpuMinutes(input.timeoutMs, input.vcpus), note: 'Unused time returns to your balance when you stop the sandbox early.' } : undefined
  return { ok: true as const, status: 201, data: { ...publicSandbox(out, Date.now(), await previewsOf(id, input.ports)), network, ...(cost ? { billing: cost } : {}) } }
}

export async function listSandboxes({ member }: Caller) {
  const now = Date.now()
  try {
    const rows = await memberSandboxes(member.userId, now)
    return { ok: true as const, data: { sandboxes: rows.slice(0, 100).map((r) => publicSandbox(r, now)) } }
  } catch {
    return NOT_SET_UP
  }
}

async function own(member: BetaMember, id: string, live: boolean): Promise<Result<FullRow>> {
  const row = await ownSandbox(member.userId, id).catch(() => null)
  if (!row) return fail(404, 'No such sandbox.')
  if (live && !isLive(row, Date.now())) return STOPPED
  return { ok: true, data: row }
}

async function gone(id: string, e: unknown, what: string) {
  if (e instanceof SandboxGoneError) {
    await markEnded(id, 'stopped')
    return STOPPED
  }
  console.error(`[qbox] ${what} failed`, e)
  return fail(502, `The ${what} failed. Try again.`)
}

export async function getSandbox({ member }: Caller, id: string) {
  const o = await own(member, id, false)
  if (!o.ok) return o
  const now = Date.now()
  const previews = isLive(o.data, now) ? await previewsOf(id, o.data.ports ?? []) : {}
  return { ok: true as const, data: publicSandbox(o.data, now, previews) }
}

export async function stopSandbox({ member }: Caller, id: string) {
  const o = await own(member, id, false)
  if (!o.ok) return o
  try {
    await engine().kill(id)
  } catch (e) {
    console.error('[qbox] kill failed', e)
    return fail(502, 'Could not stop the sandbox. Try again; it also stops by itself at expiresAt.')
  }
  await markEnded(id, 'stopped')
  return { ok: true as const, data: { id, status: 'stopped' } }
}

export async function execIn({ member, resource }: Caller, id: string, body: unknown) {
  const o = await own(member, id, true)
  if (!o.ok) return o
  let input
  try {
    input = parseExec(body)
  } catch (e) {
    return fail(400, e instanceof QboxInputError ? e.message : 'Invalid request body.')
  }
  const paid = await chargeOperation(member, resource, `exec ${id}`)
  if (!paid.ok) return paid
  // Never wait past the sandbox's own end.
  input.timeoutMs = Math.max(1000, Math.min(input.timeoutMs, Date.parse(o.data.expires_at) - Date.now()))
  const started = Date.now()
  try {
    const r = await engine().exec(id, input)
    const out = clipOutput(r.stdout)
    const err = clipOutput(r.stderr)
    return {
      ok: true as const,
      data: { exitCode: r.exitCode, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, timedOut: r.timedOut, durationMs: Date.now() - started },
    }
  } catch (e) {
    return gone(id, e, 'command')
  }
}

const TOO_BIG = fail(413, `Files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB.`)

export async function writeFileIn({ member, resource }: Caller, id: string, rawPath: unknown, content: Uint8Array) {
  if (content.byteLength > QBOX_BETA.maxFileBytes) return TOO_BIG
  let path: string
  try {
    path = sandboxPath(rawPath)
  } catch (e) {
    return fail(400, e instanceof QboxInputError ? e.message : 'Invalid path.')
  }
  const o = await own(member, id, true)
  if (!o.ok) return o
  const paid = await chargeOperation(member, resource, `write ${id}`)
  if (!paid.ok) return paid
  try {
    await engine().writeFile(id, path, content)
    return { ok: true as const, data: { path, bytes: content.byteLength } }
  } catch (e) {
    return gone(id, e, 'file write')
  }
}

export async function readFileIn({ member, resource }: Caller, id: string, rawPath: unknown) {
  let path: string
  try {
    path = sandboxPath(rawPath)
  } catch (e) {
    return fail(400, e instanceof QboxInputError ? e.message : 'Invalid path.')
  }
  const o = await own(member, id, true)
  if (!o.ok) return o
  const paid = await chargeOperation(member, resource, `read ${id}`)
  if (!paid.ok) return paid
  try {
    const buf = await engine().readFile(id, path)
    if (!buf) return fail(404, 'No such file.')
    if (buf.byteLength > QBOX_BETA.maxFileBytes) return TOO_BIG
    return { ok: true as const, data: { path, content: buf } }
  } catch (e) {
    return gone(id, e, 'file read')
  }
}
