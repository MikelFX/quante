// Server-only. Never import this module in client code.
import type { GeneratedFile } from '@/lib/store-template/build'

const TEAM_ID = process.env.VERCEL_TEAM_ID!
export const HOSTING_ROOT_DOMAIN = process.env.HOSTING_ROOT_DOMAIN ?? 'stores.quantecode.com'

export type DeploymentState = 'queued' | 'building' | 'ready' | 'error' | 'canceled'

export interface DeploymentStatus {
  state: DeploymentState
  url?: string
}

// ─── Raw Vercel REST client (2026-08-19 fix) ───────────────────────────────────
//
// Why this exists instead of @vercel/sdk: the SDK (^1.21.9) parses every response
// through a generated Zod schema before returning it. On 2026-08-19 we found that
// `vercel.projects.getProjects()` / `createProject()` were throwing "Response
// validation failed | status=200 | body={...valid Project object...}" — Vercel's
// API was returning a perfectly good 200 with a real project (confirmed: the
// project always existed in the Vercel dashboard), but the SDK's bundled schema
// doesn't recognize some field Vercel now returns (the truncated error body cut
// off inside `deploymentExpiration`, strongly suggesting a new/renamed field
// there). Because that throw happened *before* any deployment was ever created,
// every single test store in this debugging session got a real Vercel project
// and zero Vercel deployments — the Studio's "Preparing deployment" step then
// hung forever with nothing to poll.
//
// Fix: talk to api.vercel.com directly, exactly like streamDeploymentLogs() and
// getBuildError() already did further down this file. We only read the 2-3
// fields we actually use from each response, so there is no schema to drift out
// of sync with Vercel's API in the first place.
async function vercelApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const token = process.env.VERCEL_TOKEN

  const params = new URLSearchParams()
  if (TEAM_ID) params.set('teamId', TEAM_ID)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(key, value)
  }
  const qs = params.toString()
  const url = `https://api.vercel.com${path}${qs ? `?${qs}` : ''}`

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  const text = await res.text()
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }

  if (!res.ok) {
    const errBody = json as { error?: { message?: string; code?: string } } | undefined
    const message = errBody?.error?.message ?? res.statusText ?? `Vercel API request failed`
    // Deliberately embed the status code in the message text (not just the .statusCode
    // field) — callers upstream (e.g. createPreviewDeployment's attachDomain catch) do
    // string-matching like `String(err).includes('409')` to detect "already attached"
    // conflicts, and that check must keep working after this rewrite.
    const err = new Error(`Vercel API ${res.status} ${path}: ${message}`) as Error & {
      statusCode?: number
      body?: unknown
      rawResponse?: { status: number; statusText: string }
    }
    err.statusCode = res.status
    err.body = json
    err.rawResponse = { status: res.status, statusText: res.statusText }
    throw err
  }

  return json as T
}

// ─── Project ──────────────────────────────────────────────────────────────────

function extractProjectsList(res: unknown): Array<{ id: string; name: string }> {
  if (Array.isArray(res)) return res as Array<{ id: string; name: string }>
  if (res && typeof res === 'object' && 'projects' in res) {
    return (res as { projects?: Array<{ id: string; name: string }> }).projects ?? []
  }
  return []
}

export async function ensureVercelProject(
  projectSlug: string,
): Promise<{ vercelProjectId: string }> {
  const res = await vercelApiFetch<unknown>('/v10/projects', {
    query: { search: projectSlug, limit: '1' },
  })

  const rawProjects = extractProjectsList(res)
  const existing = rawProjects.find((p) => p.name === projectSlug)
  if (existing) return { vercelProjectId: existing.id }

  const created = await vercelApiFetch<{ id: string }>('/v11/projects', {
    method: 'POST',
    body: { name: projectSlug, framework: 'nextjs' },
  })
  return { vercelProjectId: created.id }
}

export async function removeProject(vercelProjectId: string): Promise<void> {
  await vercelApiFetch(`/v9/projects/${encodeURIComponent(vercelProjectId)}`, {
    method: 'DELETE',
  })
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

  await vercelApiFetch(`/v10/projects/${encodeURIComponent(vercelProjectId)}/env`, {
    method: 'POST',
    query: { upsert: 'true' },
    body: envs,
  })
}

// ─── Deployments ──────────────────────────────────────────────────────────────

// Vercel's `name` field in the deployment request body populates the deployment URL
// slug. It expects a URL-safe project name (lowercase alphanumeric + hyphens) —
// passing a `prj_xxxx` project ID here works only because `project` overrides it,
// but if the SDK ever tightens validation, or a codepath forgets to set `project`,
// the request silently 400s with no deployment row created (0 rows in Vercel
// dashboard — the bug we chased on 2026-08-18). Normalize defensively.
function toDeploymentName(candidate: string | undefined, fallback: string): string {
  const raw = (candidate ?? fallback ?? 'store').toLowerCase()
  const cleaned = raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned.slice(0, 52) || 'store'
}

// Guardrail: we expect { id: string; url: string } back, but we've seen silent
// failures where the request was rejected upstream and something odd came back.
// Validate before returning so a bad response surfaces immediately instead of stashing an
// empty deploymentId in the DB and leaving the client polling forever.
//
// Also always dumps the raw response one-liner *before* validation — the 2026-08-18 fix
// only logged on the throw path, which masked cases where Vercel returns a technically-valid
// but subtly-shaped response (different casing, extra wrapper) that assertDeploymentResult
// still accepts but downstream chokes on. Keep this permanent; it's a single JSON.stringify.
function assertDeploymentResult(
  result: unknown,
  context: string,
): { id: string; url: string } {
  const asRecord = (result ?? {}) as { id?: unknown; url?: unknown; error?: unknown }
  const rawPreview = JSON.stringify(asRecord).slice(0, 600)
  console.log(`[vercel] ${context}: raw response`, rawPreview)
  const id = typeof asRecord.id === 'string' && asRecord.id.length > 0 ? asRecord.id : null
  const url = typeof asRecord.url === 'string' && asRecord.url.length > 0 ? asRecord.url : null
  if (!id || !url) {
    console.error(`[vercel] ${context}: invalid createDeployment response (missing id/url):`, rawPreview)
    throw new Error(`Vercel returned an incomplete deployment response (${context}): ${rawPreview}`)
  }
  return { id, url }
}

// Best-effort: pull the useful bits off any thrown error (vercelApiFetch's Error,
// fetch failure). Keeps us from logging huge unhelpful stacks while still capturing what
// Vercel actually said. Runs *before* we rethrow so the caller's own error handler still fires.
// summarizeDeploymentFailure is exported so callers that need to persist the failure
// somewhere durable (e.g. generation_jobs.deploy_error) get the same shape as the log line.
export interface DeploymentFailureSummary {
  message: string
  status?: number | string
  statusText?: string
  body?: unknown
}

export function summarizeDeploymentFailure(err: unknown): DeploymentFailureSummary {
  const asRecord = (err ?? {}) as {
    message?: unknown
    statusCode?: unknown
    body?: unknown
    rawResponse?: { status?: number; statusText?: string }
    data$?: unknown
    response?: { status?: number; statusText?: string }
  }
  return {
    message: typeof asRecord.message === 'string' ? asRecord.message : String(err),
    status:
      (typeof asRecord.statusCode === 'number' || typeof asRecord.statusCode === 'string')
        ? asRecord.statusCode
        : asRecord.rawResponse?.status ?? asRecord.response?.status,
    statusText: asRecord.rawResponse?.statusText ?? asRecord.response?.statusText,
    body: asRecord.body ?? asRecord.data$,
  }
}

function logDeploymentFailure(context: string, err: unknown, extra?: Record<string, unknown>): void {
  const summary = summarizeDeploymentFailure(err)
  console.error(`[vercel] ${context} failed:`, { ...summary, ...(extra ?? {}) })
}

export async function createDeployment(
  vercelProjectId: string,
  files: GeneratedFile[],
  options: { target: 'production'; projectSlug?: string },
): Promise<{ deploymentId: string; url: string }> {
  const deploymentName = toDeploymentName(options.projectSlug, vercelProjectId)
  try {
    const result = await vercelApiFetch<unknown>('/v13/deployments', {
      method: 'POST',
      body: {
        name: deploymentName,
        project: vercelProjectId,
        target: options.target,
        files: files.map((f) => ({
          file: f.path,
          data: f.content,
          encoding: f.encoding ?? 'utf-8',
        })),
      },
    })
    const { id, url } = assertDeploymentResult(result, 'createDeployment')
    console.log('[vercel] createDeployment ok:', { id, url, project: vercelProjectId, name: deploymentName, target: options.target, files: files.length })
    return { deploymentId: id, url }
  } catch (err) {
    logDeploymentFailure('createDeployment', err, { project: vercelProjectId, name: deploymentName, files: files.length })
    throw err
  }
}

// Auto-deploy (used by generate/iterate/fix/redeploy): production target so the store
// is always up to date. Returns the subdomain URL if DNS is verified, otherwise the
// raw Vercel deployment URL so the iframe always works.
export async function createPreviewDeployment(
  vercelProjectId: string,
  files: Array<{ path: string; data: string; encoding?: string }>,
  storeSlug?: string,
): Promise<{ deploymentId: string; url: string }> {
  const deploymentName = toDeploymentName(storeSlug, vercelProjectId)
  let result: unknown
  try {
    result = await vercelApiFetch<unknown>('/v13/deployments', {
      method: 'POST',
      body: {
        name: deploymentName,
        project: vercelProjectId,
        target: 'production',
        files: files.map((f) => ({
          file: f.path,
          data: f.data,
          encoding: f.encoding ?? 'utf-8',
        })),
      },
    })
  } catch (err) {
    logDeploymentFailure('createPreviewDeployment', err, { project: vercelProjectId, name: deploymentName, files: files.length })
    throw err
  }

  const { id, url } = assertDeploymentResult(result, 'createPreviewDeployment')
  const rawUrl = url.startsWith('https://') ? url : `https://${url}`
  console.log('[vercel] createPreviewDeployment ok:', { id, url: rawUrl, project: vercelProjectId, name: deploymentName, storeSlug })

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
    return { deploymentId: id, url: `https://${storeDomain}` }
  }

  return { deploymentId: id, url: rawUrl }
}

// True Vercel preview (no target): unique URL per deploy, no subdomain.
// Used for manual "Preview deploy" (2 credits) from the Studio and for
// the free auto-validation deploy after generate/iterate/fix.
export async function createVercelPreviewDeploy(
  vercelProjectId: string,
  files: Array<{ path: string; data: string; encoding?: string }>,
  projectSlug?: string,
): Promise<{ deploymentId: string; url: string }> {
  const deploymentName = toDeploymentName(projectSlug, vercelProjectId)
  let result: unknown
  try {
    result = await vercelApiFetch<unknown>('/v13/deployments', {
      method: 'POST',
      body: {
        name: deploymentName,
        project: vercelProjectId,
        files: files.map((f) => ({
          file: f.path,
          data: f.data,
          encoding: f.encoding ?? 'utf-8',
        })),
      },
    })
  } catch (err) {
    logDeploymentFailure('createVercelPreviewDeploy', err, { project: vercelProjectId, name: deploymentName, files: files.length })
    throw err
  }

  const { id, url } = assertDeploymentResult(result, 'createVercelPreviewDeploy')
  const rawUrl = url.startsWith('https://') ? url : `https://${url}`
  console.log('[vercel] createVercelPreviewDeploy ok:', { id, url: rawUrl, project: vercelProjectId, name: deploymentName })
  return { deploymentId: id, url: rawUrl }
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
  const result = await vercelApiFetch<{ readyState?: string; url?: string }>(
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
  )
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
  const result = await vercelApiFetch<{
    verified?: boolean
    verification?: Array<{ type?: string; domain?: string; value?: string }>
  }>(`/v10/projects/${encodeURIComponent(vercelProjectId)}/domains`, {
    method: 'POST',
    body: { name: domain },
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
