// Maps a Qads campaign goal to a channel-native objective string. Best-effort, same
// open-item posture as every other exact-enum-string question in this module (see
// docs/qads-proposal.md §9 and the CONFIRMED/OPEN note in lib/qads/channels/types.ts) —
// Meta migrated its objective enum before (legacy CONVERSIONS-style values -> OUTCOME_*)
// and TikTok's objective_type enum has similar churn risk, so this table is what a
// reasonable default looks like today, not a value fetched from a live account. Flagged
// here rather than buried in build-payloads.ts so it's the one place to revisit once a
// human can confirm against a live sandbox ad account.

import type { CampaignGoal, QadsChannel } from '../types'

const META_OBJECTIVE: Record<CampaignGoal, string> = {
  launch: 'OUTCOME_TRAFFIC',
  sale: 'OUTCOME_SALES',
  black_friday: 'OUTCOME_SALES',
  awareness: 'OUTCOME_AWARENESS',
  custom: 'OUTCOME_TRAFFIC',
}

const TIKTOK_OBJECTIVE: Record<CampaignGoal, string> = {
  launch: 'TRAFFIC',
  sale: 'PRODUCT_SALES',
  black_friday: 'PRODUCT_SALES',
  awareness: 'REACH',
  custom: 'TRAFFIC',
}

export function objectiveForGoal(channel: QadsChannel, goal: CampaignGoal): string {
  return channel === 'meta' ? META_OBJECTIVE[goal] : TIKTOK_OBJECTIVE[goal]
}
