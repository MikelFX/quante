// Qbox — sandboxes for AI agents (closed beta 2026-11-04; open paid tier 2026-11-05, owner: "a place
// for every agent on the internet", "only paid", "agents can pay by themselves"). Pure rules, no
// I/O, tested in __tests__/qbox.test.mjs.
//
// Phase 0 of /mnt/project-files/sandbox/sandbox-pro-agenty.md: our own API, keys, limits and
// usage on top of an exchangeable engine (lib/qbox/provider.ts; today Vercel Sandbox).
// Two tiers: `beta` = invited accounts (`qbox_beta` rows, added by the operator; free, monthly cap),
// `paid` = every other account, only while QBOX_ACCESS=open, prepaid vCPU-minutes. The global
// concurrency and daily vCPU-minute budget protect the operator's Vercel bill on top of both.

import { createHash, randomBytes } from 'node:crypto'
import { QBOX_BETA, QBOX_GLOBAL, QBOX_PAID, QBOX_PAID_VCPUS, QBOX_PRICING, QBOX_TEMPLATES, type QboxTemplate } from './limits.ts'

export * from './limits.ts'

/** Credits that cover `vcpuMinutes` (at least 1). */
export function creditsFor(vcpuMinutes: number): number {
  return Math.max(1, Math.ceil(vcpuMinutes / QBOX_PRICING.vcpuMinutesPerCredit - 1e-9))
}

/** vCPU-minutes a sandbox reserves when it starts (its whole lifetime). */
export function reserveVcpuMinutes(timeoutMs: number, vcpus: number): number {
  return (timeoutMs / 60_000) * vcpus
}

/**
 * Prepaid balance of a paid account: every top-up (per-operation charges are negative top-up rows),
 * minus every billed sandbox (live ones reserved to their timeout, ended ones as used, at least
 * minBilledMinutes). A sandbox the engine failed to start is not billed. Free beta rows are not billed.
 */
export function paidBalance(topups: Array<{ vcpu_minutes: number }>, billedRows: SandboxRow[], now: number): number {
  const paid = topups.reduce((s, t) => s + Number(t.vcpu_minutes || 0), 0)
  const used = billedRows.reduce((s, r) => {
    if (r.status === 'failed' && !r.ended_at) return s
    const mins = Math.max(QBOX_PRICING.minBilledMinutes, usedMinutes(r, isLive(r, now) ? Infinity : now, 0))
    return s + (r.status === 'failed' ? 0 : mins) * (r.vcpus ?? QBOX_BETA.vcpus)
  }, 0)
  return Math.round((paid - used) * 100) / 100
}

export type QboxTier = 'paid' | 'beta'
/** `open` = the internet, `registries` = package registries only, `none` = no network at all. */
export type QboxNetwork = 'open' | 'registries' | 'none'

/**
 * QBOX_ACCESS=open lets every account in on the paid tier — and then EVERY account pays, invited
 * ones too (owner: no agent move is free); a `qbox_beta` row only raises concurrency. Anything
 * else keeps the invite-only free beta.
 */
export function isOpenAccess(env: Record<string, string | undefined>): boolean {
  return env.QBOX_ACCESS?.trim().toLowerCase() === 'open'
}

const posInt = (v: string | undefined, fallback: number, max: number) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

/** The global guards, with QBOX_GLOBAL_CONCURRENT / QBOX_DAILY_VCPU_MINUTES overrides. */
export function globalCaps(env: Record<string, string | undefined>) {
  return {
    concurrent: posInt(env.QBOX_GLOBAL_CONCURRENT, QBOX_GLOBAL.concurrent, 1000),
    dailyVcpuMinutes: posInt(env.QBOX_DAILY_VCPU_MINUTES, QBOX_GLOBAL.dailyVcpuMinutes, 1_000_000),
  }
}

/** Limits of one account in a tier (a `qbox_beta` row may override concurrency and minutes). */
export function tierLimits(tier: QboxTier, override: { maxConcurrent?: number | null; monthlyMinutes?: number | null } = {}): Limits {
  const base = tier === 'beta'
    ? { maxConcurrent: QBOX_BETA.maxConcurrent, monthlyMinutes: QBOX_BETA.monthlyMinutes, maxTimeoutMs: QBOX_BETA.maxTimeoutMs, vcpus: QBOX_BETA.vcpus, maxPorts: QBOX_BETA.maxPorts }
    : { ...QBOX_PAID, monthlyMinutes: Infinity }
  return {
    tier,
    ...base,
    maxConcurrent: override.maxConcurrent ?? base.maxConcurrent,
    monthlyMinutes: override.monthlyMinutes ?? base.monthlyMinutes,
    network: 'open',
  }
}

/** What the sandbox may reach: the caller's `internet` choice, narrowed by the tier. */
export function networkFor(internet: QboxNetwork, tierNetwork: 'open' | 'registries'): QboxNetwork {
  if (internet === 'none') return 'none'
  return tierNetwork === 'registries' ? 'registries' : internet
}

export const QBOX_KEY_PREFIX = 'qbx_'
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const KEY_BODY = 40

/** A new API key: shown to the member once; only its hash and a short prefix are stored. */
export function newApiKey(): { key: string; hash: string; prefix: string } {
  const bytes = randomBytes(KEY_BODY)
  let body = ''
  // 256 % 62 bias is irrelevant at 40 × ~5.95 bits ≈ 238 bits of entropy.
  for (const b of bytes) body += KEY_ALPHABET[b % KEY_ALPHABET.length]
  const key = QBOX_KEY_PREFIX + body
  return { key, hash: hashApiKey(key), prefix: key.slice(0, QBOX_KEY_PREFIX.length + 6) }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** The key from `Authorization: Bearer qbx_…` (or `x-api-key`), or null when it can't be one. */
export function apiKeyFrom(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get('authorization')
  const raw = auth?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? headers.get('x-api-key') ?? ''
  const key = raw.trim()
  if (!key.startsWith(QBOX_KEY_PREFIX)) return null
  if (key.length !== QBOX_KEY_PREFIX.length + KEY_BODY) return null
  if (!/^[A-Za-z0-9_]+$/.test(key)) return null
  return key
}

export class QboxInputError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface CreateInput {
  template: QboxTemplate
  timeoutMs: number
  ports: number[]
  /** true / "open" = internet, "registries" = package registries only, false / "none" = offline. */
  internet: QboxNetwork
  /** Paid tier only (QBOX_PAID_VCPUS); the beta is always QBOX_BETA.vcpus. */
  vcpus: number
  env: Record<string, string>
  metadata: Record<string, string>
}

/** Env / metadata maps: string → string, bounded. Names like shell variables. */
function stringMap(v: unknown, what: string, maxEntries: number): Record<string, string> {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) throw new QboxInputError(`${what} must be an object of strings.`)
  const out: Record<string, string> = {}
  const entries = Object.entries(v)
  if (entries.length > maxEntries) throw new QboxInputError(`${what}: at most ${maxEntries} entries.`)
  for (const [k, val] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) throw new QboxInputError(`${what}: invalid name "${k.slice(0, 40)}".`)
    if (typeof val !== 'string' || val.length > 4096) throw new QboxInputError(`${what}.${k} must be a string up to 4096 characters.`)
    out[k] = val
  }
  return out
}

export function parseCreate(body: unknown, limits: Pick<Limits, 'maxTimeoutMs' | 'maxPorts' | 'vcpus'> & { tier?: QboxTier } = QBOX_BETA): CreateInput {
  const b = isObj(body) ? body : {}
  const template = b.template === undefined ? 'node24' : b.template
  if (typeof template !== 'string' || !(QBOX_TEMPLATES as readonly string[]).includes(template)) {
    throw new QboxInputError(`template must be one of: ${QBOX_TEMPLATES.join(', ')}.`)
  }
  let timeoutMs: number = Math.min(QBOX_BETA.defaultTimeoutMs, limits.maxTimeoutMs)
  if (b.timeoutMs !== undefined) {
    if (typeof b.timeoutMs !== 'number' || !Number.isFinite(b.timeoutMs)) throw new QboxInputError('timeoutMs must be a number.')
    timeoutMs = Math.round(Math.min(limits.maxTimeoutMs, Math.max(QBOX_BETA.minTimeoutMs, b.timeoutMs)))
  }
  let ports: number[] = []
  if (b.ports !== undefined) {
    if (!Array.isArray(b.ports) || new Set(b.ports).size > limits.maxPorts) throw new QboxInputError(`ports: at most ${limits.maxPorts}.`)
    ports = [...new Set(b.ports)].map((p) => {
      if (!Number.isInteger(p) || (p as number) < 1024 || (p as number) > 65535) throw new QboxInputError('ports must be whole numbers 1024–65535.')
      return p as number
    })
  }
  const net = b.internet
  let internet: QboxNetwork
  if (net === undefined || net === true || net === 'open') internet = 'open'
  else if (net === false || net === 'none') internet = 'none'
  else if (net === 'registries') internet = 'registries'
  else throw new QboxInputError('internet must be true, false, "open", "registries" or "none".')
  let vcpus = limits.vcpus
  if (b.vcpus !== undefined) {
    if (limits.tier !== 'paid') {
      if (b.vcpus !== limits.vcpus) throw new QboxInputError(`vcpus is fixed at ${limits.vcpus} on your plan.`)
    } else if (!(QBOX_PAID_VCPUS as readonly unknown[]).includes(b.vcpus)) {
      throw new QboxInputError(`vcpus must be one of: ${QBOX_PAID_VCPUS.join(', ')}.`)
    } else vcpus = b.vcpus as number
  }
  return {
    template: template as QboxTemplate,
    timeoutMs,
    ports,
    internet,
    vcpus,
    env: stringMap(b.env, 'env', 50),
    metadata: stringMap(b.metadata, 'metadata', 10),
  }
}

export interface ExecInput {
  cmd: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  timeoutMs: number
}

/** `{ cmd: "npm", args: ["test"] }`, or `{ command: "npm test && ls" }` run through `sh -c`. */
export function parseExec(body: unknown): ExecInput {
  if (!isObj(body)) throw new QboxInputError('Send a JSON body with "cmd" (and "args") or "command".')
  let cmd: string
  let args: string[]
  if (typeof body.command === 'string') {
    if (!body.command.trim() || body.command.length > 20_000) throw new QboxInputError('command must be 1–20000 characters.')
    cmd = 'sh'
    args = ['-c', body.command]
  } else {
    if (typeof body.cmd !== 'string' || !body.cmd.trim() || body.cmd.length > 1024 || body.cmd.includes('\0')) {
      throw new QboxInputError('cmd must be a program name, e.g. "node".')
    }
    cmd = body.cmd
    const a = body.args ?? []
    if (!Array.isArray(a) || a.length > 200 || a.some((x) => typeof x !== 'string' || x.length > 20_000 || x.includes('\0'))) {
      throw new QboxInputError('args must be up to 200 strings.')
    }
    args = a as string[]
  }
  const cwd = body.cwd === undefined ? undefined : sandboxPath(body.cwd)
  let timeoutMs: number = QBOX_BETA.maxCommandMs
  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs)) throw new QboxInputError('timeoutMs must be a number.')
    timeoutMs = Math.round(Math.min(QBOX_BETA.maxCommandMs, Math.max(1000, body.timeoutMs)))
  }
  return { cmd, args, cwd, env: stringMap(body.env, 'env', 50), timeoutMs }
}

export const SANDBOX_HOME = '/vercel/sandbox'

/**
 * A path inside the sandbox: absolute, or relative to the working directory. The sandbox is the
 * member's own VM, so this is about clear errors (and no NUL bytes in API calls), not a boundary.
 */
export function sandboxPath(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 1024 || v.includes('\0')) {
    throw new QboxInputError('path must be a file path, e.g. "src/index.js" or "/tmp/out.txt".')
  }
  const p = v.trim()
  const abs = p.startsWith('/') ? p : `${SANDBOX_HOME}/${p}`
  const parts: string[] = []
  for (const seg of abs.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  if (!parts.length) throw new QboxInputError('path must name a file.')
  return '/' + parts.join('/')
}

/** Output of a command, cut to the beta's cap. */
export function clipOutput(s: string): { text: string; truncated: boolean } {
  if (s.length <= QBOX_BETA.maxOutputChars) return { text: s, truncated: false }
  return { text: s.slice(0, QBOX_BETA.maxOutputChars), truncated: true }
}

export interface SandboxRow {
  id: string
  /** null/absent on rows from before supabase/migration-qbox-open.sql: counted as the beta's 2. */
  vcpus?: number | null
  status: 'running' | 'stopped' | 'failed'
  created_at: string
  expires_at: string
  ended_at: string | null
}

/** A row is live while it runs and has not passed its timeout (the engine stops it then). */
export function isLive(row: SandboxRow, now: number): boolean {
  return row.status === 'running' && Date.parse(row.expires_at) > now
}

/** Wall-clock minutes a sandbox counts against the month, from its start to stop / timeout / now. */
export function usedMinutes(row: SandboxRow, now: number, monthStart: number): number {
  const start = Math.max(Date.parse(row.created_at), monthStart)
  const end = Math.min(row.ended_at ? Date.parse(row.ended_at) : Infinity, Date.parse(row.expires_at), now)
  return end > start ? (end - start) / 60_000 : 0
}

export function monthStartUtc(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

export function dayStartUtc(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** vCPU-minutes reserved today across the service: live sandboxes to their timeout, ended ones as used. */
export function vcpuMinutesToday(rows: SandboxRow[], now: number): number {
  const ds = dayStartUtc(now)
  return rows.reduce((sum, r) => sum + usedMinutes(r, isLive(r, now) ? Infinity : now, ds) * (r.vcpus ?? QBOX_BETA.vcpus), 0)
}

export interface Limits {
  tier: QboxTier
  maxConcurrent: number
  monthlyMinutes: number
  maxTimeoutMs: number
  vcpus: number
  maxPorts: number
  network: 'open' | 'registries'
}

export interface GlobalLoad {
  live: number
  vcpuMinutesToday: number
}

export type Admit = { ok: true } | { ok: false; status: 429; error: string }

/**
 * May this account start a sandbox of `timeoutMs`? The whole lifetime is reserved up front, so an
 * account can't start past its month (or the service past its day) with short-looking sandboxes.
 */
export function admitCreate(
  rows: SandboxRow[], limits: Pick<Limits, 'maxConcurrent' | 'monthlyMinutes'> & { vcpus?: number },
  timeoutMs: number, now: number, load: GlobalLoad, caps: { concurrent: number; dailyVcpuMinutes: number } = QBOX_GLOBAL,
): Admit {
  if (load.live >= caps.concurrent) {
    return { ok: false, status: 429, error: 'Qbox is at capacity right now. Try again in a few minutes.' }
  }
  if (load.vcpuMinutesToday + (timeoutMs / 60_000) * (limits.vcpus ?? QBOX_BETA.vcpus) > caps.dailyVcpuMinutes) {
    return { ok: false, status: 429, error: "Qbox has used today's capacity. Try again after midnight UTC, or start a shorter sandbox." }
  }
  const live = rows.filter((r) => isLive(r, now)).length
  if (live >= limits.maxConcurrent) {
    return { ok: false, status: 429, error: `At most ${limits.maxConcurrent} sandbox${limits.maxConcurrent === 1 ? '' : 'es'} at once on your plan. Stop one first (DELETE /v1/sandboxes/{id}).` }
  }
  const ms = monthStartUtc(now)
  // Live sandboxes are counted to their timeout (that time is reserved), finished ones as used.
  const reserved = rows.reduce((sum, r) => sum + usedMinutes(r, isLive(r, now) ? Infinity : now, ms), 0)
  if (reserved + timeoutMs / 60_000 > limits.monthlyMinutes) {
    const left = Math.max(0, Math.floor(limits.monthlyMinutes - reserved))
    return { ok: false, status: 429, error: `Monthly limit: ${limits.monthlyMinutes} sandbox-minutes, ${left} left. Use a shorter timeoutMs, or ask for more at quantecode.com/qbox.` }
  }
  return { ok: true }
}

/** The public shape of a sandbox in API responses. */
export function publicSandbox(row: SandboxRow & { template: string; ports: number[] | null }, now: number, previews: Record<string, string> = {}) {
  return {
    id: row.id,
    template: row.template,
    vcpus: row.vcpus ?? QBOX_BETA.vcpus,
    status: isLive(row, now) ? 'running' : row.status === 'failed' ? 'failed' : 'stopped',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    ports: row.ports ?? [],
    previews,
  }
}

export type AdminAction =
  | { action: 'invite'; userId: string; maxConcurrent: number | null; monthlyMinutes: number | null }
  | { action: 'pause' | 'resume' | 'remove'; userId: string }

/** Admin → Qbox beta: invite / pause / resume / remove one account (Clerk user id). */
export function parseAdminAction(body: unknown): AdminAction {
  const b = isObj(body) ? body : {}
  const userId = typeof b.userId === 'string' ? b.userId.trim() : ''
  if (!/^user_[A-Za-z0-9]{10,64}$/.test(userId)) throw new QboxInputError('userId must be a Clerk user id (user_…).')
  const action = b.action
  if (action === 'pause' || action === 'resume' || action === 'remove') return { action, userId }
  if (action !== 'invite') throw new QboxInputError('action must be invite, pause, resume or remove.')
  const num = (v: unknown, min: number, max: number, what: string) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new QboxInputError(`${what} must be a whole number ${min}–${max}.`)
    return v
  }
  return {
    action, userId,
    maxConcurrent: num(b.maxConcurrent, 1, 50, 'maxConcurrent'),
    monthlyMinutes: num(b.monthlyMinutes, 1, 100_000, 'monthlyMinutes'),
  }
}
