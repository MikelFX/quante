// /api/projects/[id]/catalog — the store's catalog products (CLAUDE.md §13r). Owner only, free.
//   GET    { setUp, links: which store product is which supplier product (+ price alerts, stock),
//            orders: what went to which supplier }
//   POST   { supplierProductId, price } → add a catalog product to the store: photos copied, a new
//          code version with the product (live only after Publish), link + stock row saved
//   PATCH  { productId, action: 'ack-price' } → the merchant saw the new wholesale price
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireAdmin } from '@/lib/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { acknowledgePrice, addToStore, storeLinks } from '@/lib/suppliers/catalog'
import { supplierOrdersForProject } from '@/lib/suppliers/dispatch'
import { CatalogNotSetUpError } from '@/lib/suppliers/import'

export const maxDuration = 60

async function owner(params: Promise<{ id: string }>) {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { userId, projectId: project.id }
}

const notSetUp = () => NextResponse.json({ error: 'The supplier catalog is not set up yet.' }, { status: 503 })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  try {
    const [links, orders] = await Promise.all([storeLinks(o.projectId), supplierOrdersForProject(o.projectId)])
    return NextResponse.json({ setUp: true, links, orders })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return NextResponse.json({ setUp: false, links: [], orders: [] })
    throw e
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  if (!rateLimit(`catalog-add:${o.userId}`, 30, 60_000).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const body = (await request.json().catch(() => ({}))) as { supplierProductId?: unknown; price?: unknown }
  if (typeof body.supplierProductId !== 'string') return NextResponse.json({ error: 'supplierProductId required' }, { status: 400 })
  try {
    const r = await addToStore(o.userId, o.projectId, body.supplierProductId, body.price, !!(await requireAdmin()))
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, product: r.product, versionId: r.versionId, versionNo: r.versionNo })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return notSetUp()
    throw e
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owner(params)
  if ('error' in o) return o.error
  const body = (await request.json().catch(() => ({}))) as { productId?: unknown; action?: unknown }
  if (body.action !== 'ack-price' || typeof body.productId !== 'string') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  try {
    const ok = await acknowledgePrice(o.projectId, body.productId.slice(0, 80))
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return notSetUp()
    throw e
  }
}
