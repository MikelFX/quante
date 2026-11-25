// GET /api/catalog?q=&supplier=&brand=&inStock=1&currency=CZK&page=0 — the supplier catalog
// (CLAUDE.md §13r) for signed-in merchants: products from the operator's dropship suppliers with
// the wholesale price, a suggested selling price and the margin. Read-only, free.
// Without supabase/migration-supplier-catalog.sql: { setUp: false }.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit } from '@/lib/rate-limit'
import { searchCatalog } from '@/lib/suppliers/catalog'
import { CatalogNotSetUpError } from '@/lib/suppliers/import'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`catalog:${userId}`, 120, 60_000).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const p = new URL(request.url).searchParams
  try {
    const result = await searchCatalog({
      q: p.get('q'), supplier: p.get('supplier'), brand: p.get('brand'), inStock: p.get('inStock') === '1',
      currency: p.get('currency'), page: Number(p.get('page') ?? 0) || 0,
    })
    return NextResponse.json({ setUp: true, ...result })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return NextResponse.json({ setUp: false, items: [], total: 0, page: 0, suppliers: [] })
    console.error('[catalog] search failed:', e)
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 })
  }
}
