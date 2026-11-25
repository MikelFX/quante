// GET /api/cron/suppliers — daily Vercel cron (vercel.json): imports every active supplier's feed
// into the catalog and pushes stock + price alerts into the stores that sell those products
// (lib/suppliers/import.ts). Fails closed without CRON_SECRET (lib/cron-auth.ts).
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { activeSuppliers, CatalogNotSetUpError, importSupplier, type ImportResult } from '@/lib/suppliers/import'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const suppliers = await activeSuppliers()
    const results: ImportResult[] = []
    for (const s of suppliers) {
      results.push(await importSupplier(s).catch((e) => ({ supplier: s.slug, ok: false, error: e instanceof Error ? e.message : 'failed' })))
    }
    return NextResponse.json({ suppliers: results.length, ok: results.filter((r) => r.ok).length, results })
  } catch (e) {
    if (e instanceof CatalogNotSetUpError) return NextResponse.json({ setUp: false })
    throw e
  }
}
