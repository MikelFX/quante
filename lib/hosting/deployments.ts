// Single writer for new `deployments` rows. Server-only.
//
// Every code path that records a Vercel deployment goes through insertDeploymentRow so
// each row carries what the build is (`target`) and which platform scaffold it was built
// with (`scaffold_version`, see SCAFFOLD_VERSION in lib/store-template/build.ts). The
// scaffold rollout (lib/hosting/scaffold-rollout.ts) relies on both.
//
// Backwards compatible: until supabase/migration-scaffold-version.sql has run, the new
// columns (target, scaffold_version, rollout_trigger) do not exist and PostgREST rejects the insert (42703 undefined_column /
// PGRST204 column not in schema cache) — the row is then re-inserted without them, so
// no deploy path breaks before the migration.

import { supabaseAdmin } from '@/lib/supabase/admin'

export type DeploymentTarget = 'production' | 'preview' | 'maintenance' | 'staged'

export interface DeploymentRowInput {
  project_id: string
  user_id: string
  vercel_project_id: string
  vercel_deployment_id: string
  status: string
  url: string | null
  domain: string | null
  version?: number | null
  version_id?: string | null
  code_version_id?: string | null
  /**
   * 'production' for every production-target build that serves the store's domains,
   * 'staged' for draft builds (production target, domains not assigned — see
   * createStagedDeployment), 'preview' for true previews.
   */
  target: DeploymentTarget
  /** SCAFFOLD_VERSION for store builds, null for maintenance pages. */
  scaffold_version: number | null
  /**
   * Set only on scaffold rollout builds (lib/hosting/scaffold-rollout.ts): who started
   * it. Lets the fix / refund "latest failed build" checks and the rollout error
   * bookkeeping tell platform updates apart from the owner's own builds.
   */
  rollout_trigger?: 'admin' | 'cron' | 'owner' | null
}

export function isUnknownColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

/**
 * Inserts a deployments row and returns its id (null when the insert failed — callers
 * keep their existing "log and continue" behaviour; the error is returned too).
 */
export async function insertDeploymentRow(
  row: DeploymentRowInput,
): Promise<{ id: string | null; error: { message: string; code?: string } | null }> {
  const first = await supabaseAdmin.from('deployments').insert(row).select('id').single()
  if (!first.error) return { id: (first.data as { id: string } | null)?.id ?? null, error: null }
  if (!isUnknownColumnError(first.error)) return { id: null, error: first.error }

  // Pre-migration schema: drop the new columns and try once more.
  const { target: _target, scaffold_version: _scaffold, rollout_trigger: _trigger, ...legacy } = row
  void _target; void _scaffold; void _trigger
  const retry = await supabaseAdmin.from('deployments').insert(legacy).select('id').single()
  if (retry.error) return { id: null, error: retry.error }
  return { id: (retry.data as { id: string } | null)?.id ?? null, error: null }
}

// Draft/publish (supabase/migration-draft-publish.sql) — until it has run there is no
// deployments.promoted_at and the target check constraint rejects 'staged', so callers
// keep the old behaviour (chat edits of live stores deploy straight to production).
// Cached per instance once confirmed; a failed lookup is retried on the next call.
let draftPublishReady: boolean | null = null
export async function isDraftPublishReady(): Promise<boolean> {
  if (draftPublishReady) return true
  const { error } = await supabaseAdmin.from('deployments').select('promoted_at').limit(1)
  if (!error) {
    draftPublishReady = true
    return true
  }
  if (!isUnknownColumnError(error)) console.error('[deployments] draft/publish check failed:', error.message)
  return false
}
