// Auto-deploy after a chat edit (/api/quante/iterate) or an auto-fix (/api/quante/fix).
// Server-only. Callers MUST have verified the caller owns `projectId` first.
//
// SECURITY (audit #0 / #7):
//   - Always deploys into THIS project's own Vercel project (ensureProjectVercel, keyed
//     by the immutable project uuid) and its permanently claimed store slug — never a
//     project looked up by a user-controlled store name.
//   - A store that has gone live via Push to Live (everLive) AND may deploy to
//     production (trial running / paid / agency, not suspended) gets a STAGED build
//     (2026-09-26, draft/publish): production target so the preview runs with the
//     store's production env, but its domains keep serving the published build until
//     the owner clicks Publish (app/api/projects/[id]/publish). A broken chat edit or
//     fix therefore never reaches shoppers. Before migration-draft-publish.sql has run
//     this falls back to the old direct production deploy.
//   - Everything else gets a true preview deploy only, so a chat edit can't replace the
//     maintenance page or keep a store live for free.

import { insertDeploymentRow, isDraftPublishReady } from '@/lib/hosting/deployments'
import {
  HOSTING_ROOT_DOMAIN,
  createPreviewDeployment,
  createStagedDeployment,
  createVercelPreviewDeploy,
  ensureProjectVercel,
  getOrClaimStoreSlug,
} from '@/lib/hosting/vercel'
import { getHostingGate } from '@/lib/hosting/gate'
import { buildStoreFiles, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import type { CodeVersionFiles } from '@/types/store-code'

export interface AutoDeployResult {
  deploymentId: string | null
  previewUrl: string | null
  /** Went straight to the store's domains (only before migration-draft-publish.sql). */
  production: boolean
  /** Draft build of a live store — shoppers keep seeing the published build. */
  staged: boolean
}

export async function autoDeployCodeVersion(params: {
  projectId: string
  projectName: string | null
  userId: string
  files: CodeVersionFiles
  version: { id: string; version_no: number }
  logTag: string
}): Promise<AutoDeployResult> {
  const { projectId, projectName, userId, files, version, logTag } = params

  const gate = await getHostingGate(projectId)
  const production = gate.everLive && gate.canDeployProduction
  if (gate.everLive && !gate.canDeployProduction) {
    console.warn(`[${logTag}] hosting gate denied production deploy (${gate.reason}) — preview only`, { projectId })
  }

  const staged = production && await isDraftPublishReady()
  const direct = production && !staged

  const vercelProjectId = await ensureProjectVercel(projectId)
  const storeSlug = production ? await getOrClaimStoreSlug(projectId, projectName ?? '') : undefined

  const allFiles = buildStoreFiles(files)
  const filesPayload = allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' }))
  const result = staged
    ? await createStagedDeployment(vercelProjectId, filesPayload, storeSlug)
    : direct
      ? await createPreviewDeployment(vercelProjectId, filesPayload, storeSlug)
      : await createVercelPreviewDeploy(vercelProjectId, filesPayload)

  const url = result.url.startsWith('https://') ? result.url : `https://${result.url}`
  const storeDomain = storeSlug ? `${storeSlug}.${HOSTING_ROOT_DOMAIN}` : null
  // Record the public subdomain only when it was really attached to this project, so
  // the hosting cron can see (and suspend) what is actually live.
  const domain = direct && storeDomain && url === `https://${storeDomain}` ? storeDomain : null

  const { error: insertErr } = await insertDeploymentRow({
    project_id: projectId,
    user_id: userId,
    vercel_project_id: vercelProjectId,
    vercel_deployment_id: result.deploymentId,
    status: 'building',
    url,
    domain,
    version: version.version_no,
    code_version_id: version.id,
    target: staged ? 'staged' : direct ? 'production' : 'preview',
    scaffold_version: SCAFFOLD_VERSION,
  })
  if (insertErr) console.error(`[${logTag}] deployments insert failed:`, insertErr.message)

  return { deploymentId: result.deploymentId, previewUrl: url, production: direct, staged }
}
