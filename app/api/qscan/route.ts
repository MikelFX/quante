// POST /api/qscan — scan an existing store by its address (Qscan). Signed-in users only.
//
// Reads the site (lib/qscan/scan.ts), copies its images and short videos into store-assets
// (lib/qscan/assets.ts) and returns what was found plus a generation brief. Building the new
// store is the normal POST /api/quante/generate with that brief (credits, limits and refunds as
// for any generation) — the scan itself costs no credits; it is capped per day instead.
//
// The visitor must confirm they own the store or may use its content (`rights: true`).

import { randomUUID } from 'crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { isAgencyUser } from '@/lib/tier'
import { normalizeScanUrl } from '@/lib/qscan/net'
import { ScanError, scanStore } from '@/lib/qscan/scan'
import { copyScanAssets } from '@/lib/qscan/assets'
import { PLATFORM_LABEL, buildBrief } from '@/lib/qscan/extract'
import { QSCAN_DAILY_SCANS, QSCAN_DAILY_SCANS_AGENCY } from '@/lib/config'

export const maxDuration = 120

const SCAN_BUDGET_MS = 45_000
const COPY_BUDGET_MS = 50_000

function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in to scan a store.' }, { status: 401 })

  let body: { url?: unknown; rights?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const url = typeof body?.url === 'string' ? normalizeScanUrl(body.url) : null
  if (!url) return NextResponse.json({ error: 'Enter the address of a public website, e.g. mystore.com.' }, { status: 400 })
  if (body.rights !== true) {
    return NextResponse.json({ error: 'Confirm that the store is yours or that you may use its content.' }, { status: 400 })
  }

  const burst = rateLimit(`qscan:${userId}`, 2, 60_000)
  if (!burst.allowed) return NextResponse.json({ error: 'One scan at a time — try again in a minute.' }, { status: 429 })

  // Daily cap, counted from qscan_scans (every status — a failed scan still fetched pages).
  const agency = await isAgencyUser(userId)
  const cap = agency ? QSCAN_DAILY_SCANS_AGENCY : QSCAN_DAILY_SCANS
  const { count, error: countErr } = await supabaseAdmin
    .from('qscan_scans').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if (countErr) {
    if (isMissingTable(countErr)) {
      console.error('[qscan] qscan_scans missing — run supabase/migration-qscan.sql')
      return NextResponse.json({ error: 'Qscan isn’t set up yet. Please try again later.' }, { status: 503 })
    }
    console.error('[qscan] count failed:', countErr.message)
    return NextResponse.json({ error: 'Could not start the scan. Please try again.' }, { status: 503 })
  }
  if ((count ?? 0) >= cap) {
    return NextResponse.json({ error: `Daily limit reached — ${cap} scans a day. Try again tomorrow.` }, { status: 429 })
  }

  const scanId = randomUUID()
  const { error: insertErr } = await supabaseAdmin
    .from('qscan_scans').insert({ id: scanId, user_id: userId, url: url.toString(), status: 'running' })
  if (insertErr) {
    console.error('[qscan] insert failed:', insertErr.message)
    return NextResponse.json({ error: 'Could not start the scan. Please try again.' }, { status: 503 })
  }

  const fail = async (message: string, status: number) => {
    await supabaseAdmin.from('qscan_scans').update({ status: 'failed', error: message.slice(0, 500) }).eq('id', scanId)
    return NextResponse.json({ error: message }, { status })
  }

  try {
    const scanned = await scanStore(url.toString(), SCAN_BUDGET_MS)
    const { result, report } = await copyScanAssets(userId, scanId, scanned, Date.now() + COPY_BUDGET_MS)
    const brief = buildBrief(result)

    const summary = {
      url: result.url,
      platform: result.platform,
      platformLabel: PLATFORM_LABEL[result.platform],
      brand: result.brand,
      language: result.language,
      currency: result.currency,
      colors: [...result.colors.accents.slice(0, 3), ...result.colors.neutrals.slice(0, 3)],
      fonts: result.fonts,
      pagesScanned: result.pagesScanned,
      products: result.products.length,
      productsPreview: result.products.slice(0, 12).map((p) => ({
        name: p.name, price: p.price, currency: p.currency ?? result.currency, image: p.images[0] ?? null,
      })),
      texts: result.headings.length + result.texts.length,
      images: report.imagesCopied,
      imagesFound: report.imagesFound,
      videos: report.videosCopied,
      videosFound: report.videosFound,
      motion: result.motion,
    }

    await supabaseAdmin
      .from('qscan_scans')
      .update({ status: 'done', platform: result.platform, summary, brief, bytes: report.bytes })
      .eq('id', scanId)

    return NextResponse.json({ scanId, summary, brief, projectName: result.brand.name })
  } catch (err) {
    if (err instanceof ScanError) return fail(err.message, err.status)
    console.error('[qscan] scan failed:', err)
    return fail('The scan failed. Please try again.', 500)
  }
}
