// GET /api/catalog/<supplierProductId> — one catalog product with its description and photos
// (CLAUDE.md §13r). Signed-in merchants only, read-only.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireAdmin } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { catalogProduct } from '@/lib/suppliers/catalog'
import { CatalogNotSetUpError } from '@/lib/suppliers/import'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`catalog:${userId}`, 120, 60_000).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const { id } = await params
  try {
    const product = await catalogProduct(id, !!(await requireAdmin()))
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ product })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return NextResponse.json({ error: 'Not set up' }, { status: 503 })
    throw e
  }
}
