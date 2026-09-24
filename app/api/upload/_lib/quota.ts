// DB-backed per-user daily upload quota shared by /api/upload (store-assets, public)
// and /api/qads/upload (qads-inputs, private). Server-only.
//
// SECURITY (audit F6/F11): the in-memory rateLimit() is per serverless instance, so it
// can't bound how much one account stores in Quante's Supabase buckets. Every upload now
// reserves a row in upload_events (supabase/migration-security4-misc.sql) BEFORE the
// file is written, then counts this user's rows for the bucket in the last 24h
// INCLUDING its own: the k-th concurrent insert always sees >= k rows, so at most
// `maxFiles` uploads (and `maxBytes` bytes) get through per rolling day. A refused or
// failed upload deletes its own row (rows of uploads that went through are never
// deleted, so the bound holds).
//
// Until the migration has run, the quota falls back to counting the objects already in
// storage under `fallbackPrefix` and its sub-folders (bounded per user per day, but NOT
// race-safe: concurrent uploads all see the same count). Run the migration.

import { supabaseAdmin } from '@/lib/supabase/admin'

const DAY_MS = 24 * 60 * 60 * 1000

export interface UploadQuota {
  maxFiles: number
  maxBytes: number
}

export type QuotaReservation =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; status: 429 | 503; error: string }

// 42P01 = undefined_table (Postgres); PGRST205 = table not in PostgREST's schema cache.
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

const noop = async () => {}

function refusal(quota: UploadQuota): QuotaReservation {
  return {
    ok: false,
    status: 429,
    error: `Daily upload limit reached (max ${quota.maxFiles} files / ${Math.round(quota.maxBytes / 1024 / 1024)} MB per day). Try again tomorrow.`,
  }
}

const UNAVAILABLE: QuotaReservation = {
  ok: false,
  status: 503,
  error: 'Uploads are temporarily unavailable. Please try again.',
}

// Fallback scan limits. One list call returns at most LIST_LIMIT entries, newest first.
// The daily file caps are far below that, so a truncated page can only hide objects
// when the newest LIST_LIMIT alone are already over the cap (still refused).
const LIST_LIMIT = 1000
// Max sub-folders (e.g. per-project dirs) scanned under the user's prefix.
const MAX_FALLBACK_FOLDERS = 200
const FOLDER_SCAN_CONCURRENCY = 10

type StorageEntry = { id: string | null; name: string; created_at?: string | null; metadata?: unknown }

/**
 * Fallback while upload_events does not exist: count today's objects under the user's
 * prefix, INCLUDING every sub-folder one level down (store-assets keeps one folder per
 * project, so counting a single project folder would let the cap reset per project).
 */
async function checkStorageFallback(
  bucket: string,
  prefix: string,
  bytes: number,
  quota: UploadQuota,
): Promise<QuotaReservation> {
  const list = (path: string) => supabaseAdmin.storage
    .from(bucket)
    .list(path, { limit: LIST_LIMIT, sortBy: { column: 'created_at', order: 'desc' } })

  const root = await list(prefix)
  if (root.error) {
    console.error('[upload-quota] storage fallback list failed:', root.error.message)
    return UNAVAILABLE
  }
  const rootEntries = (root.data ?? []) as StorageEntry[]
  // Folders come back with id null and no metadata.
  const folders = rootEntries.filter((e) => !e.id).map((e) => `${prefix}/${e.name}`)
  if (folders.length > MAX_FALLBACK_FOLDERS) {
    console.error('[upload-quota] too many folders for the storage fallback — run supabase/migration-security4-misc.sql')
    return UNAVAILABLE
  }

  const entries: StorageEntry[] = rootEntries.filter((e) => e.id)
  for (let i = 0; i < folders.length; i += FOLDER_SCAN_CONCURRENCY) {
    const results = await Promise.all(folders.slice(i, i + FOLDER_SCAN_CONCURRENCY).map(list))
    for (const r of results) {
      if (r.error) {
        console.error('[upload-quota] storage fallback folder list failed:', r.error.message)
        return UNAVAILABLE
      }
      const data = (r.data ?? []) as StorageEntry[]
      entries.push(...data.filter((e) => e.id))
    }
  }

  const since = Date.now() - DAY_MS
  let files = 0
  let total = 0
  for (const obj of entries) {
    const created = obj.created_at ? Date.parse(obj.created_at) : NaN
    if (!Number.isFinite(created) || created < since) continue
    files++
    const size = Number((obj.metadata as { size?: unknown } | null)?.size ?? 0)
    total += Number.isFinite(size) ? size : 0
  }
  if (files + 1 > quota.maxFiles || total + bytes > quota.maxBytes) return refusal(quota)
  return { ok: true, release: noop }
}

/**
 * Reserves one upload of `bytes` for `userId` in `bucket`. Call BEFORE writing to
 * storage; call `release()` if the upload then fails. Fails closed (503) on DB errors.
 */
export async function reserveUpload(
  userId: string,
  bucket: string,
  bytes: number,
  quota: UploadQuota,
  fallbackPrefix: string,
): Promise<QuotaReservation> {
  const { data: row, error: insertErr } = await supabaseAdmin
    .from('upload_events')
    .insert({ user_id: userId, bucket, bytes })
    .select('id')
    .single()

  if (insertErr || !row) {
    if (isMissingTable(insertErr)) {
      console.warn('[upload-quota] upload_events missing — run supabase/migration-security4-misc.sql')
      return checkStorageFallback(bucket, fallbackPrefix, bytes, quota)
    }
    console.error('[upload-quota] reservation insert failed:', insertErr?.message)
    return UNAVAILABLE
  }

  const id = (row as { id: string }).id
  const release = async () => {
    const { error } = await supabaseAdmin.from('upload_events').delete().eq('id', id)
    if (error) console.error('[upload-quota] release failed:', error.message)
  }

  // Our own row is included. Fetch one more than the file cap: past that we refuse
  // anyway, and below it every row is here so the byte sum is exact.
  const { data: rows, count, error: countErr } = await supabaseAdmin
    .from('upload_events')
    .select('bytes', { count: 'exact' })
    .eq('user_id', userId)
    .eq('bucket', bucket)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
    .limit(quota.maxFiles + 1)
  if (countErr) {
    console.error('[upload-quota] count failed:', countErr.message)
    await release()
    return UNAVAILABLE
  }
  const totalBytes = (rows ?? []).reduce(
    (sum, r) => sum + (Number((r as { bytes: unknown }).bytes) || 0),
    0,
  )
  if ((count ?? 0) > quota.maxFiles || totalBytes > quota.maxBytes) {
    await release()
    return refusal(quota)
  }
  return { ok: true, release }
}
