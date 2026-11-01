// The Qads community library: finished photos and videos from generations whose owner chose to
// share them (qads_generations.share_community, asked on every Generate), newest first, minus
// anything the operator hid (qads_items.community_hidden). Only outputs from the private
// qads-outputs bucket, through short-lived signed URLs — never the uploaded product photos.
// Server-only. Without supabase/migration-qads-community.sql it returns nothing (the wall then
// shows the seed media).
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { WallMedia } from '@/content/qads/community-seed'
import { existingPreviews } from './community-preview'
import { previewPlan, type PreviewRow } from './community-preview-spec'

const LIMIT = 48
const URL_TTL_S = 6 * 3600

const FORMAT_LABEL: Record<string, string> = { '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '16:9': '16:9' }

/** A shared item that has no light preview yet (built after the response, community-preview.ts). */
export type MissingPreview = PreviewRow & { bucket: string; path: string }

export async function communityMedia(): Promise<{ items: WallMedia[]; missing: MissingPreview[] }> {
  const { data, error } = await supabaseAdmin
    .from('qads_items')
    .select('id, kind, format, storage_bucket, storage_path, completed_at, qads_generations!inner(share_community)')
    .eq('status', 'completed')
    .eq('community_hidden', false)
    .eq('qads_generations.share_community', true)
    .not('storage_path', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(LIMIT)
  if (error || !data?.length) {
    if (error) console.warn('[qads/community] list failed (migration-qads-community.sql run?):', error.message)
    return { items: [], missing: [] }
  }

  // The wall shows light previews (community-preview-spec.ts); the original only until one exists.
  const previews = await existingPreviews().catch(() => ({ stills: new Set<string>(), clips: new Set<string>() }))
  const plans = new Map(data.map((row) => [row.id as string, previewPlan({ id: row.id as string, kind: row.kind === 'video' ? 'video' : 'image' }, previews.stills, previews.clips)]))
  const previewPaths = [...plans.values()].flatMap((p) => [p.still, p.clip]).filter((p): p is string => !!p)

  const byBucket = new Map<string, typeof data>()
  for (const row of data) {
    const b = (row.storage_bucket as string | null) ?? 'qads-outputs'
    byBucket.set(b, [...(byBucket.get(b) ?? []), row])
  }
  const urls = new Map<string, string>()
  for (const [bucket, rows] of byBucket) {
    const { data: signed } = await supabaseAdmin.storage.from(bucket).createSignedUrls(rows.map((r) => r.storage_path as string), URL_TTL_S)
    for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(bucket + '/' + s.path, s.signedUrl)
  }
  if (previewPaths.length) {
    const { data: signed } = await supabaseAdmin.storage.from('qads-outputs').createSignedUrls(previewPaths, URL_TTL_S)
    for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set('preview/' + s.path, s.signedUrl)
  }

  const out: WallMedia[] = []
  const missing: MissingPreview[] = []
  for (const row of data) {
    const bucket = (row.storage_bucket as string | null) ?? 'qads-outputs'
    const original = urls.get(bucket + '/' + (row.storage_path as string))
    if (!original) continue
    const kind = row.kind === 'video' ? 'video' : 'image'
    const plan = plans.get(row.id as string)
    const still = plan?.still ? urls.get('preview/' + plan.still) : undefined
    const clip = plan?.clip ? urls.get('preview/' + plan.clip) : undefined
    if (plan?.missing) missing.push({ id: row.id as string, kind, bucket, path: row.storage_path as string })
    out.push({
      id: row.id as string,
      kind,
      src: kind === 'video' ? (clip ?? original) : (still ?? original),
      ...(kind === 'video' && still ? { poster: still } : {}),
      label: `Community ${kind === 'video' ? 'video' : 'photo'} · ${FORMAT_LABEL[row.format as string] ?? row.format}`,
    })
  }
  return { items: out, missing }
}

/** True when a Postgres / PostgREST error is about the community columns not existing yet. */
export function isMissingCommunityColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /share_community|community_hidden/.test(error.message ?? '')
}
