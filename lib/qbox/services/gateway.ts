// The paid gateway in front of every listed service: ANY /api/qbox/v1/x/<slug>/<path>. Server-only.
//
//   1. no X-PAYMENT        → 402 with x402 `accepts` whose payTo is the SELLER's wallet
//   2. seller's balance must cover our fee, else 503 (the buyer pays nothing)
//   3. facilitator /verify → the payment is valid (nothing moves yet)
//   4. the payment's nonce is reserved (one payment = one call, even when retried in parallel)
//   5. the request goes to the seller's server; anything but a 2xx answer → nothing is settled
//   6. facilitator /settle → USDC moves on chain, buyer → seller. Only then the seller's answer is
//      returned (with X-PAYMENT-RESPONSE) and our fee is booked from the seller's Qbox balance.
// We never receive the buyer's USDC, so there is nothing of theirs to hold, refund or pay out.

import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { QBOX_EARN } from '../limits'
import { isLive } from '../model'
import { ownSandbox, paidAccount } from '../store'
import { engine } from '../vercel'
import { QBOX_LINKS } from '../openapi'
import { decodePaymentHeader, encodeHeader, facilitatorConfig, paymentHeader, paymentRequiredBody, paymentRequiredV2, requirementsTo, settleVerified, verifyPayment } from '../x402'
import {
  ServiceInputError, callFeeVcpuMinutes, forwardRequestHeaders, forwardResponseHeaders, parseSlug, paymentNonce,
  publicService, upstreamPath, usdText, type ServiceRow,
} from './model'
import { ServicesNotSetUpError, finishCall, serviceBySlug, startCall } from './store'
import { bookCharge } from './actions'
import { UpstreamError, callUpstream } from './upstream'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Accept',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } })

async function upstreamUrl(s: ServiceRow, path: string): Promise<URL | null> {
  if (s.upstream.kind === 'url') return new URL(s.upstream.url + path)
  const box = await ownSandbox(s.user_id, s.upstream.sandboxId).catch(() => null)
  if (!box || !isLive(box, Date.now())) return null
  const base = await engine().previewUrl(s.upstream.sandboxId, s.upstream.port).catch(() => null)
  return base ? new URL(base.replace(/\/+$/, '') + path) : null
}

async function readBody(request: Request): Promise<Buffer | null | 'too_big'> {
  if (request.method === 'GET' || request.method === 'DELETE') return null
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > QBOX_EARN.maxRequestBytes) return 'too_big'
  const buf = Buffer.from(await request.arrayBuffer())
  return buf.length > QBOX_EARN.maxRequestBytes ? 'too_big' : buf
}

export async function gateway(request: Request, rawSlug: string, segments: string[] | undefined): Promise<Response> {
  if (process.env.QBOX_DISABLED === '1') return json(503, { error: 'Qbox is paused. Try again later.' })
  const ip = getClientIp(request)
  if (!rateLimit(`qbox:x:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`, 120, 60_000).allowed) {
    return json(429, { error: 'At most 120 calls a minute.' })
  }
  let slug: string
  let path: string
  try {
    slug = parseSlug(rawSlug)
    path = upstreamPath(segments, new URL(request.url).search)
  } catch (e) {
    return json(e instanceof ServiceInputError && /path/i.test(e.message) ? 400 : 404, { error: e instanceof ServiceInputError && /path/i.test(e.message) ? e.message : 'No such service.' })
  }

  let s: ServiceRow | null
  try {
    s = await serviceBySlug(slug)
  } catch (e) {
    return json(503, { error: e instanceof ServicesNotSetUpError ? e.message : 'Could not load the service.' })
  }
  if (!s || s.status !== 'live') return json(404, { error: 'No such service (or it is paused).', directory: `${QBOX_LINKS.api}/services` })

  const cfg = facilitatorConfig(process.env)
  if (!cfg || cfg.network !== s.network) return json(503, { error: 'Payments for this service are not available right now.' })
  const price = Number(s.price_units)
  const reqs = requirementsTo(cfg, s.wallet, price, `${QBOX_LINKS.api}/x/${s.slug}`, `${s.name} — $${usdText(price)} per call`)
  const resource = { url: reqs.resource, description: reqs.description, mimeType: 'application/json', serviceName: s.name, tags: s.tags ?? [] }
  const offer = (error: string) => json(
    402,
    paymentRequiredBody(reqs, error, { service: publicService(s!, QBOX_LINKS.api), note: 'You pay only when the seller answers successfully. The payment goes straight to the seller’s wallet.' }),
    { 'PAYMENT-REQUIRED': encodeHeader(paymentRequiredV2(reqs, resource, error)) },
  )

  // x402 v2 PAYMENT-SIGNATURE or v1 X-PAYMENT; the facilitator is called in the buyer's version.
  const raw = paymentHeader(request.headers)
  if (!raw) return offer('Payment required.')
  const payment = decodePaymentHeader(raw)
  const nonce = payment ? paymentNonce(payment) : null
  if (!payment || !nonce) return offer('The payment header must be an x402 exact-scheme payment (base64 JSON with an EIP-3009 authorization).')

  const body = await readBody(request)
  if (body === 'too_big') return json(413, { error: `Request bodies up to ${QBOX_EARN.maxRequestBytes / 1024 / 1024} MB.` })

  // The seller pays our fee from its balance; without it the call is refused before anything moves.
  const fee = callFeeVcpuMinutes(price)
  const balance = await paidAccount(s.user_id, Date.now()).then((a) => a.balance).catch(() => null)
  if (balance === null || balance + 1e-9 < fee) {
    return json(503, { error: 'This service is unavailable: its seller has no Qbox balance left. You were not charged.', code: 'seller_out_of_balance' })
  }

  const v = await verifyPayment(cfg, payment, reqs)
  if (!v.ok) return offer(v.error)

  let callId: string | false
  try {
    callId = await startCall({ service_id: s.id, seller_id: s.user_id, payer: null, price_units: price, nonce, network: cfg.network })
  } catch {
    return json(503, { error: 'Could not start the call. You were not charged.' })
  }
  if (!callId) return json(409, { error: 'This payment was already used for a call. Sign a new one.' })

  const started = Date.now()
  const target = await upstreamUrl(s, path)
  if (!target) {
    await finishCall(callId, { status: 'upstream_failed', duration_ms: 0 })
    return json(502, { error: 'The seller’s server is not running. You were not charged.' })
  }
  let res
  try {
    res = await callUpstream(target, request.method, forwardRequestHeaders(request.headers), body)
  } catch (e) {
    await finishCall(callId, { status: 'upstream_failed', duration_ms: Date.now() - started })
    return json(502, { error: `${e instanceof UpstreamError ? e.message : 'The seller’s server could not be reached.'} You were not charged.` })
  }
  const duration = Date.now() - started
  if (res.status < 200 || res.status >= 300) {
    await finishCall(callId, { status: 'upstream_failed', upstream_status: res.status, duration_ms: duration })
    // The seller's error is passed on so the buyer can fix the request; it is not paid for.
    return new NextResponse(new Uint8Array(res.body), { status: res.status >= 400 ? res.status : 502, headers: { ...CORS, ...forwardResponseHeaders(res.headers), 'X-Qbox-Charged': 'false' } })
  }

  const settled = await settleVerified(cfg, payment, reqs)
  if (!settled.ok) {
    await finishCall(callId, { status: 'settle_failed', upstream_status: res.status, duration_ms: duration })
    return offer(settled.error)
  }
  await finishCall(callId, { status: 'paid', upstream_status: res.status, transaction: settled.transaction, payer: settled.payer, fee_vcpu_minutes: fee, duration_ms: duration })
  if (!(await bookCharge(s.user_id, fee, `sale ${s.slug}`, `svc-call:${callId}`))) {
    console.error(`[qbox services] fee not booked: call ${callId}, seller ${s.user_id}, ${fee} vCPU-min`)
  }
  return new NextResponse(new Uint8Array(res.body), {
    status: res.status,
    headers: { ...CORS, ...forwardResponseHeaders(res.headers), 'X-PAYMENT-RESPONSE': encodeHeader(settled.raw), 'PAYMENT-RESPONSE': encodeHeader(settled.raw), 'X-Qbox-Charged': 'true', 'Cache-Control': 'no-store' },
  })
}

export function gatewayOptions() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
