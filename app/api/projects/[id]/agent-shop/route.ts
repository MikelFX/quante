// /api/projects/[id]/agent-shop — the store in the agent-ready registry (Dashboard → Agents).
//   GET     status: the live address, whether its build already serves /.well-known/agent-shop.json,
//           the listing (if any), the fee
//   POST    list the store (or re-read it now when already listed). The store is read first, the
//           fee (CREDIT_COSTS.agent_shop_listing, once per store, Agency included) is charged only
//           when the read worked, and refunded when saving fails.
//   DELETE  take the store out of the registry (free; listing it again later is free too)
// Owner only. Without supabase/migration-agent-shops.sql: GET says not set up, POST answers 503.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { CREDIT_COSTS } from '@/lib/config'
import { debitUnlessAgency, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { getHostingGate } from '@/lib/hosting/gate'
import { getStoreOrigins } from '@/app/api/store/_lib/store-origin'
import { WELL_KNOWN_PATH } from '@/lib/agent-shops/model'
import { RegistryUnavailable, readShop, removeListing, saveListing, shopForProject } from '@/lib/agent-shops/registry'

export const maxDuration = 60

const REASON = 'agent_shop_listing'

async function owner(params: Promise<{ id: string }>) {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params
  const project = await getOwnedProject<{ id: string; name: string }>(id, userId, 'id, name')
  if (!project) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { userId, project }
}

async function liveOrigin(projectId: string): Promise<string | null> {
  const gate = await getHostingGate(projectId)
  if (!gate.everLive || !gate.canDeployProduction) return null
  const { canonical } = await getStoreOrigins(projectId)
  return canonical && canonical.startsWith('https://') ? canonical : null
}

function publicListing(s: Awaited<ReturnType<typeof shopForProject>>) {
  if (!s) return null
  return {
    status: s.status, origin: s.origin, products: s.products_count, inStock: s.in_stock_count, ordering: s.ordering,
    listedAt: s.listed_at, checkedAt: s.checked_at, lastOkAt: s.last_ok_at, lastError: s.status === 'removed' ? null : s.last_error,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  const [origin, agency] = await Promise.all([liveOrigin(o.project.id), isAgencyUser(o.userId)])
  let listing = null
  let ready = true
  try {
    listing = publicListing(await shopForProject(o.project.id))
  } catch (e) {
    if (e instanceof RegistryUnavailable) ready = false
    else throw e
  }
  return NextResponse.json({
    ready,
    origin,
    agentShopUrl: origin ? origin + WELL_KNOWN_PATH : null,
    mcpUrl: origin ? origin + '/api/mcp' : null,
    listing,
    fee: { credits: CREDIT_COSTS.agent_shop_listing, agency, alreadyPaid: !!listing },
  })
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  if (!rateLimit(`agent-shop:${o.userId}`, 10, 3_600_000).allowed) return NextResponse.json({ error: 'Too many tries. Try again in an hour.' }, { status: 429 })

  let existing
  try {
    existing = await shopForProject(o.project.id)
  } catch (e) {
    if (e instanceof RegistryUnavailable) return NextResponse.json({ error: 'The agent registry is not set up yet.' }, { status: 503 })
    throw e
  }
  const origin = await liveOrigin(o.project.id)
  if (!origin) return NextResponse.json({ error: 'Publish the store first — only a live store can be listed.' }, { status: 409 })

  // Free checks first: the store must already answer as agent-ready.
  const read = await readShop(origin)
  if (!read.ok) {
    return NextResponse.json({
      error: `Your live store doesn't answer as agent-ready yet: ${read.error} Publish the store once (or wait for the next store update) and try again. Nothing was charged.`,
    }, { status: 422 })
  }

  // The fee is paid once per store: a store that was ever listed is re-listed for free.
  const charge = !existing
  let charged = false
  if (charge) {
    const debit = await debitUnlessAgency(o.userId, CREDIT_COSTS.agent_shop_listing, REASON, o.project.id)
    if (!debit.ok) return NextResponse.json({ error: `Listing costs ${CREDIT_COSTS.agent_shop_listing} credits. Top up in Billing.` }, { status: 402 })
    charged = !debit.agency
  }
  try {
    const row = await saveListing({ projectId: o.project.id, userId: o.userId, origin, read })
    return NextResponse.json({ ok: true, listing: publicListing(row), charged: charged ? CREDIT_COSTS.agent_shop_listing : 0 })
  } catch (e) {
    if (charged) await refundDebit(o.userId, o.project.id, REASON, `${REASON}_refund`)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save the listing.', refunded: charged }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  try {
    const s = await shopForProject(o.project.id)
    if (!s || s.status === 'removed') return NextResponse.json({ ok: true })
    await removeListing(s.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof RegistryUnavailable) return NextResponse.json({ error: 'The agent registry is not set up yet.' }, { status: 503 })
    throw e
  }
}
