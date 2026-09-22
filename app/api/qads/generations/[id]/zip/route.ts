// GET /api/qads/generations/[id]/zip — bundle every completed asset in a
// generation as a single ZIP the user can download. Uses jszip (already in
// package.json for the storefront export flow) to avoid pulling a second
// archiver library. Streams the ZIP as an octet-stream response.
//
// Naming convention inside the ZIP: `{format}-{variant}.{ext}`, e.g.
// `9x16-1.mp4`. Ad copy for the generation is included as `ad-copy.json`.

import { auth } from '@clerk/nextjs/server'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 60

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: generation } = await supabaseAdmin.from('qads_generations').select('id, product_name').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!generation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: items }, { data: copy }] = await Promise.all([
    supabaseAdmin.from('qads_items').select('kind, format, variant_idx, storage_bucket, storage_path, mime_type').eq('generation_id', id).eq('status', 'completed'),
    supabaseAdmin.from('qads_ad_copy').select('format, variant_idx, language, hook, primary_text, headline, cta, video_script, subtitles').eq('generation_id', id),
  ])
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'No completed items to download yet' }, { status: 404 })
  }

  const zip = new JSZip()
  await Promise.all(items.map(async it => {
    if (!it.storage_bucket || !it.storage_path) return
    const { data: fileData, error } = await supabaseAdmin.storage.from(it.storage_bucket as string).download(it.storage_path as string)
    if (error || !fileData) return
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const ext = extensionFor(it.mime_type as string | null, it.kind as string)
    const formatSafe = (it.format as string).replace(':', 'x')
    const filename = `${it.kind}/${formatSafe}-${((it.variant_idx as number) ?? 0) + 1}.${ext}`
    zip.file(filename, buffer)
  }))

  if (copy && copy.length) {
    zip.file('ad-copy.json', JSON.stringify(copy, null, 2))
  }

  const zipBytes = await zip.generateAsync({ type: 'nodebuffer' })
  const filename = `${slugify(generation.product_name as string)}-qads.zip`
  return new NextResponse(new Uint8Array(zipBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBytes.length),
      'Cache-Control': 'no-store',
    },
  })
}

function extensionFor(mime: string | null, kind: string): string {
  if (mime) {
    const sub = mime.split('/')[1]?.split(';')[0]?.toLowerCase()
    if (sub) return sub.replace('jpeg', 'jpg')
  }
  return kind === 'video' ? 'mp4' : 'jpg'
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50) || 'generation'
}
