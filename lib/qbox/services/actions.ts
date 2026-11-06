// Qbox services operations shared by the REST API (app/api/qbox/v1/services/**, /wallet) and the MCP
// server (app/api/qbox/v1/mcp). Server-only. Selling needs the paid tier (our fees come out of the
// seller's prepaid balance); browsing the directory needs nothing.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { QBOX_EARN } from '../limits'
import { chargeOperation, ensureBalance } from '../billing'
import { ownSandbox, paidAccount } from '../store'
import type { Caller, Result } from '../actions'
import { facilitatorConfig } from '../x402'
import { QBOX_LINKS } from '../openapi'
import {
  ServiceInputError, freshIssuedAt, isAddress, matchesQuery, parseServiceInput, parseServicePatch, parseSlug,
  publicService, publishFeeVcpuMinutes, statsOf, usdText, walletChallenge, callFeeVcpuMinutes, type ServiceRow,
} from './model'
import { signedBy } from './wallet'
import {
  ServicesNotSetUpError, callsOf, deleteService, insertService, liveServices, saveWallet, serviceBySlug, servicesOf,
  updateService, walletOf,
} from './store'

const fail = (status: number, error: string, body?: Record<string, unknown>) => ({ ok: false as const, status, error, ...(body ? { body } : {}) })
const NOT_SET_UP = fail(503, 'Qbox services are not set up yet.')

function caught(e: unknown) {
  if (e instanceof ServiceInputError) return fail(400, e.message)
  if (e instanceof ServicesNotSetUpError) return NOT_SET_UP
  console.error('[qbox services]', e)
  return fail(500, 'Something went wrong. Try again.')
}

const paidOnly = (c: Caller) =>
  c.member.tier === 'paid' ? null : fail(403, 'Selling services needs the paid Qbox tier (fees come from your prepaid balance).')

function network() {
  const f = facilitatorConfig(process.env)
  return f?.network ?? null
}

/** Books a fee from a seller's balance (negative vCPU-minutes). false on a database error. */
export async function bookCharge(userId: string, vcpuMinutes: number, note: string, ref?: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('qbox_topups').insert({
    user_id: userId, vcpu_minutes: -vcpuMinutes, source: 'charge', note: note.slice(0, 300), ...(ref ? { ref } : {}),
  })
  return !error || error.code === '23505'
}

// ── Wallet ────────────────────────────────────────────────────────────────────

export async function walletInfo(c: Caller): Promise<Result<unknown>> {
  const net = network()
  if (!net) return fail(503, 'Payments are not configured.')
  try {
    const w = await walletOf(c.member.userId)
    const issuedAt = new Date().toISOString()
    return {
      ok: true,
      data: {
        wallet: w ? { address: w.address, network: w.network, verifiedAt: w.verified_at } : null,
        network: net,
        register: {
          howTo: 'Sign `message` with your wallet key (EIP-191 personal_sign, a plain account, not a smart-contract wallet), '
            + 'replacing <ADDRESS> with your address, then PUT /api/qbox/v1/wallet {"address", "signature", "issuedAt"} within 15 minutes.',
          issuedAt,
          message: walletChallenge(c.member.userId, '<ADDRESS>', net, issuedAt),
        },
        note: 'Buyers pay this wallet directly. Qbox never holds, converts or pays out your USDC, and never sees your key.',
      },
    }
  } catch (e) {
    return caught(e)
  }
}

export async function registerWallet(c: Caller, body: unknown): Promise<Result<unknown>> {
  const notPaid = paidOnly(c)
  if (notPaid) return notPaid
  const net = network()
  if (!net) return fail(503, 'Payments are not configured.')
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  try {
    if (!isAddress(o.address)) return fail(400, 'address: a 0x… wallet address (40 hex characters).')
    const issuedAt = freshIssuedAt(o.issuedAt ?? o.issued_at, Date.now())
    const message = walletChallenge(c.member.userId, o.address, net, issuedAt)
    if (!signedBy(message, o.signature, o.address)) {
      return fail(400, 'The signature does not match this address and message. Sign exactly the challenge text with this wallet (personal_sign).')
    }
    const paid = await chargeOperation(c.member, c.resource, 'wallet')
    if (!paid.ok) return paid
    await saveWallet(c.member.userId, o.address, net, String(o.signature), message)
    return { ok: true, data: { wallet: { address: o.address.toLowerCase(), network: net }, note: 'Your listed services are now paid to this wallet.' } }
  } catch (e) {
    return caught(e)
  }
}

// ── Selling ───────────────────────────────────────────────────────────────────

async function upstreamIsOwn(c: Caller, s: { upstream: ServiceRow['upstream'] }) {
  if (s.upstream.kind !== 'sandbox') return true
  return !!(await ownSandbox(c.member.userId, s.upstream.sandboxId).catch(() => null))
}

export async function publishService(c: Caller, body: unknown): Promise<Result<unknown>> {
  const notPaid = paidOnly(c)
  if (notPaid) return notPaid
  try {
    const input = parseServiceInput(body)
    const wallet = await walletOf(c.member.userId)
    if (!wallet) return fail(409, 'Register your wallet first: GET then PUT /api/qbox/v1/wallet.')
    if (wallet.network !== network()) return fail(409, `Your wallet was registered for ${wallet.network}; register it again for ${network()}.`)
    if (!(await upstreamIsOwn(c, input))) return fail(400, 'upstream.sandboxId: not one of your sandboxes.')
    const mine = await servicesOf(c.member.userId)
    if (mine.length >= QBOX_EARN.maxServicesPerAccount) return fail(409, `At most ${QBOX_EARN.maxServicesPerAccount} services per account.`)
    const fee = publishFeeVcpuMinutes()
    const covered = await ensureBalance(c.member, c.resource, fee)
    if (!covered.ok) return covered
    const row = await insertService(c.member.userId, input, wallet.address, wallet.network)
    if (!row) return fail(409, 'This slug is taken. Pick another one.')
    if (!(await bookCharge(c.member.userId, fee, `publish ${row.slug}`, `svc-publish:${row.id}`))) {
      await deleteService(row.id)
      return fail(503, 'Could not book the publishing fee. Nothing was listed; try again.')
    }
    return {
      ok: true, status: 201,
      data: {
        service: publicService(row, QBOX_LINKS.api),
        billing: { publishFeeVcpuMinutes: fee, perCallFee: `${QBOX_EARN.feePercent} % of the price (at least ${QBOX_EARN.minFeeVcpuMinutes} vCPU-minute) from your balance` },
        note: 'Buyers call `endpoint` and pay your wallet over x402. If your balance runs out, calls answer 503 until you top up.',
      },
    }
  } catch (e) {
    return caught(e)
  }
}

async function ownService(c: Caller, rawSlug: unknown): Promise<Result<ServiceRow>> {
  let slug: string
  try {
    slug = parseSlug(rawSlug)
  } catch {
    return fail(404, 'No such service.')
  }
  const row = await serviceBySlug(slug)
  if (!row || row.user_id !== c.member.userId || row.status === 'removed') return fail(404, 'No such service.')
  return { ok: true, data: row }
}

export async function changeService(c: Caller, slug: unknown, body: unknown): Promise<Result<unknown>> {
  const notPaid = paidOnly(c)
  if (notPaid) return notPaid
  try {
    const o = await ownService(c, slug)
    if (!o.ok) return o
    if (o.data.status === 'blocked') return fail(403, 'This service was blocked by the operator.')
    const p = parseServicePatch(body)
    if (p.upstream && !(await upstreamIsOwn(c, { upstream: p.upstream }))) return fail(400, 'upstream.sandboxId: not one of your sandboxes.')
    const paid = await chargeOperation(c.member, c.resource, `update ${o.data.slug}`)
    if (!paid.ok) return paid
    const patch: Record<string, unknown> = {}
    if (p.name !== undefined) patch.name = p.name
    if (p.description !== undefined) patch.description = p.description
    if (p.priceUnits !== undefined) patch.price_units = p.priceUnits
    if (p.upstream !== undefined) patch.upstream = p.upstream
    if (p.example !== undefined) patch.example = p.example
    if (p.inputSchema !== undefined) patch.input_schema = p.inputSchema
    if (p.tags !== undefined) patch.tags = p.tags
    if (p.status !== undefined) patch.status = p.status
    await updateService(o.data.id, patch)
    const row = await serviceBySlug(o.data.slug)
    return { ok: true, data: { service: row ? publicService(row, QBOX_LINKS.api) : null } }
  } catch (e) {
    return caught(e)
  }
}

export async function removeService(c: Caller, slug: unknown): Promise<Result<unknown>> {
  try {
    const o = await ownService(c, slug)
    if (!o.ok) return o
    const paid = await chargeOperation(c.member, c.resource, `remove ${o.data.slug}`)
    if (!paid.ok) return paid
    // The slug stays taken, so nobody can step into a removed service's name and its old buyers.
    await updateService(o.data.id, { status: o.data.status === 'blocked' ? 'blocked' : 'removed' })
    return { ok: true, data: { slug: o.data.slug, status: 'removed' } }
  } catch (e) {
    return caught(e)
  }
}

/** The seller's own services with sales numbers (all time and the last 30 days) and its balance. */
export async function myServices(c: Caller): Promise<Result<unknown>> {
  try {
    const [rows, wallet] = await Promise.all([servicesOf(c.member.userId), walletOf(c.member.userId)])
    const calls = await callsOf(rows.map((r) => r.id))
    const since = Date.now() - 30 * 86_400_000
    const balance = c.member.tier === 'paid' ? await paidAccount(c.member.userId, Date.now()).then((a) => a.balance).catch(() => null) : null
    return {
      ok: true,
      data: {
        wallet: wallet ? { address: wallet.address, network: wallet.network } : null,
        balanceVcpuMinutes: balance,
        services: rows.map((r) => {
          const own = calls.filter((x) => x.service_id === r.id)
          return {
            ...publicService(r, QBOX_LINKS.api, statsOf(own)),
            last30Days: statsOf(own.filter((x) => Date.parse(x.created_at) >= since)),
            feePerCallVcpuMinutes: callFeeVcpuMinutes(Number(r.price_units)),
          }
        }),
      },
    }
  } catch (e) {
    return caught(e)
  }
}

// ── Directory (public) ────────────────────────────────────────────────────────

export async function searchServices(params: { q?: string | null; tag?: string | null; limit?: number; offset?: number }): Promise<Result<unknown>> {
  try {
    let rows = await liveServices()
    const q = (params.q ?? '').trim().slice(0, 100)
    const tag = (params.tag ?? '').trim().toLowerCase()
    if (q) rows = rows.filter((r) => matchesQuery(r, q))
    if (tag) rows = rows.filter((r) => (r.tags ?? []).includes(tag))
    const limit = Math.min(100, Math.max(1, params.limit ?? 50))
    const offset = Math.max(0, params.offset ?? 0)
    const page = rows.slice(offset, offset + limit)
    const calls = await callsOf(page.map((r) => r.id)).catch(() => [])
    return {
      ok: true,
      data: {
        total: rows.length,
        services: page.map((r) => publicService(r, QBOX_LINKS.api, statsOf(calls.filter((x) => x.service_id === r.id)))),
        howToBuy: 'Call a service’s `endpoint` with any x402 client: the first answer is 402 with the price and the seller’s wallet; '
          + 'repeat with X-PAYMENT. You pay only when the seller answers successfully. Services are run by third parties, not by Qbox.',
        howToSell: `${QBOX_LINKS.llms} (section "Sell to other agents")`,
      },
    }
  } catch (e) {
    return caught(e)
  }
}

export async function getService(rawSlug: unknown): Promise<Result<unknown>> {
  try {
    const slug = parseSlug(rawSlug)
    const row = await serviceBySlug(slug)
    if (!row || row.status !== 'live') return fail(404, 'No such service.')
    const calls = await callsOf([row.id])
    return { ok: true, data: { ...publicService(row, QBOX_LINKS.api, statsOf(calls)), priceText: `$${usdText(Number(row.price_units))} per call` } }
  } catch (e) {
    return e instanceof ServiceInputError ? fail(404, 'No such service.') : caught(e)
  }
}
