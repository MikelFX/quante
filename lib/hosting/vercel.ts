// Server-only. Never import this module in client code.
import { Vercel } from '@vercel/sdk'
import type { GeneratedFile } from '@/lib/store-template/build'

const vercel = new Vercel({ bearerToken: process.env.VERCEL_TOKEN! })
const TEAM_ID = process.env.VERCEL_TEAM_ID!
export const HOSTING_ROOT_DOMAIN = process.env.HOSTING_ROOT_DOMAIN ?? 'quante.app'

export type DeploymentState = 'queued' | 'building' | 'ready' | 'error' | 'canceled'

export interface DeploymentStatus {
  state: DeploymentState
  url?: string
}

// ─── Project ──────────────────────────────────────────────────────────────────

export async function ensureVercelProject(
  projectSlug: string,
): Promise<{ vercelProjectId: string }> {
  const res = await vercel.projects.getProjects({
    search: projectSlug,
    teamId: TEAM_ID,
    limit: '1',
  })

  // SDK returns a union — defensively handle all variants
  const rawProjects: Array<{ id: string; name: string }> = Array.isArray(res)
    ? (res as Array<{ id: string; name: string }>)
    : 'projects' in (res as object)
      ? ((res as { projects: Array<{ id: string; name: string }> }).projects ?? [])
      : []

  const existing = rawProjects.find((p) => p.name === projectSlug)
  if (existing) return { vercelProjectId: existing.id }

  const created = await vercel.projects.createProject({
    teamId: TEAM_ID,
    requestBody: { name: projectSlug, framework: 'nextjs' },
  })
  return { vercelProjectId: created.id }
}

export async function removeProject(vercelProjectId: string): Promise<void> {
  await vercel.projects.deleteProject({ idOrName: vercelProjectId, teamId: TEAM_ID })
}

// ─── Env vars ─────────────────────────────────────────────────────────────────

export async function setEnvVars(
  vercelProjectId: string,
  vars: Record<string, string>,
  options: { encrypted?: string[] } = {},
): Promise<void> {
  if (Object.keys(vars).length === 0) return

  const envs = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: (options.encrypted?.includes(key) ? 'encrypted' : 'plain') as 'encrypted' | 'plain',
    target: ['production' as const],
  }))

  await vercel.projects.createProjectEnv({
    idOrName: vercelProjectId,
    teamId: TEAM_ID,
    upsert: 'true',
    requestBody: envs,
  })
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export async function createDeployment(
  vercelProjectId: string,
  files: GeneratedFile[],
  options: { target: 'production' },
): Promise<{ deploymentId: string; url: string }> {
  const result = await vercel.deployments.createDeployment({
    teamId: TEAM_ID,
    requestBody: {
      name: vercelProjectId,
      project: vercelProjectId,
      target: options.target,
      files: files.map((f) => ({
        file: f.path,
        data: f.content,
        encoding: (f.encoding ?? 'utf-8') as 'utf-8' | 'base64',
      })),
    },
  })
  return { deploymentId: result.id, url: result.url }
}

// Auto-deploy (used by generate/iterate/fix/redeploy): production target so the store
// is always up to date. Returns the subdomain URL if DNS is verified, otherwise the
// raw Vercel deployment URL so the iframe always works.
export async function createPreviewDeployment(
  vercelProjectId: string,
  files: Array<{ path: string; data: string; encoding?: string }>,
  storeSlug?: string,
): Promise<{ deploymentId: string; url: string }> {
  const result = await vercel.deployments.createDeployment({
    teamId: TEAM_ID,
    requestBody: {
      name: vercelProjectId,
      project: vercelProjectId,
      target: 'production',
      files: files.map((f) => ({
        file: f.path,
        data: f.data,
        encoding: (f.encoding ?? 'utf-8') as 'utf-8' | 'base64',
      })),
    },
  })

  const rawUrl = result.url.startsWith('https://') ? result.url : `https://${result.url}`

  // Attach subdomain and always use it as the canonical URL once the domain is on the project.
  // verified=false just means DNS isn't confirmed yet — Vercel will start routing as soon as it propagates.
  if (storeSlug && HOSTING_ROOT_DOMAIN) {
    const storeDomain = `${storeSlug}.${HOSTING_ROOT_DOMAIN}`
    try {
      await attachDomain(vercelProjectId, storeDomain)
    } catch (err) {
      const msg = String(err)
      if (!msg.includes('already') && !msg.includes('409') && !msg.includes('exist') && !msg.includes('onflict')) {
        console.error('[vercel] attachDomain failed:', err)
      }
      // Domain is almost certainly already attached from a prior deploy — use domain URL regardless
    }
    return { deploymentId: result.id, url: `https://${storeDomain}` }
  }

  return { deploymentId: result.id, url: rawUrl }
}

// True Vercel preview (no target): unique URL per deploy, no subdomain.
// Used for manual "Preview deploy" (2 credits) from the Studio.
export async function createVercelPreviewDeploy(
  vercelProjectId: string,
  files: Array<{ path: string; data: string; encoding?: string }>,
): Promise<{ deploymentId: string; url: string }> {
  const result = await vercel.deployments.createDeployment({
    teamId: TEAM_ID,
    requestBody: {
      name: vercelProjectId,
      project: vercelProjectId,
      files: files.map((f) => ({
        file: f.path,
        data: f.data,
        encoding: (f.encoding ?? 'utf-8') as 'utf-8' | 'base64',
      })),
    },
  })
  const rawUrl = result.url.startsWith('https://') ? result.url : `https://${result.url}`
  return { deploymentId: result.id, url: rawUrl }
}

export async function streamDeploymentLogs(
  deploymentId: string,
  onEvent: (event: { type: string; text: string; created: number }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = process.env.VERCEL_TOKEN
  const teamParam = TEAM_ID ? `&teamId=${TEAM_ID}` : ''
  const url = `https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward&follow=1${teamParam}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Vercel events API returned ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as {
            type?: string
            text?: string
            created?: number
            payload?: { text?: string; readyState?: string }
          }

          const type = parsed.type ?? 'stdout'
          const text = parsed.text ?? parsed.payload?.text ?? ''
          const created = parsed.created ?? Date.now()

          onEvent({ type, text, created })

          // Vercel signals build completion via readyState in the payload
          const readyState = parsed.payload?.readyState
          if (readyState === 'READY' || readyState === 'ERROR') {
            onEvent({ type: readyState === 'READY' ? 'ready' : 'error', text: '', created: Date.now() })
            return
          }
        } catch {
          // Not JSON — skip
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export async function getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
  const result = await vercel.deployments.getDeployment({
    idOrUrl: deploymentId,
    teamId: TEAM_ID,
  })
  return {
    state: mapReadyState(result.readyState),
    url: result.url ? `https://${result.url}` : undefined,
  }
}

export async function getBuildError(deploymentId: string): Promise<string> {
  try {
    const token = process.env.VERCEL_TOKEN
    const teamParam = TEAM_ID ? `&teamId=${TEAM_ID}` : ''
    const res = await fetch(
      `https://api.vercel.com/v2/deployments/${deploymentId}/events?type=stderr&direction=backward&limit=20${teamParam}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return 'Build failed — no details available.'
    const text = await res.text()
    // Events are newline-delimited JSON objects
    const lines = text.trim().split('\n').filter(Boolean)
    const messages = lines
      .map((l) => { try { return (JSON.parse(l) as { text?: string }).text ?? '' } catch { return '' } })
      .filter(Boolean)
      .join('\n')
      .trim()
    return messages || 'Build failed — check Vercel dashboard for details.'
  } catch {
    return 'Build failed — no details available.'
  }
}

// ─── Domains ──────────────────────────────────────────────────────────────────

export async function attachDomain(
  vercelProjectId: string,
  domain: string,
): Promise<{ verified: boolean; dnsInstructions?: string }> {
  const result = await vercel.projects.addProjectDomain({
    idOrName: vercelProjectId,
    teamId: TEAM_ID,
    requestBody: { name: domain },
  })

  if (result.verified) return { verified: true }

  const record = result.verification?.[0]
  const dnsInstructions = record?.type === 'TXT'
    ? `Add TXT record on ${record.domain} with value: ${record.value}`
    : `Add CNAME: ${domain} → cname.vercel-dns.com`

  return { verified: false, dnsInstructions }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapReadyState(state: string | undefined): DeploymentState {
  switch (state) {
    case 'QUEUED':
    case 'INITIALIZING':
      return 'queued'
    case 'BUILDING':
      return 'building'
    case 'READY':
      return 'ready'
    case 'ERROR':
    case 'BLOCKED':
      return 'error'
    case 'CANCELED':
      return 'canceled'
    default:
      return 'building'
  }
}
