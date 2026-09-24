import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import type { ShopManifest } from '@/types/manifest'
import { sanitizeManifestForRender } from '@/lib/manifest-schema'
import type { CodeVersionFiles } from '@/types/store-code'
import { buildStoreFiles, toStoreSlug } from '@/lib/store-template/build'
import { isAgencyUser } from '@/lib/tier'
import { scrubBranding, agencyReadme, AGENCY_ENV_EXAMPLE } from '@/lib/export-scrub'
import { CREDIT_COSTS } from '@/lib/config'
import { isUuid } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { hasPaidAdminPanel } from '@/app/api/quante/admin-panel/paid'

const EXPORT_COST = CREDIT_COSTS.export
const MAX_BULK = 20
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agency = await isAgencyUser(userId)

  if (!agency) {
    return NextResponse.json(
      { error: 'Bulk export requires an Agency plan. Export individual projects from the Studio.' },
      { status: 403 },
    )
  }

  let rawIds: unknown
  try { ({ projectIds: rawIds } = await request.json()) }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: 'projectIds required' }, { status: 400 })
  }
  // Only well-formed uuids, de-duplicated (a repeated id must not be exported/charged twice).
  if (!rawIds.every(isUuid)) {
    return NextResponse.json({ error: 'projectIds must be project ids' }, { status: 400 })
  }
  const projectIds = [...new Set(rawIds as string[])]
  if (projectIds.length > MAX_BULK) {
    return NextResponse.json({ error: `Max ${MAX_BULK} projects per bulk export.` }, { status: 400 })
  }

  // Ownership check — only projects belonging to this user are included (service-role
  // client, so this filter is the only thing standing between tenants).
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', projectIds)

  if (!projects || projects.length === 0) {
    return NextResponse.json({ error: 'No matching projects found.' }, { status: 404 })
  }

  const totalCost = EXPORT_COST * projects.length

  // Atomic debit BEFORE building (agency skips it; kept correct in case the Agency
  // gate above is ever relaxed). Refunded if the archive can't be built.
  const creditRef = randomUUID()
  const charged = !agency && totalCost > 0
  if (charged) {
    const debit = await debitCredits(userId, totalCost, 'export', creditRef)
    if (!debit.ok) {
      if (debit.error === 'insufficient_credits') {
        return NextResponse.json(
          { error: `Insufficient credits. Need ${totalCost} (${projects.length} × ${EXPORT_COST}), have ${debit.balance ?? 0}.` },
          { status: 402 }
        )
      }
      if (debit.error === 'billing_hold') {
        return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Failed to debit credits.' }, { status: 500 })
    }
  }

  // Build each project's file tree and nest inside one outer ZIP
  const outerZip = new JSZip()
  const usedSlugs = new Set<string>()
  let zipBuffer: Buffer

  try {
    for (const project of projects as { id: string; name: string }[]) {
      // Unique folder per project so two stores with the same name don't overwrite each other.
      const base = toStoreSlug(project.name) || 'my-store'
      let slug = base
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`
      usedSlugs.add(slug)

      // Code-gen mode first, manifest fallback
      const { data: codeVersion } = await supabaseAdmin
        .from('code_versions')
        .select('files, version_no')
        .eq('project_id', project.id)
        .eq('user_id', userId) // only versions the owner wrote (service-role client)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle()

      try {
        let files = codeVersion
          ? buildStoreFiles(codeVersion.files as CodeVersionFiles)
          : await buildFromManifest(userId, project.id, agency)

        if (!files) continue // no content at all, skip silently

        if (agency) {
          files = scrubBranding(files)
          const readme = { path: 'README.md', content: agencyReadme(project.name), encoding: 'utf-8' as const }
          const envFile = { path: '.env.example', content: AGENCY_ENV_EXAMPLE, encoding: 'utf-8' as const }
          const ri = files.findIndex((f) => f.path === 'README.md')
          const ei = files.findIndex((f) => f.path === '.env.example')
          if (ri >= 0) files[ri] = readme; else files.push(readme)
          if (ei >= 0) files[ei] = envFile; else files.push(envFile)
        }

        for (const f of files) {
          outerZip.file(`${slug}/${f.path}`, f.content)
        }
      } catch (err) {
        console.error(`[bulk-export] failed to build ${project.id}:`, err)
        // Skip broken projects rather than aborting the whole archive
      }
    }

    zipBuffer = await outerZip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  } catch (err) {
    console.error('[bulk-export] archive build failed:', err)
    if (charged) await refundDebit(userId, creditRef, 'export', 'export_refund')
    return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
  }

  // Log export records for all included projects
  await Promise.all(
    (projects as { id: string; name: string }[]).map((p) =>
      supabaseAdmin.from('exports').insert({ project_id: p.id, version_id: null, size_bytes: null })
    )
  )

  const filename = projects.length === 1
    ? `${toStoreSlug(projects[0].name) || 'store'}.zip`
    : `quante-export-${projects.length}-stores.zip`

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

async function buildFromManifest(userId: string, projectId: string, agency: boolean) {
  const { data: version } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return null

  const { data: components } = await supabaseAdmin
    .from('custom_components')
    .select('ref, name, code')
    .eq('project_id', projectId)

  // Admin files: Agency users get them at no charge (same as /api/export), so their
  // stored flag is honoured as before; anyone else only with a server-side recorded
  // purchase — never the client/AI-writable manifest flag.
  const stored = version.manifest as ShopManifest
  const adminPanel = agency ? stored.adminPanel === true : await hasPaidAdminPanel(userId, projectId)
  // Legacy rows may predate the palette/font render-safety rules — re-apply them
  // before the manifest is baked into CSS in the exported store.
  const manifest = sanitizeManifestForRender({ ...stored, adminPanel } as ShopManifest)
  return buildStoreFiles(manifest, components ?? [])
}
