// Qbox — sandboxes for AI agents, closed beta (2026-11-04, owner). Pure rules, no I/O, tested in
// __tests__/qbox.test.mjs.
//
// Phase 0 of /mnt/project-files/sandbox/sandbox-pro-agenty.md: our own API, keys, limits and
// usage on top of an exchangeable engine (lib/qbox/provider.ts; today Vercel Sandbox). Only
// invited accounts (`qbox_beta` rows, added by the operator) get keys; the beta is free, so the
// caps below are what protects the operator's Vercel bill.

import { createHash, randomBytes } from 'node:crypto'

/** Defaults for one beta member (a `qbox_beta` row may override concurrency and minutes). */
export const QBOX_BETA = {
  /** Sandboxes running at once per member. */
  maxConcurrent: 2,
  /** Sandbox-minutes per calendar month (UTC) per member, counted by wall-clock lifetime. */
  monthlyMinutes: 600,
  /** Default and maximum lifetime of one sandbox. */
  defaultTimeoutMs: 5 * 60_000,
  maxTimeoutMs: 30 * 60_000,
  minTimeoutMs: 60_000,
  /** One command may run at most this long (the API call waits for it). */
  maxCommandMs: 4 * 60_000,
  /** vCPUs per sandbox (Vercel Sandbox minimum is 1, memory follows the vCPUs). */
  vcpus: 2,
  /** Biggest file one request may write or read. */
  maxFileBytes: 5 * 1024 * 1024,
  /** stdout / stderr returned per command (the rest is cut, flagged `truncated`). */
  maxOutputChars: 200_000,
  /** Ports one sandbox may expose as a public preview URL. */
  maxPorts: 2,
  /** API keys per member. */
  maxKeys: 5,
  /** Sandboxes running at once across the whole beta (operator's spend guard). */
  globalConcurrent: 20,
} as const

/** Templates a beta sandbox can start from (Vercel Sandbox runtimes). */
export const QBOX_TEMPLATES = ['node24', 'node22', 'python3.13'] as const
export type QboxTemplate = (typeof QBOX_TEMPLATES)[number]

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
  internet: boolean
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

export function parseCreate(body: unknown): CreateInput {
  const b = isObj(body) ? body : {}
  const template = b.template === undefined ? 'node24' : b.template
  if (typeof template !== 'string' || !(QBOX_TEMPLATES as readonly string[]).includes(template)) {
    throw new QboxInputError(`template must be one of: ${QBOX_TEMPLATES.join(', ')}.`)
  }
  let timeoutMs: number = QBOX_BETA.defaultTimeoutMs
  if (b.timeoutMs !== undefined) {
    if (typeof b.timeoutMs !== 'number' || !Number.isFinite(b.timeoutMs)) throw new QboxInputError('timeoutMs must be a number.')
    timeoutMs = Math.round(Math.min(QBOX_BETA.maxTimeoutMs, Math.max(QBOX_BETA.minTimeoutMs, b.timeoutMs)))
  }
  let ports: number[] = []
  if (b.ports !== undefined) {
    if (!Array.isArray(b.ports) || b.ports.length > QBOX_BETA.maxPorts) throw new QboxInputError(`ports: at most ${QBOX_BETA.maxPorts}.`)
    ports = [...new Set(b.ports)].map((p) => {
      if (!Number.isInteger(p) || (p as number) < 1024 || (p as number) > 65535) throw new QboxInputError('ports must be whole numbers 1024–65535.')
      return p as number
    })
  }
  if (b.internet !== undefined && typeof b.internet !== 'boolean') throw new QboxInputError('internet must be true or false.')
  return {
    template: template as QboxTemplate,
    timeoutMs,
    ports,
    internet: b.internet !== false,
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

export interface Limits {
  maxConcurrent: number
  monthlyMinutes: number
}

export type Admit = { ok: true } | { ok: false; status: 429; error: string }

/**
 * May this member start a sandbox of `timeoutMs`? The whole lifetime is reserved up front, so a
 * member can't start past their month by running many short-looking sandboxes.
 */
export function admitCreate(rows: SandboxRow[], limits: Limits, timeoutMs: number, now: number, globalLive: number): Admit {
  if (globalLive >= QBOX_BETA.globalConcurrent) {
    return { ok: false, status: 429, error: 'The beta is at capacity right now. Try again in a few minutes.' }
  }
  const live = rows.filter((r) => isLive(r, now)).length
  if (live >= limits.maxConcurrent) {
    return { ok: false, status: 429, error: `At most ${limits.maxConcurrent} sandboxes at once in the beta. Stop one first (DELETE /v1/sandboxes/{id}).` }
  }
  const ms = monthStartUtc(now)
  // Live sandboxes are counted to their timeout (that time is reserved), finished ones as used.
  const reserved = rows.reduce((sum, r) => sum + usedMinutes(r, isLive(r, now) ? Infinity : now, ms), 0)
  if (reserved + timeoutMs / 60_000 > limits.monthlyMinutes) {
    const left = Math.max(0, Math.floor(limits.monthlyMinutes - reserved))
    return { ok: false, status: 429, error: `Monthly beta limit: ${limits.monthlyMinutes} sandbox-minutes, ${left} left. Ask for more, or use a shorter timeoutMs.` }
  }
  return { ok: true }
}

/** The public shape of a sandbox in API responses. */
export function publicSandbox(row: SandboxRow & { template: string; ports: number[] | null }, now: number, previews: Record<string, string> = {}) {
  return {
    id: row.id,
    template: row.template,
    status: isLive(row, now) ? 'running' : row.status === 'failed' ? 'failed' : 'stopped',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    ports: row.ports ?? [],
    previews,
  }
}
