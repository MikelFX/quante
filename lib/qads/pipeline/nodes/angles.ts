// Persists the `angles` portion of a strategy.ts generation result into qads_angles.
// Deterministic — no Claude call here. Kept as its own file/function (rather than inlined
// into runner.ts) so a future finer-grained regenerate (e.g. re-deriving just angles from
// an already-generated strategy) has a clean seam to hang off, per
// POST /api/qads/campaigns/[id]/regenerate in docs/qads-proposal.md — that per-node
// re-generation is a Phase 2 refinement; this pass only calls Claude once per campaign
// (see strategy.ts) and this function purely writes its rows.

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { StrategyOutput } from '../../claude/prompts'

export interface PersistedAngle {
  label: string
  id: string
}

export async function persistAngles(
  campaignId: string,
  angles: StrategyOutput['angles'],
): Promise<{ ok: true; angles: PersistedAngle[] } | { ok: false; error: string }> {
  const rows = angles.map((a, i) => ({
    campaign_id: campaignId,
    label: a.label,
    hypothesis: a.hypothesis,
    sort_order: i,
  }))

  const { data, error } = await supabaseAdmin.from('qads_angles').insert(rows).select('id, label')
  if (error) return { ok: false, error: error.message }

  return { ok: true, angles: (data ?? []).map((r) => ({ id: r.id as string, label: r.label as string })) }
}
