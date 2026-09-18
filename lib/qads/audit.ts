// Shared qads_audit_log writer. "Every budget change, activate/pause, kill-switch
// trigger, and experiment-winner application writes a qads_audit_log row with
// before/after JSON — no exceptions" (docs/qads-proposal.md §7). Factored out of
// lib/qads/deploy/execute-deploy.ts so step (g)'s activate/pause/budget/kill-switch
// routes share one implementation instead of copy-pasting the insert.

import { supabaseAdmin } from '@/lib/supabase/admin'

export type QadsAuditAction = 'budget_change' | 'activate' | 'pause' | 'kill_switch' | 'deploy' | 'experiment_apply'

export async function writeQadsAuditLog(params: {
  userId: string
  campaignId: string | null
  action: QadsAuditAction | string
  entityType?: string
  entityId?: string
  beforeJson?: unknown
  afterJson?: unknown
}): Promise<void> {
  const { error } = await supabaseAdmin.from('qads_audit_log').insert({
    user_id: params.userId,
    campaign_id: params.campaignId,
    action: params.action,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    before_json: params.beforeJson ?? null,
    after_json: params.afterJson ?? null,
  })
  // Best-effort — a failed audit write must never block or roll back the actual action
  // it's describing (same posture as every other non-critical secondary write in this
  // codebase, e.g. the OAuth callback route's last_error update).
  if (error) console.error('[qads/audit] write failed:', error.message)
}
