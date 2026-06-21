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
const EXPORT_ADMIN_COST = CREDIT_COSTS.export_admin

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const agency = await isAgencyUser(userId)

  const { projectId, includeAdmin = false } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const cost = includeAdmin ? EXPORT_ADMIN_COST : EXPORT_COST

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

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
    if (balance < cost) {
      return NextResponse.json(
        { error: `Insufficient credits. Need ${cost}, have ${balance}.` },
        { status: 402 }
      )
    }
  }

  let zipBuffer: Buffer
  let slug: string

  // ── Code-gen mode (modern): reads from code_versions ─────────────────────
  const { data: codeVersion } = await supabase
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (codeVersion) {
    slug = toStoreSlug(project.name) || 'my-store'
    const codeFiles = codeVersion.files as CodeVersionFiles

    try {
      let files = buildStoreFiles(codeFiles)

      if (agency) {
        files = scrubBranding(files)
        // Inject generic README + .env.example (overwrite any existing ones)
        const readmeIdx = files.findIndex((f) => f.path === 'README.md')
        const readme = { path: 'README.md', content: agencyReadme(project.name), encoding: 'utf-8' as const }
        if (readmeIdx >= 0) files[readmeIdx] = readme
        else files.push(readme)

        const envIdx = files.findIndex((f) => f.path === '.env.example')
        const envExample = { path: '.env.example', content: AGENCY_ENV_EXAMPLE, encoding: 'utf-8' as const }
        if (envIdx >= 0) files[envIdx] = envExample
        else files.push(envExample)
      }

      const zip = new JSZip()
      for (const f of files) {
        zip.file(`${slug}/${f.path}`, f.content)
      }
      zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    } catch (err) {
      console.error('Export ZIP build failed (code-gen mode):', err)
      return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
    }

    // Record export + debit (agency skips debit)
    const { data: exportRecord } = await supabase
      .from('exports')
      .insert({ project_id: projectId, version_id: codeVersion.id, size_bytes: zipBuffer.byteLength })
      .select('id')
      .single()

    if (!agency) {
      await supabase.from('credit_ledger').insert({
        user_id: userId,
        delta: -cost,
        reason: includeAdmin ? 'export_admin' : 'export',
        ref_id: exportRecord?.id ?? null,
        balance_after: balance - cost,
      })
    }

  // ── Legacy manifest mode: reads from manifest_versions ──────────────────
  } else {
    const { data: version } = await supabase
      .from('manifest_versions')
      .select('id, manifest')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!version) return NextResponse.json({ error: 'No generated content found for this project.' }, { status: 404 })

    const rawManifest = version.manifest as ShopManifest
    const manifest = includeAdmin ? ({ ...rawManifest, adminPanel: true } as ShopManifest) : rawManifest
    slug = toStoreSlug(manifest.brand.name) || 'my-store'

    const { data: customComponents } = await supabaseAdmin
      .from('custom_components')
      .select('ref, name, code')
      .eq('project_id', projectId)

    try {
      let files = buildStoreFiles(manifest, customComponents ?? [])

      if (agency) {
        files = scrubBranding(files)
        const readme = { path: 'README.md', content: agencyReadme(manifest.brand.name), encoding: 'utf-8' as const }
        const envExample = { path: '.env.example', content: AGENCY_ENV_EXAMPLE, encoding: 'utf-8' as const }
        const readmeIdx = files.findIndex((f) => f.path === 'README.md')
        if (readmeIdx >= 0) files[readmeIdx] = readme
        else files.push(readme)
        const envIdx = files.findIndex((f) => f.path === '.env.example')
        if (envIdx >= 0) files[envIdx] = envExample
        else files.push(envExample)
      }

      const zip = new JSZip()
      for (const f of files) {
        zip.file(`${slug}/${f.path}`, f.content)
      }
      zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    } catch (err) {
      console.error('Export ZIP build failed (manifest mode):', err)
      return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
    }

    const { data: exportRecord } = await supabase
      .from('exports')
      .insert({ project_id: projectId, version_id: version.id, size_bytes: zipBuffer.byteLength })
      .select('id')
      .single()

    if (!agency) {
      await supabase.from('credit_ledger').insert({
        user_id: userId,
        delta: -cost,
        reason: includeAdmin ? 'export_admin' : 'export',
        ref_id: exportRecord?.id ?? null,
        balance_after: balance - cost,
      })
    }
  }

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Content-Length': String(zipBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
