// GET /api/qads/generations/[id] — one generation's full detail: the
// generation row, every qads_item (with signed URLs for completed outputs),
// and every qads_ad_copy row. Called on load and polled every few seconds
// by the /qads results grid while items are still generating.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: generation, error: genErr } = await supabaseAdmin
    .from('qads_generations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (genErr) return NextResponse.json({ error: 'Failed to load generation' }, { status: 500 })
  if (!generation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: items }, { data: copy }] = await Promise.all([
    supabaseAdmin
      .from('qads_items')
      .select('id, kind, format, variant_idx, prompt_used, higgsfield_model, higgsfield_request_id, status, storage_bucket, storage_path, mime_type, error_message, credits_charged, created_at, completed_at')
      .eq('generation_id', id),
    supabaseAdmin
      .from('qads_ad_copy')
      .select('format, variant_idx, language, hook, primary_text, headline, cta, video_script, subtitles')
      .eq('generation_id', id),
  ])

  // Sign a fresh URL for every completed item's output — expires in 1 hour,
  // so the polling client just re-fetches the detail endpoint if it wants a
  // fresh URL later. Failed / in-flight items don't have a storage_path yet.
  const signedItems = await Promise.all((items ?? []).map(async it => {
    let downloadUrl: string | null = null
    if (it.status === 'completed' && it.storage_bucket && it.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from(it.storage_bucket as string)
        .createSignedUrl(it.storage_path as string, 60 * 60)
      downloadUrl = signed?.signedUrl ?? null
    }
    return {
      id: it.id,
      kind: it.kind,
      format: it.format,
      variantIdx: it.variant_idx,
      promptUsed: it.prompt_used,
      higgsfieldModel: it.higgsfield_model,
      higgsfieldRequestId: it.higgsfield_request_id,
      status: it.status,
      mimeType: it.mime_type,
      errorMessage: it.error_message,
      creditsCharged: it.credits_charged,
      createdAt: it.created_at,
      completedAt: it.completed_at,
      downloadUrl,
    }
  }))

  return NextResponse.json({
    generation: {
      id: generation.id,
      productName: generation.product_name,
      productDescription: generation.product_description,
      outputTypes: generation.output_types,
      formats: generation.formats,
      style: generation.style,
      variantsPerFormat: generation.variants_per_format,
      videoDurationSeconds: generation.video_duration_s,
      language: generation.language,
      totalCredits: generation.total_credits_reserved,
      status: generation.status,
      createdAt: generation.created_at,
      completedAt: generation.completed_at,
    },
    items: signedItems,
    adCopy: (copy ?? []).map(c => ({
      format: c.format,
      variantIdx: c.variant_idx,
      language: c.language,
      hook: c.hook,
      primaryText: c.primary_text,
      headline: c.headline,
      cta: c.cta,
      videoScript: c.video_script,
      subtitles: c.subtitles,
    })),
  })
}
