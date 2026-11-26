// GET /api/catalog?q=&supplier=&brand=&category=&inStock=1&currency=CZK&minPrice=&maxPrice=&sort=&page=0&facets=1
// — the supplier catalog (CLAUDE.md §13r) for signed-in merchants: products from the operator's
// dropship suppliers with the wholesale price, a suggested selling price and the margin; with
// facets=1 also the category / brand counts for the filter sidebar. Read-only, free. The demo
// supplier (lib/suppliers/demo.ts) is in the answer for admins only.
// Without supabase/migration-supplier-catalog.sql: { setUp: false }.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireAdmin } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { catalogFacets, searchCatalog } from '@/lib/suppliers/catalog'
import { parseSort } from '@/lib/suppliers/demo'
import { CatalogNotSetUpError } from '@/lib/suppliers/import'

const num = (v: string | null) => (v && /^\d{1,7}(?:[.,]\d{1,2})?$/.test(v) ? Number(v.replace(',', '.')) : null)

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`catalog:${userId}`, 120, 60_000).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const p = new URL(request.url).searchParams
  const includeDemo = !!(await requireAdmin())
  try {
    const [result, facets] = await Promise.all([
      searchCatalog({
        q: p.get('q'), supplier: p.get('supplier'), brand: p.get('brand'), category: p.get('category'), inStock: p.get('inStock') === '1',
        currency: p.get('currency'), minPrice: num(p.get('minPrice')), maxPrice: num(p.get('maxPrice')), sort: parseSort(p.get('sort')),
        page: Number(p.get('page') ?? 0) || 0, includeDemo,
      }),
      p.get('facets') === '1' ? catalogFacets({ currency: p.get('currency'), includeDemo }) : Promise.resolve(null),
    ])
    return NextResponse.json({ setUp: true, admin: includeDemo, ...result, ...(facets ? { facets } : {}) })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return NextResponse.json({ setUp: false, items: [], total: 0, page: 0, suppliers: [] })
    console.error('[catalog] search failed:', e)
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 })
  }
}
