// Persists the `ads` (ad copy) portion of a strategy.ts generation result into qads_ads.
// Resolves each ad's `adSetName` against the rows adsets.ts just inserted. Ads are
// created with creative_id = null and approval_status = 'pending' — image/video
// generation (Qads steps c/d) fills in creative_id later; nothing here touches media.

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { StrategyOutput } from '../../claude/prompts'
import type { PersistedAdSet } from './adsets'

export async function persistAds(params: {
  ads: StrategyOutput['ads']
  adSets: PersistedAdSet[]
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { ads, adSets } = params
  const adSetIdByName = new Map(adSets.map((s) => [s.name, s.id]))

  const rows: Array<Record<string, unknown>> = []
  const skipped: string[] = []

  for (const ad of ads) {
    const adSetId = adSetIdByName.get(ad.adSetName)
    if (!adSetId) {
      // Same resolution-miss handling as adsets.ts — an ad referencing an ad set that got
      // skipped upstream (unresolved angleLabel) or that the model misnamed. Dropped, not
      // fatal to the campaign.
      skipped.push(ad.adSetName)
      continue
    }
    rows.push({
      ad_set_id: adSetId,
      format: ad.format,
      texts: ad.texts,
      approval_status: 'pending',
    })
  }

  if (skipped.length) {
    console.warn(`[qads/copy] skipped ${skipped.length} ad(s) with unresolved adSetName: ${skipped.join(', ')}`)
  }
  if (!rows.length) return { ok: false, error: 'no_valid_ads' }

  const { error } = await supabaseAdmin.from('qads_ads').insert(rows)
  if (error) return { ok: false, error: error.message }

  return { ok: true, count: rows.length }
}
