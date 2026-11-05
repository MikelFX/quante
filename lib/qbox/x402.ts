// x402 — HTTP 402 payments an AI agent makes by itself (USDC on Base), for Qbox top-ups.
// Owner 2026-11-05: an agent comes to Qbox and can pay right away, with no human sign-up.
//
// Protocol v1 (x402.org): we answer 402 with `accepts` (what to pay, to whom); the agent's x402
// client signs a USDC transfer authorization (EIP-3009) and repeats the request with an
// `X-PAYMENT` header; a facilitator verifies and settles it on chain; we book the top-up once per
// transaction (qbox_topups.ref) and return `X-PAYMENT-RESPONSE`.
//
// Off until QBOX_X402_PAY_TO (our wallet) is set. QBOX_X402_NETWORK = base (real money) or
// base-sepolia (test, the default); QBOX_X402_FACILITATOR = the facilitator URL (default the
// public x402.org one, which settles base-sepolia); QBOX_X402_FACILITATOR_AUTH = optional
// Authorization header value for a facilitator that needs one.
// Pure parts are tested in __tests__/qbox.test.mjs; `settle` is the only network call.

import { QBOX_PRICING } from './limits.ts'

export const X402_VERSION = 1

const USDC: Record<string, { asset: string; name: string }> = {
  base: { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin' },
  'base-sepolia': { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC' },
}

export interface X402Config { payTo: string; network: string; facilitator: string; auth: string | null }

/** The x402 settings, or null when agent payments are off (or misconfigured). */
export function x402Config(env: Record<string, string | undefined>): X402Config | null {
  const payTo = env.QBOX_X402_PAY_TO?.trim() ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) return null
  const network = env.QBOX_X402_NETWORK?.trim() || 'base-sepolia'
  if (!USDC[network]) return null
  const facilitator = (env.QBOX_X402_FACILITATOR?.trim() || 'https://x402.org/facilitator').replace(/\/+$/, '')
  if (!/^https:\/\//.test(facilitator)) return null
  return { payTo, network, facilitator, auth: env.QBOX_X402_FACILITATOR_AUTH?.trim() || null }
}

/** `?usd=` → whole dollars within the allowed range (default 5). */
export function parseUsd(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return 5
  const n = Number(v)
  if (!Number.isInteger(n) || n < QBOX_PRICING.minUsd || n > QBOX_PRICING.maxUsd) return null
  return n
}

export interface PaymentRequirements {
  scheme: 'exact'
  network: string
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra: { name: string; version: string }
  /** x402 v1 discovery hint (Bazaar): how to call the resource and what it answers. */
  outputSchema?: Record<string, unknown>
}

/** What the agent must pay for `usd` dollars (cents allowed: pay-per-call tools) at `resource`. */
export function requirements(cfg: X402Config, usd: number, resource: string, description: string, outputSchema?: Record<string, unknown>): PaymentRequirements {
  const token = USDC[cfg.network]
  return {
    scheme: 'exact',
    network: cfg.network,
    maxAmountRequired: String(Math.round(usd * 1_000_000)), // USDC has 6 decimals
    resource,
    description,
    mimeType: 'application/json',
    payTo: cfg.payTo,
    maxTimeoutSeconds: 300,
    asset: token.asset,
    extra: { name: token.name, version: '2' },
    ...(outputSchema ? { outputSchema } : {}),
  }
}

/** The 402 body an x402 client understands (plus our own human-readable fields). */
export function paymentRequiredBody(reqs: PaymentRequirements, error: string, extra: Record<string, unknown> = {}) {
  return { x402Version: X402_VERSION, error, accepts: [reqs], ...extra }
}

/** The decoded `X-PAYMENT` header, or null when absent / not base64 JSON. */
export function decodePaymentHeader(value: string | null): Record<string, unknown> | null {
  if (!value || value.length > 20_000) return null
  try {
    const obj = JSON.parse(Buffer.from(value, 'base64').toString('utf8'))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}

export const encodeHeader = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64')

export type Settled = { ok: true; transaction: string; payer: string | null; network: string; raw: unknown } | { ok: false; error: string }

async function facilitatorCall(cfg: X402Config, path: 'verify' | 'settle', payment: Record<string, unknown>, reqs: PaymentRequirements) {
  const body = JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payment, paymentRequirements: reqs })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.auth) headers.Authorization = cfg.auth
  const res = await fetch(`${cfg.facilitator}/${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) })
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

/** Only checks the payment (nothing moves yet). Pay-per-call tools verify, work, then settle. Never throws. */
export async function verifyPayment(cfg: X402Config, payment: Record<string, unknown>, reqs: PaymentRequirements): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await facilitatorCall(cfg, 'verify', payment, reqs)
    return v?.isValid ? { ok: true } : { ok: false, error: `Payment not valid: ${String(v?.invalidReason ?? 'rejected by the facilitator')}.` }
  } catch {
    return { ok: false, error: 'The payment facilitator could not be reached. Nothing was charged; try again.' }
  }
}

/** Settles an already verified payment. Never throws. */
export async function settleVerified(cfg: X402Config, payment: Record<string, unknown>, reqs: PaymentRequirements): Promise<Settled> {
  try {
    const s = await facilitatorCall(cfg, 'settle', payment, reqs)
    if (!s?.success || typeof s.transaction !== 'string' || !s.transaction) {
      return { ok: false, error: `Payment not settled: ${String(s?.errorReason ?? 'the facilitator did not confirm it')}.` }
    }
    return { ok: true, transaction: s.transaction, payer: typeof s.payer === 'string' ? s.payer : null, network: String(s.network ?? cfg.network), raw: s }
  } catch {
    return { ok: false, error: 'The payment facilitator could not be reached. Nothing was charged; try again.' }
  }
}

/** Verify, then settle, the agent's payment through the facilitator. Never throws. */
export async function settle(cfg: X402Config, payment: Record<string, unknown>, reqs: PaymentRequirements): Promise<Settled> {
  const v = await verifyPayment(cfg, payment, reqs)
  if (!v.ok) return v
  return settleVerified(cfg, payment, reqs)
}

/** The USDC base units the agent signed (exact scheme), or null. */
export function signedUnits(payment: Record<string, unknown>): string | null {
  const value = (payment.payload as { authorization?: { value?: unknown } } | undefined)?.authorization?.value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const s = String(value)
  return /^\d{1,15}$/.test(s) ? s : null
}

/**
 * Whole US dollars the agent signed in its payment (exact scheme, EIP-3009 authorization.value in
 * USDC base units), or null when it isn't a whole amount within QBOX_PRICING's range.
 */
export function paidUsd(payment: Record<string, unknown>): number | null {
  const inner = payment.payload as { authorization?: { value?: unknown } } | undefined
  const value = inner?.authorization?.value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const s = String(value)
  if (!/^\d{1,15}$/.test(s)) return null
  const units = Number(s)
  if (units % 1_000_000 !== 0) return null
  const usd = units / 1_000_000
  return usd >= QBOX_PRICING.minUsd && usd <= QBOX_PRICING.maxUsd ? usd : null
}
