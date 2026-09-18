// Persists the `adSets` portion of a strategy.ts generation result into qads_ad_sets.
// Resolves each ad set's `angleLabel` string (the model doesn't know DB ids) against the
// angle rows angles.ts just inserted, and converts the model's `budgetSharePct` into an
// actual budget_minor by splitting the campaign's already-fixed total budget — the model
// never invents an absolute budget number, only proposes relative weighting (see
// lib/qads/claude/prompts.ts STRATEGY_SYSTEM_PROMPT).

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { StrategyOutput } from '../../claude/prompts'
import type { PersistedAngle } from './angles'

export interface PersistedAdSet {
  name: string
  id: string
}

export async function persistAdSets(params: {
  campaignId: string
  adSets: StrategyOutput['adSets']
  angles: PersistedAngle[]
  totalBudgetMinor: number
}): Promise<{ ok: true; adSets: PersistedAdSet[] } | { ok: false; error: string }> {
  const { campaignId, adSets, angles, totalBudgetMinor } = params
  const angleIdByLabel = new Map(angles.map((a) => [a.label, a.id]))

  const rows: Array<Record<string, unknown>> = []
  const skipped: string[] = []

  for (const set of adSets) {
    const angleId = angleIdByLabel.get(set.angleLabel)
    if (!angleId) {
      // Model referenced an angle label it didn't actually define in this same response —
      // rare given the schema forces angles[] and adSets[] into the same call, but not
      // impossible. Skip the ad set rather than fail the whole campaign; surfaced via the
      // `skipped` list so the caller can log/flag it instead of silently losing plan
      // coverage without a trace.
      skipped.push(set.name)
      continue
    }
    rows.push({
      campaign_id: campaignId,
      angle_id: angleId,
      channel: set.channel,
      name: set.name,
      audience: set.audience,
      placements: set.placements,
      budget_minor: Math.round(totalBudgetMinor * (set.budgetSharePct / 100)),
      budget_type: set.budgetType,
      status: 'draft',
    })
  }

  if (skipped.length) {
    console.warn(`[qads/adsets] skipped ${skipped.length} ad set(s) with unresolved angleLabel: ${skipped.join(', ')}`)
  }
  if (!rows.length) return { ok: false, error: 'no_valid_ad_sets' }

  const { data, error } = await supabaseAdmin.from('qads_ad_sets').insert(rows).select('id, name')
  if (error) return { ok: false, error: error.message }

  return { ok: true, adSets: (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })) }
}
