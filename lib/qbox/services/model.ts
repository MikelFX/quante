// Qbox services — agents sell to agents (2026-11-06, owner: "agents buy and sell among themselves,
// trading knowledge or products"). Pure rules, no I/O, tested in __tests__/qbox-services.test.mjs.
//
// An agent with a Qbox account registers its own wallet (proved by a signature, lib/qbox/services/
// wallet.ts) and publishes a paid HTTP service. Buyers call it through our gateway
// (/api/qbox/v1/x/<slug>/…): no API key, x402 only, and the payment's receiver is the SELLER's wallet,
// so the USDC goes buyer → seller on chain and never through us (no custody: MiCA / AML, see
// docs/qbox/services.md). Our fees (QBOX_EARN) are booked from the seller's prepaid Qbox balance.

import { QBOX_EARN, QBOX_PRICING } from '../limits.ts'

export class ServiceInputError extends Error {}
const bad = (m: string): never => {
  throw new ServiceInputError(m)
}

export const USDC_UNITS = 1_000_000

// ── Slugs, prices, fees ───────────────────────────────────────────────────────

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
/** Names that would read as ours, or as a part of the platform. */
const RESERVED = /^(qbox|quante|assetra|assetradigital|admin|api|mcp|stats|search|services|official|support|billing|wallet|x402|www)(-|$)/

export function parseSlug(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!SLUG.test(s) || s.includes('--')) bad('slug: 3–40 characters a–z, 0–9 and single hyphens, e.g. "pdf-to-markdown".')
  if (RESERVED.test(s)) bad('slug: this name is reserved.')
  return s
}

/** "0.01" / 0.01 → USDC base units (6 decimals), within QBOX_EARN's range. */
export function parsePriceUnits(v: unknown): number {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(s)) bad('priceUsd: a number of US dollars with up to 6 decimals, e.g. "0.01".')
  const [whole, frac = ''] = s.split('.')
  const units = Number(whole) * USDC_UNITS + Number(frac.padEnd(6, '0'))
  if (units < QBOX_EARN.minPriceUsd * USDC_UNITS || units > QBOX_EARN.maxPriceUsd * USDC_UNITS) {
    bad(`priceUsd: from $${QBOX_EARN.minPriceUsd} to $${QBOX_EARN.maxPriceUsd} per call.`)
  }
  return units
}

/** USDC base units → "0.010000"-free text: "0.01". */
export function usdText(units: number): string {
  const s = (units / USDC_UNITS).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return s
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Our fee for one paid call, in vCPU-minutes from the seller's balance. */
export function callFeeVcpuMinutes(priceUnits: number): number {
  const usd = (priceUnits / USDC_UNITS) * (QBOX_EARN.feePercent / 100)
  return Math.max(QBOX_EARN.minFeeVcpuMinutes, round2(usd * QBOX_PRICING.vcpuMinutesPerUsd))
}

export const publishFeeVcpuMinutes = () => QBOX_EARN.publishFeeUsd * QBOX_PRICING.vcpuMinutesPerUsd

// ── Service input ─────────────────────────────────────────────────────────────

export type Upstream = { kind: 'sandbox'; sandboxId: string; port: number } | { kind: 'url'; url: string }

export interface ServiceInput {
  slug: string
  name: string
  description: string
  priceUnits: number
  upstream: Upstream
  inputSchema: Record<string, unknown> | null
  example: string | null
  tags: string[]
}

const text = (v: unknown, field: string, min: number, max: number) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''
  if (s.length < min || s.length > max) bad(`${field}: ${min}–${max} characters.`)
  return s
}

/**
 * Where the gateway forwards a paid call: a port of one of the seller's own Qbox sandboxes, or the
 * seller's own public https URL (checked again against private networks on every call).
 */
export function parseUpstream(v: unknown): Upstream {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (typeof o.sandboxId === 'string' || typeof o.sandbox_id === 'string') {
    const sandboxId = String(o.sandboxId ?? o.sandbox_id)
    if (!/^[0-9a-f-]{36}$/i.test(sandboxId)) bad('upstream.sandboxId: the id returned by create_sandbox.')
    const port = Number(o.port)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) bad('upstream.port: one of the ports the sandbox exposes (1024–65535).')
    return { kind: 'sandbox', sandboxId: sandboxId.toLowerCase(), port }
  }
  const raw = typeof o.url === 'string' ? o.url.trim() : typeof v === 'string' ? v.trim() : ''
  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {
    url = null
  }
  if (!url || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.includes('.')) {
    bad('upstream: {"sandboxId", "port"} of your sandbox, or {"url": "https://…"} of your own public server.')
  }
  url!.hash = ''
  url!.search = ''
  return { kind: 'url', url: url!.toString().replace(/\/+$/, '') }
}

function parseSchema(schema: unknown): Record<string, unknown> | null {
  if (schema === undefined || schema === null) return null
  if (typeof schema !== 'object' || Array.isArray(schema)) bad('inputSchema: a JSON Schema object.')
  if (JSON.stringify(schema).length > 8000) bad('inputSchema: at most 8 kB.')
  return schema as Record<string, unknown>
}

function parseTags(tagsRaw: unknown = []): string[] {
  if (!Array.isArray(tagsRaw) || tagsRaw.length > 5) bad('tags: up to 5 words.')
  const tags = [...new Set((tagsRaw as unknown[]).map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : '')))]
  if (tags.some((t) => !/^[a-z0-9][a-z0-9-]{0,23}$/.test(t))) bad('tags: short words a–z, 0–9, hyphens.')
  return tags
}

const obj = (body: unknown) =>
  (body && typeof body === 'object' && !Array.isArray(body) ? body : bad('Send a JSON object.')) as Record<string, unknown>

export function parseServiceInput(body: unknown): ServiceInput {
  const o = obj(body)
  return {
    slug: parseSlug(o.slug),
    name: text(o.name, 'name', 3, 60),
    description: text(o.description, 'description', 20, 1000),
    priceUnits: parsePriceUnits(o.priceUsd ?? o.price_usd),
    upstream: parseUpstream(o.upstream),
    inputSchema: parseSchema(o.inputSchema ?? o.input_schema),
    example: o.example === undefined || o.example === null ? null : text(o.example, 'example', 1, 2000),
    tags: parseTags(o.tags ?? []),
  }
}

export type ServiceStatus = 'live' | 'paused' | 'removed' | 'blocked'

/** What the seller may change later. Status only between live and paused (blocked is ours). */
export function parseServicePatch(body: unknown): Partial<Omit<ServiceInput, 'slug'>> & { status?: 'live' | 'paused' } {
  const o = obj(body)
  const out: Partial<Omit<ServiceInput, 'slug'>> & { status?: 'live' | 'paused' } = {}
  if (o.name !== undefined) out.name = text(o.name, 'name', 3, 60)
  if (o.description !== undefined) out.description = text(o.description, 'description', 20, 1000)
  if (o.priceUsd !== undefined || o.price_usd !== undefined) out.priceUnits = parsePriceUnits(o.priceUsd ?? o.price_usd)
  if (o.upstream !== undefined) out.upstream = parseUpstream(o.upstream)
  if (o.example !== undefined) out.example = o.example === null ? null : text(o.example, 'example', 1, 2000)
  if (o.inputSchema !== undefined || o.input_schema !== undefined) out.inputSchema = parseSchema(o.inputSchema ?? o.input_schema)
  if (o.tags !== undefined) out.tags = parseTags(o.tags)
  if (o.status !== undefined) {
    if (o.status !== 'live' && o.status !== 'paused') bad('status: "live" or "paused".')
    out.status = o.status as 'live' | 'paused'
  }
  if (!Object.keys(out).length) bad('Nothing to change.')
  return out
}

// ── Wallet proof ──────────────────────────────────────────────────────────────

export const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)

/** The text the seller signs with its wallet key (EIP-191 personal_sign). */
export function walletChallenge(userId: string, address: string, network: string, issuedAt: string): string {
  return [
    'Qbox: this wallet receives payments for my Qbox services.',
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Network: ${network}`,
    `Issued: ${issuedAt}`,
  ].join('\n')
}

/** issuedAt must be a recent ISO time (not in the future beyond a little clock skew). */
export function freshIssuedAt(v: unknown, now: number): string {
  const s = typeof v === 'string' ? v : ''
  const t = Date.parse(s)
  if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(t)) bad('issuedAt: the ISO time from the challenge.')
  if (t > now + 60_000 || now - t > QBOX_EARN.walletChallengeMs) bad('The challenge expired. Ask for a new one.')
  return s
}

// ── Gateway ───────────────────────────────────────────────────────────────────

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'])
/** Headers a buyer may pass on to the seller. Never credentials, cookies or the payment itself. */
const FORWARD = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match'])

export function forwardRequestHeaders(h: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((value, key) => {
    const k = key.toLowerCase()
    if (FORWARD.has(k) || (k.startsWith('x-') && !k.startsWith('x-payment') && !k.startsWith('x-forwarded') && !k.startsWith('x-vercel') && !k.startsWith('x-real') && k !== 'x-api-key')) {
      out[k] = value.slice(0, 2000)
    }
  })
  return out
}

/** Headers of the seller's answer passed back to the buyer (never cookies or hop-by-hop ones). */
export function forwardResponseHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(h)) {
    const k = key.toLowerCase()
    if (v === undefined || HOP.has(k) || k === 'set-cookie' || k.startsWith('access-control-') || k === 'content-encoding') continue
    if (k === 'content-type' || k === 'cache-control' || k === 'etag' || k === 'content-language' || (k.startsWith('x-') && !k.startsWith('x-payment') && !k.startsWith('x-vercel'))) {
      out[k] = Array.isArray(v) ? v.join(', ') : v
    }
  }
  return out
}

/** The path after /x/<slug>, normalised: no dot segments, no backslashes, at most 1 kB. */
export function upstreamPath(segments: string[] | undefined, search: string): string {
  const parts = (segments ?? []).map((p) => {
    if (p === '.' || p === '..' || p.includes('\\') || /[\u0000-\u001f]/.test(p)) bad('Invalid path.')
    return encodeURIComponent(decodeURIComponent(p))
  })
  const path = '/' + parts.join('/')
  const q = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : ''
  if (path.length + q.length > 1024) bad('Path too long.')
  return path + q
}

export const GATEWAY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** The nonce of an exact-scheme payment (one paid call per authorization), or null. */
export function paymentNonce(payment: Record<string, unknown>): string | null {
  const auth = (payment.payload as { authorization?: { nonce?: unknown } } | undefined)?.authorization
  const n = auth?.nonce
  return typeof n === 'string' && /^0x[0-9a-fA-F]{64}$/.test(n) ? n.toLowerCase() : null
}

/** The signed amount (USDC base units) of an exact-scheme payment, or null. */
export function paymentUnits(payment: Record<string, unknown>): number | null {
  const v = (payment.payload as { authorization?: { value?: unknown } } | undefined)?.authorization?.value
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''
  return /^\d{1,15}$/.test(s) ? Number(s) : null
}

// ── Public views and numbers ──────────────────────────────────────────────────

export interface ServiceRow {
  id: string
  slug: string
  user_id: string
  name: string
  description: string
  price_units: number | string
  upstream: Upstream
  input_schema: Record<string, unknown> | null
  example: string | null
  tags: string[] | null
  status: ServiceStatus
  wallet: string
  network: string
  created_at: string
}

export interface CallRow {
  service_id: string
  seller_id: string
  payer: string | null
  price_units: number | string
  status: 'pending' | 'paid' | 'upstream_failed' | 'settle_failed'
  created_at: string
  duration_ms?: number | null
}

export interface ServiceStats { paidCalls: number; failedCalls: number; earnedUsd: string; buyers: number }

export function statsOf(calls: CallRow[]): ServiceStats {
  const paid = calls.filter((c) => c.status === 'paid')
  return {
    paidCalls: paid.length,
    failedCalls: calls.filter((c) => c.status === 'upstream_failed').length,
    earnedUsd: usdText(paid.reduce((s, c) => s + Number(c.price_units), 0)),
    buyers: new Set(paid.map((c) => c.payer?.toLowerCase()).filter(Boolean)).size,
  }
}

/** A service as the directory shows it. The upstream (the seller's server) is never shown. */
export function publicService(row: ServiceRow, apiOrigin: string, stats?: ServiceStats) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceUsd: usdText(Number(row.price_units)),
    currency: 'USDC',
    network: row.network,
    endpoint: `${apiOrigin}/x/${row.slug}`,
    payment: 'x402 (exact, USDC). Call the endpoint; the 402 answer says what to pay. The payment goes straight to the seller’s wallet.',
    sellerWallet: row.wallet,
    inputSchema: row.input_schema ?? null,
    example: row.example ?? null,
    tags: row.tags ?? [],
    status: row.status,
    listedAt: row.created_at,
    thirdParty: true,
    ...(stats ? { stats } : {}),
  }
}

/** Search the directory: every word must appear in the name, description or tags. */
export function matchesQuery(row: Pick<ServiceRow, 'name' | 'description' | 'tags' | 'slug'>, q: string): boolean {
  const hay = `${row.slug} ${row.name} ${row.description} ${(row.tags ?? []).join(' ')}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

/** The marketplace's public numbers (website counter, GET /api/qbox/v1/services/stats). */
export function marketStats(servicesLive: number, calls: CallRow[]) {
  const paid = calls.filter((c) => c.status === 'paid')
  return {
    servicesLive,
    sellers: new Set(paid.map((c) => c.seller_id)).size,
    buyers: new Set(paid.map((c) => c.payer?.toLowerCase()).filter(Boolean)).size,
    paidCalls: paid.length,
    volumeUsd: usdText(paid.reduce((s, c) => s + Number(c.price_units), 0)),
  }
}
