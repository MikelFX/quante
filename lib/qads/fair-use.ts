// Qads on the Agency plan: no credits, a daily fair-use cap instead (AGENCY_FAIR_USE in
// lib/config.ts). Server-only.
//
// Agency renders debit nothing, so the credit ledger can't count them. Each render (a new item
// or a regenerated one) is logged in quante_request_attempts (route 'qads_video' / 'qads_image',
// ref_id = the generation) BEFORE the provider is called; then the last 24 h are counted,
// including our own rows — the k-th concurrent insert always sees >= k rows, so the cap holds
// under races. Over the cap our rows are removed again. Fails closed: no log, no free render.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { AGENCY_FAIR_USE } from '@/lib/config'

const DAY_MS = 86_400_000

export type AgencyRenderResult =
  | { ok: true }
  | { ok: false; error: 'fair_use' | 'unavailable'; message: string }

export const AGENCY_QADS_FAIR_USE_MESSAGE =
  `Fair-use limit reached — the Agency plan includes ${AGENCY_FAIR_USE.qadsVideosPerDay} Qads videos and ${AGENCY_FAIR_USE.qadsPhotosPerDay} photos a day. Try again later.`

export async function reserveAgencyRenders(userId: string, generationId: string, videos: number, images: number): Promise<AgencyRenderResult> {
  const rows = [
    ...Array.from({ length: videos }, () => ({ user_id: userId, route: 'qads_video', ref_id: generationId })),
    ...Array.from({ length: images }, () => ({ user_id: userId, route: 'qads_image', ref_id: generationId })),
  ]
  if (!rows.length) return { ok: true }
  const unavailable = { ok: false as const, error: 'unavailable' as const, message: 'Could not start the generation right now. Please try again.' }

  const { data: inserted, error } = await supabaseAdmin.from('quante_request_attempts').insert(rows).select('id')
  if (error || !inserted) {
    console.error('[qads/fair-use] attempt log insert failed:', error?.message)
    return unavailable
  }
  const ids = inserted.map((r) => r.id as string)

  const since = new Date(Date.now() - DAY_MS).toISOString()
  const count = async (route: string) => {
    const { count: n, error: e } = await supabaseAdmin
      .from('quante_request_attempts').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('route', route).gte('created_at', since)
    return e ? null : (n ?? 0)
  }
  const [v, i] = await Promise.all([count('qads_video'), count('qads_image')])
  const over = v === null || i === null || v > AGENCY_FAIR_USE.qadsVideosPerDay || i > AGENCY_FAIR_USE.qadsPhotosPerDay
  if (!over) return { ok: true }

  await releaseAgencyRenders(ids)
  if (v === null || i === null) return unavailable
  return { ok: false, error: 'fair_use', message: AGENCY_QADS_FAIR_USE_MESSAGE }
}

/** Removes logged renders — only for requests that were refused before anything was rendered. */
async function releaseAgencyRenders(ids: string[]) {
  const { error } = await supabaseAdmin.from('quante_request_attempts').delete().in('id', ids)
  if (error) console.error('[qads/fair-use] release failed:', error.message)
}
