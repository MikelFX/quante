import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import type { ShopManifest } from '@/types/manifest'
import { buildStoreFiles, toStoreSlug } from '@/lib/store-template/build'

const EXPORT_COST = 5
const EXPORT_ADMIN_COST = 10

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { projectId, includeAdmin = false } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const cost = includeAdmin ? EXPORT_ADMIN_COST : EXPORT_COST

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: version } = await supabase
    .from('manifest_versions')
    .select('id, manifest')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return NextResponse.json({ error: 'No manifest found for this project.' }, { status: 404 })

  const { data: ledger } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = ledger?.balance_after ?? 0
  if (balance < cost) {
    return NextResponse.json(
      { error: `Insufficient credits. Need ${cost}, have ${balance}.` },
      { status: 402 }
    )
  }

  const rawManifest = version.manifest as ShopManifest
  const manifest = includeAdmin
    ? ({ ...rawManifest, adminPanel: true } as ShopManifest)
    : rawManifest
  const slug = toStoreSlug(manifest.brand.name) || 'my-store'

  let zipBuffer: Buffer
  try {
    const files = buildStoreFiles(manifest)
    const zip = new JSZip()
    for (const f of files) {
      zip.file(`${slug}/${f.path}`, f.content)
    }
    zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  } catch (err) {
    console.error('Export ZIP build failed:', err)
    return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
  }

  const { data: exportRecord } = await supabase
    .from('exports')
    .insert({ project_id: projectId, version_id: version.id, size_bytes: zipBuffer.byteLength })
    .select('id')
    .single()

  await supabase.from('credit_ledger').insert({
    user_id: userId,
    delta: -cost,
    reason: includeAdmin ? 'export_admin' : 'export',
    ref_id: exportRecord?.id ?? null,
    balance_after: balance - cost,
  })

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Content-Length': String(zipBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
