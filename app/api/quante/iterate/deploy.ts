// Auto-deploy after a chat edit (/api/quante/iterate) or an auto-fix (/api/quante/fix).
// Server-only. Callers MUST have verified the caller owns `projectId` first.
//
// SECURITY (audit #0 / #7):
//   - Always deploys into THIS project's own Vercel project (ensureProjectVercel, keyed
//     by the immutable project uuid) and its permanently claimed store slug — never a
//     project looked up by a user-controlled store name.
//   - Production (target: 'production' + the public <slug>.stores subdomain) only when
//     the store has already gone live via Push to Live (everLive) AND the hosting gate
//     allows it (trial running / paid / agency, not suspended). A suspended or unpaid
//     store gets a true preview deploy only, so a chat edit can't replace the
//     maintenance page or keep a store live for free.

import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  HOSTING_ROOT_DOMAIN,
  createPreviewDeployment,
  createVercelPreviewDeploy,
  ensureProjectVercel,
  getOrClaimStoreSlug,
} from '@/lib/hosting/vercel'
import { getHostingGate } from '@/lib/hosting/gate'
import { buildStoreFiles } from '@/lib/store-template/build'
import type { CodeVersionFiles } from '@/types/store-code'

export interface AutoDeployResult {
  deploymentId: string | null
  previewUrl: string | null
  production: boolean
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

  const vercelProjectId = await ensureProjectVercel(projectId)
  const storeSlug = production ? await getOrClaimStoreSlug(projectId, projectName ?? '') : undefined

  const allFiles = buildStoreFiles(files)
  const filesPayload = allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' }))
  const result = production
    ? await createPreviewDeployment(vercelProjectId, filesPayload, storeSlug)
    : await createVercelPreviewDeploy(vercelProjectId, filesPayload)

  const url = result.url.startsWith('https://') ? result.url : `https://${result.url}`
  const storeDomain = storeSlug ? `${storeSlug}.${HOSTING_ROOT_DOMAIN}` : null
  // Record the public subdomain only when it was really attached to this project, so
  // the hosting cron can see (and suspend) what is actually live.
  const domain = production && storeDomain && url === `https://${storeDomain}` ? storeDomain : null

  const { error: insertErr } = await supabaseAdmin.from('deployments').insert({
    project_id: projectId,
    user_id: userId,
    vercel_project_id: vercelProjectId,
    vercel_deployment_id: result.deploymentId,
    status: 'building',
    url,
    domain,
    version: version.version_no,
    code_version_id: version.id,
  })
  if (insertErr) console.error(`[${logTag}] deployments insert failed:`, insertErr.message)

  return { deploymentId: result.deploymentId, previewUrl: result.url, production }
}
