// Brand kit storage — server only. Table brand_kits (supabase/migration-brand-kit.sql), one row
// per project, service role only. Every read and write is filtered by user_id AND project_id;
// callers check project ownership first. Without the migration the kit reads as empty and a save
// answers `missing` (the UI says the feature is not set up) — nothing else breaks.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { EMPTY_KIT, kitFromRow, kitToRow, storeAssetsBase, type BrandKit } from '@/lib/brand-kit/model'

export const BRAND_KITS_TABLE = 'brand_kits'

export function assetsBase(): string {
  return storeAssetsBase(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321')
}

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === '42P01' || err.code === 'PGRST205' || /brand_kits/.test(err.message ?? ''))
}

export type KitRead = { kit: BrandKit; exists: boolean; ready: boolean }

export async function getBrandKit(projectId: string, userId: string): Promise<KitRead> {
  const { data, error } = await supabaseAdmin
    .from(BRAND_KITS_TABLE)
    .select('logo_url, photos, texts')
    .eq('project_id', projectId).eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[brand-kit] read failed:', error.message)
    return { kit: EMPTY_KIT, exists: false, ready: !isMissingTable(error) }
  }
  return { kit: kitFromRow(data, userId, assetsBase()), exists: !!data, ready: true }
}

/** Kits of several owned projects at once (the Dashboard's current page). ready = false while the
 *  table is missing. Projects without a row have no entry. */
export async function getBrandKits(projectIds: string[], userId: string): Promise<{ kits: Map<string, BrandKit>; ready: boolean }> {
  const kits = new Map<string, BrandKit>()
  if (projectIds.length === 0) return { kits, ready: true }
  const { data, error } = await supabaseAdmin
    .from(BRAND_KITS_TABLE)
    .select('project_id, logo_url, photos, texts')
    .eq('user_id', userId).in('project_id', projectIds)
  if (error) return { kits, ready: !isMissingTable(error) }
  const base = assetsBase()
  for (const row of (data ?? []) as Array<{ project_id: string; logo_url: unknown; photos: unknown; texts: unknown }>) {
    kits.set(row.project_id, kitFromRow(row, userId, base))
  }
  return { kits, ready: true }
}

export type KitSave = { ok: true } | { ok: false; missing: boolean }

export async function saveBrandKit(projectId: string, userId: string, kit: BrandKit): Promise<KitSave> {
  const { error } = await supabaseAdmin
    .from(BRAND_KITS_TABLE)
    .upsert({ project_id: projectId, user_id: userId, ...kitToRow(kit), updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
  if (error) {
    if (!isMissingTable(error)) console.error('[brand-kit] save failed:', error.message)
    return { ok: false, missing: isMissingTable(error) }
  }
  return { ok: true }
}
