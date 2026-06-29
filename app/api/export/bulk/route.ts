import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import type { ShopManifest } from '@/types/manifest'
import type { CodeVersionFiles } from '@/types/store-code'
import { buildStoreFiles, toStoreSlug } from '@/lib/store-template/build'
import { isAgencyUser } from '@/lib/tier'
import { scrubBranding, agencyReadme, AGENCY_ENV_EXAMPLE } from '@/lib/export-scrub'
import { CREDIT_COSTS } from '@/lib/config'

const EXPORT_COST = CREDIT_COSTS.export
const MAX_BULK = 20

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const agency = await isAgencyUser(userId)

  if (!agency) {
    return NextResponse.json(
      { error: 'Bulk export requires an Agency plan. Export individual projects from the Studio.' },
      { status: 403 },
    )
  }

  const { projectIds } = await request.json() as { projectIds: string[] }
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return NextResponse.json({ error: 'projectIds required' }, { status: 400 })
  }
  if (projectIds.length > MAX_BULK) {
    return NextResponse.json({ error: `Max ${MAX_BULK} projects per bulk export.` }, { status: 400 })
  }

  // Ownership check — only include projects belonging to this user
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', projectIds)

  if (!projects || projects.length === 0) {
    return NextResponse.json({ error: 'No matching projects found.' }, { status: 404 })
  }

  const totalCost = EXPORT_COST * projects.length

  // Credits check (skip for agency)
  let balance = 0
  if (!agency) {
    const { data: ledger } = await supabase
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    balance = ledger?.balance_after ?? 0
    if (balance < totalCost) {
      return NextResponse.json(
        { error: `Insufficient credits. Need ${totalCost} (${projects.length} × ${EXPORT_COST}), have ${balance}.` },
        { status: 402 }
      )
    }
  }

  // Build each project's file tree and nest inside one outer ZIP
  const outerZip = new JSZip()

  for (const project of projects as { id: string; name: string }[]) {
    const slug = toStoreSlug(project.name) || 'my-store'

    // Code-gen mode first, manifest fallback
    const { data: codeVersion } = await supabase
      .from('code_versions')
      .select('files, version_no')
      .eq('project_id', project.id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    try {
      let files = codeVersion
        ? buildStoreFiles(codeVersion.files as CodeVersionFiles)
        : await buildFromManifest(project.id)

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

  const zipBuffer = await outerZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  // Record exports + debit (agency skips debit)
  if (!agency) {
    // Debit once for the whole batch; ledger entry references the first project
    const newBalance = balance - totalCost
    await supabase.from('credit_ledger').insert({
      user_id: userId,
      delta: -totalCost,
      reason: 'export',
      ref_id: null,
      balance_after: newBalance,
    })
  }

  // Log export records for all included projects
  await Promise.all(
    (projects as { id: string; name: string }[]).map((p) =>
      supabase.from('exports').insert({ project_id: p.id, version_id: null, size_bytes: null })
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

async function buildFromManifest(projectId: string) {
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

  return buildStoreFiles(version.manifest as ShopManifest, components ?? [])
}
