// Server-side record of the paid admin-panel add-on for a project. Server-only.
//
// manifest.adminPanel is NOT trustworthy on its own: /api/manifest/save accepts
// client manifests and the iterate/section routes persist AI output, so the flag can
// be switched on without paying. Anything that unlocks the admin panel for free
// (export, manifest save) must ask this helper instead of reading the manifest.
//
// Payment evidence, in order:
//   1. an 'admin_panel' debit with ref_id = projectId (current /api/quante/admin-panel)
//      that has not been fully refunded ('admin_panel_refund', same ref);
//   2. legacy: an 'admin_panel' debit whose ref_id is the manifest_versions row that
//      the old admin-panel route inserted (prompt 'Admin panel added') for this project.

import { supabaseAdmin } from '@/lib/supabase/admin'

export const ADMIN_PANEL_REASON = 'admin_panel'
export const ADMIN_PANEL_REFUND_REASON = 'admin_panel_refund'

export async function hasPaidAdminPanel(userId: string, projectId: string): Promise<boolean> {
  const { data: rows, error } = await supabaseAdmin
    .from('credit_ledger')
    .select('delta, reason')
    .eq('user_id', userId)
    .eq('ref_id', projectId)
    .in('reason', [ADMIN_PANEL_REASON, ADMIN_PANEL_REFUND_REASON])
  if (error) {
    console.error('[admin-panel/paid] ledger lookup failed:', error.message)
    return false // fail closed — no free admin panel on lookup errors
  }
  let net = 0
  for (const r of rows ?? []) {
    if (r.reason === ADMIN_PANEL_REASON && r.delta < 0) net += -r.delta
    if (r.reason === ADMIN_PANEL_REFUND_REASON && r.delta > 0) net -= r.delta
  }
  if (net > 0) return true

  // Legacy purchases (before 2026-09): ref_id was the new manifest_versions.id.
  const { data: versions } = await supabaseAdmin
    .from('manifest_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('prompt', 'Admin panel added')
  const versionIds = (versions ?? []).map((v) => v.id as string)
  if (versionIds.length === 0) return false

  const { data: legacy } = await supabaseAdmin
    .from('credit_ledger')
    .select('id')
    .eq('user_id', userId)
    .eq('reason', ADMIN_PANEL_REASON)
    .lt('delta', 0)
    .in('ref_id', versionIds)
    .limit(1)
  return (legacy?.length ?? 0) > 0
}
