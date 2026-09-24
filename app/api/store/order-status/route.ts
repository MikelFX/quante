// Bank-transfer payment instructions for one order — called server-side by a deployed
// store's /api/order-status proxy (lib/store-template/build.ts) when its /success page
// needs the account, amount and variable symbol.
//
// SECURITY (audit #56): those values used to travel in the /success URL and were
// rendered as-is, so anyone could mail customers a link on the store's own domain
// showing an attacker's account. Now the checkout redirect carries only the order id
// and a random per-order token (store_orders.public_token_hash stores its SHA-256), and
// this endpoint returns the verified values only for a matching token:
//   GET /api/store/order-status?orderId=<uuid>&token=<t>
//   GET /api/store/order-status?projectId=<uuid>&order=<order number>&t=<t>   (store proxy form)
// - the token is compared in constant time; unknown / wrong / expired → 404 (no oracle);
// - if the caller sends a store Bearer key it must belong to the order's project;
// - only bank-transfer (prevod) orders, only for TOKEN_TTL_DAYS after the order;
// - rate-limited per store (valid key) or per IP; responses are no-store;
// - returns only { orderNumber, method, amount, currency, vs, account }.

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { loadStoreEmailContext } from '@/lib/order-emails'
import { authenticateStoreKey, resolveStoreKeyProject, sha256Hex } from '../_lib/store-auth'

const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/
const ORDER_NUMBER_RE = /^[A-Za-z0-9-]{1,40}$/
const TOKEN_TTL_DAYS = 30
const NO_STORE = { 'Cache-Control': 'no-store' }

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function GET(request: Request) {
  // Rate limit: the intended caller is a store's server-side proxy, whose connecting
  // IP is a shared Vercel egress IP — one per-IP bucket would be shared by every store
  // behind it. A caller with a valid store key therefore gets its own per-project
  // bucket; everything else (including a throttled key check) keys on the IP.
  const ip = getClientIp(request)
  const hasAuthHeader = !!request.headers.get('authorization')
  const keyResult = hasAuthHeader ? await resolveStoreKeyProject(request, ip) : null
  const keyProject = keyResult?.status === 'ok' ? keyResult.projectId : null
  const rl = keyProject
    ? rateLimit(`store-order-status:p:${keyProject}`, 600, 10 * 60_000)
    : rateLimit(`store-order-status:${ip}`, 60, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { ...NO_STORE, 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    })
  }

  // A key that was presented but isn't a store key never gets an answer.
  if (keyResult?.status === 'invalid') return notFound()

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token') ?? searchParams.get('t') ?? ''
  const orderId = searchParams.get('orderId')
  const projectId = searchParams.get('projectId')
  const orderNumber = searchParams.get('order')
  if (!TOKEN_RE.test(token)) return notFound()

  const tokenHash = sha256Hex(token)
  let query = supabaseAdmin
    .from('store_orders')
    .select('id, project_id, order_number, payment_method, total_cents, currency, created_at, public_token_hash')
    .eq('public_token_hash', tokenHash)
  if (isUuid(orderId)) {
    query = query.eq('id', orderId)
    if (isUuid(projectId)) query = query.eq('project_id', projectId)
  } else if (isUuid(projectId) && orderNumber && ORDER_NUMBER_RE.test(orderNumber)) {
    query = query.eq('project_id', projectId).eq('order_number', orderNumber)
  } else {
    return notFound()
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    // Includes "column does not exist" before migration-security2-store-checkout.sql runs.
    console.error('[store/order-status] lookup failed:', error.message)
    return notFound()
  }
  const order = data as {
    id: string; project_id: string; order_number: string; payment_method: string | null
    total_cents: number | null; currency: string | null; created_at: string | null; public_token_hash: string | null
  } | null
  if (!order || typeof order.public_token_hash !== 'string' || !sameHash(order.public_token_hash, tokenHash)) return notFound()
  if (order.payment_method !== 'prevod') return notFound()
  const createdMs = order.created_at ? Date.parse(order.created_at) : NaN
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > TOKEN_TTL_DAYS * 86_400_000) return notFound()

  // A store proxy authenticates with its key; the key must be this order's store.
  // (A key the failure throttle didn't check is verified against the DB here — only
  // reachable with a valid order token, and within the per-IP limit above.)
  if (keyResult) {
    if (keyProject) {
      if (keyProject !== order.project_id) return notFound()
    } else {
      const store = await authenticateStoreKey(request)
      if (!store || store.project_id !== order.project_id) return notFound()
    }
  }

  const totalCents = Number(order.total_cents)
  if (!Number.isInteger(totalCents) || totalCents <= 0) return notFound()

  const ctx = await loadStoreEmailContext(order.project_id)
  return NextResponse.json({
    orderNumber: order.order_number,
    method: 'prevod',
    amount: totalCents / 100,
    currency: (order.currency ?? '').toUpperCase(),
    vs: order.order_number.replace(/\D/g, '').slice(0, 10),
    account: ctx?.bankAccount ?? '',
  }, { headers: NO_STORE })
}
