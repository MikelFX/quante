// Hard spend caps, checked before any budget create/update call reaches a channel — a
// request exceeding a cap is rejected before it's even built into a payload
// (docs/qads-proposal.md §7). Two independent caps: a per-campaign ceiling and a
// per-user ceiling across everything the user has live at once. Both are env-configured
// and OFF (no cap enforced) when unset, so a fresh deployment doesn't accidentally block
// all activation with a default of zero — same "explicit opt-in, no silent surprise
// limit" posture as every other env-gated behavior in this module.

import { supabaseAdmin } from '@/lib/supabase/admin'

function envCapMinor(name: string): number | null {
  const raw = process.env[name]
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Meta/TikTok budgets are either 'daily' or 'lifetime' — caps are expressed as a daily
// spend rate, so a lifetime budget is normalized to lifetimeBudgetMinor / durationDays.
// durationDays defaults to 1 (treat as "all in one day") if genuinely unknown, which is
// the more conservative (larger daily-equivalent) assumption — never the one that lets
// more spend slip under a cap unnoticed.
export function dailyEquivalentMinor(budgetMinor: number, budgetType: 'daily' | 'lifetime', durationDays: number): number {
  if (budgetType === 'daily') return budgetMinor
  const days = Math.max(1, durationDays || 1)
  return Math.ceil(budgetMinor / days)
}

export interface GuardrailCheckResult {
  ok: boolean
  error?: string
  perCampaignCapMinor?: number
  perCampaignDailyMinor?: number
  perUserCapMinor?: number
  perUserDailyMinor?: number
}

// campaignDailyMinorAfterChange: the campaign's total daily-equivalent spend rate INCLUDING
// the change being requested (caller computes this — the guardrail doesn't know which ad
// sets are being activated/changed, only whether the resulting total is within cap).
export async function checkBudgetGuardrails(params: {
  userId: string
  campaignId: string
  campaignDailyMinorAfterChange: number
}): Promise<GuardrailCheckResult> {
  const { userId, campaignId, campaignDailyMinorAfterChange } = params

  const perCampaignCapMinor = envCapMinor('QADS_MAX_DAILY_SPEND_PER_CAMPAIGN_MINOR')
  const perUserCapMinor = envCapMinor('QADS_MAX_DAILY_SPEND_PER_USER_MINOR')

  if (perCampaignCapMinor && campaignDailyMinorAfterChange > perCampaignCapMinor) {
    return {
      ok: false,
      error: `This would bring the campaign's daily spend rate to ${campaignDailyMinorAfterChange} (minor units), above the per-campaign cap of ${perCampaignCapMinor}`,
      perCampaignCapMinor,
      perCampaignDailyMinor: campaignDailyMinorAfterChange,
    }
  }

  if (perUserCapMinor) {
    const otherCampaignsDailyMinor = await sumActiveDailyMinorForUser(userId, campaignId)
    const totalAfterChange = otherCampaignsDailyMinor + campaignDailyMinorAfterChange
    if (totalAfterChange > perUserCapMinor) {
      return {
        ok: false,
        error: `This would bring the account's total daily spend rate across all active campaigns to ${totalAfterChange} (minor units), above the per-user cap of ${perUserCapMinor}`,
        perUserCapMinor,
        perUserDailyMinor: totalAfterChange,
      }
    }
  }

  return { ok: true, perCampaignCapMinor: perCampaignCapMinor ?? undefined, perUserCapMinor: perUserCapMinor ?? undefined }
}

// Sums the daily-equivalent budget of every ad set belonging to the user's OTHER
// currently-active campaigns (status = 'active') — deliberately excludes the campaign
// being changed, since the caller already folds that campaign's post-change total into
// campaignDailyMinorAfterChange.
async function sumActiveDailyMinorForUser(userId: string, excludeCampaignId: string): Promise<number> {
  const { data: activeCampaigns } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, duration_days')
    .eq('user_id', userId)
    .eq('status', 'active')
    .neq('id', excludeCampaignId)

  if (!activeCampaigns?.length) return 0

  const durationByCampaign = new Map(activeCampaigns.map((c) => [c.id as string, c.duration_days as number]))
  const { data: adSets } = await supabaseAdmin
    .from('qads_ad_sets')
    .select('campaign_id, budget_minor, budget_type')
    .in('campaign_id', [...durationByCampaign.keys()])
    .eq('status', 'active')

  return (adSets ?? []).reduce((sum, row) => {
    const durationDays = durationByCampaign.get(row.campaign_id as string) ?? 1
    return sum + dailyEquivalentMinor(row.budget_minor as number, row.budget_type as 'daily' | 'lifetime', durationDays)
  }, 0)
}
