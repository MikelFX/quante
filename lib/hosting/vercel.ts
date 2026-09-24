// Server-only. Never import this module in client code.
import type { GeneratedFile } from '@/lib/store-template/build'
import { toStoreSlug } from '@/lib/store-template/build'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'

const TEAM_ID = process.env.VERCEL_TEAM_ID!
export const HOSTING_ROOT_DOMAIN = process.env.HOSTING_ROOT_DOMAIN ?? 'stores.quantecode.com'

export type DeploymentState = 'queued' | 'building' | 'ready' | 'error' | 'canceled'

export interface DeploymentStatus {
  state: DeploymentState
  url?: string
  /** Vercel's deployment target ('production' or null for a preview), when known. */
  target?: string | null
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
  // Fail closed instead of sending "Bearer undefined" to Vercel.
  if (!token) throw new Error('VERCEL_TOKEN is not configured')

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
    // Embed the status code in the message text (not just the .statusCode field) so
    // logs and older callers that string-match on it keep working. NOTE: do not treat
    // a '409' match on attachDomain as success — attachDomain itself now resolves the
    // "already on this same project" case and only throws when the domain is not ours.
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
//
// SECURITY (audit 2026-09, finding #0): the old ensureVercelProject(slug) looked up a
// Vercel project in the shared Quante team *by store name*. Store names are
// user/AI-controlled and not unique, so naming a brand "Acme Coffee" handed you the
// victim's Vercel project — their subdomain, custom domain and payment env vars.
// It is gone. Vercel project identity now derives ONLY from the immutable Quante
// project UUID and is persisted on projects.vercel_project_id; the public subdomain
// is a separately claimed, unique projects.store_slug (getOrClaimStoreSlug).

function statusOf(err: unknown): number | undefined {
  const code = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof code === 'number' ? code : undefined
}

// Only this Quante project can derive this name, so a 409 → lookup-by-name is safe.
function vercelProjectNameFor(projectId: string): string {
  return `q-${projectId.toLowerCase().replace(/-/g, '')}`
}

interface VercelProjectInfo {
  id: string
  framework: string | null
  installCommand: string | null
  buildCommand: string | null
  /** oidcTokenConfig.enabled as reported by Vercel; null = not reported (unknown). */
  oidcEnabled?: boolean | null
  /**
   * Vercel Authentication (deployment protection) setting. Key present with null = off;
   * key absent = the API response did not include it (state unknown).
   */
  ssoProtection?: unknown
}

/** GET /v9/projects/{idOrName} → its id + build settings, or null on 404. Other errors throw. */
async function getVercelProject(idOrName: string): Promise<VercelProjectInfo | null> {
  try {
    const project = await vercelApiFetch<{
      id?: string
      framework?: string | null
      installCommand?: string | null
      buildCommand?: string | null
      ssoProtection?: unknown
      oidcTokenConfig?: { enabled?: boolean } | null
    }>(`/v9/projects/${encodeURIComponent(idOrName)}`)
    if (typeof project?.id !== 'string' || !project.id) return null
    return {
      id: project.id,
      framework: project.framework ?? null,
      installCommand: project.installCommand ?? null,
      buildCommand: project.buildCommand ?? null,
      oidcEnabled: typeof project.oidcTokenConfig?.enabled === 'boolean' ? project.oidcTokenConfig.enabled : null,
      // Only carry the key when Vercel sent it: an omitted field must not read as "off",
      // or disableDeploymentProtection would skip the PATCH while protection is on.
      ...('ssoProtection' in project ? { ssoProtection: project.ssoProtection } : {}),
    }
  } catch (err) {
    if (statusOf(err) === 404) return null
    throw err
  }
}

// SECURITY (audit #23, infra part): store projects build tenant/AI-authored code
// inside Quante's Vercel team, so the project-level build settings are pinned instead
// of being inferred from the uploaded files:
//   - installCommand runs with --ignore-scripts, so no dependency (or a tampered
//     package.json) can run preinstall/install/postinstall hooks at build time. The
//     scaffold's dependency tree needs none: the only install script in it is sharp's
//     prebuilt-binary check (sharp ships its binaries as optional @img/* packages, and
//     Vercel serves next/image itself). Verified with `npm install --ignore-scripts`
//     + `next build` on the scaffold's package.json.
//   - buildCommand is `next build` directly, never package.json's `build` script
//     (package.json and vercel.json are also LOCKED / rejected in buildStoreFiles).
//   - framework is fixed to nextjs; outputDirectory / rootDirectory / devCommand stay
//     at the framework defaults.
// They are applied in three places so no store builds with inferred settings:
//   1. on project CREATE (createOrGetOwnVercelProject);
//   2. lazily on existing projects: ensureProjectVercel compares the project's live
//      settings (already fetched to confirm it exists) and PATCHes them when they
//      differ, so stores created before this change are hardened on their next deploy
//      without a flag column or a backfill script;
//   3. per deployment, as `projectSettings` on every POST /v13/deployments
//      (STORE_DEPLOYMENT_SETTINGS), which pins the settings for that build even if the
//      PATCH above failed.
// NOTE: `npm install --ignore-scripts` + `next build` was verified locally on Windows.
// The Linux platform binaries (@next/swc-*, @tailwindcss/oxide-*, lightningcss-*,
// @img/sharp-*) are optionalDependencies that npm selects by os/cpu, not install
// scripts, and the scaffold ships no lockfile, so they should resolve normally on
// Vercel's Linux builders. Confirm once with a real Vercel deploy.
const STORE_BUILD_SETTINGS = {
  framework: 'nextjs',
  installCommand: 'npm install --ignore-scripts',
  buildCommand: 'next build',
} as const

// Project-level settings (create + hardening PATCH). SECURITY (F9): Vercel OIDC
// federation is on by default for new projects, which would hand AI-authored store
// code a team-scoped OIDC token (VERCEL_OIDC_TOKEN at build time and in functions).
// Stores never need it, so it is explicitly disabled. Kept out of the per-deployment
// projectSettings, whose schema only covers build settings.
const STORE_PROJECT_SETTINGS = {
  ...STORE_BUILD_SETTINGS,
  oidcTokenConfig: { enabled: false },
} as const

/** projectSettings sent with every store deployment (see the #23 note above). */
const STORE_DEPLOYMENT_SETTINGS = { ...STORE_BUILD_SETTINGS }

function hasHardenedSettings(p: VercelProjectInfo): boolean {
  return (
    p.framework === STORE_BUILD_SETTINGS.framework &&
    p.installCommand === STORE_BUILD_SETTINGS.installCommand &&
    p.buildCommand === STORE_BUILD_SETTINGS.buildCommand &&
    // null = Vercel did not report it → PATCH to be sure.
    p.oidcEnabled === false
  )
}

/**
 * Brings an existing store project's build settings in line with
 * STORE_PROJECT_SETTINGS. Best-effort: a failure is logged loudly but does not block
 * the deploy, because every deployment also carries the same settings as
 * `projectSettings` (STORE_DEPLOYMENT_SETTINGS).
 */
async function hardenProjectSettings(project: VercelProjectInfo): Promise<void> {
  if (hasHardenedSettings(project)) return
  try {
    await vercelApiFetch(`/v9/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: { ...STORE_PROJECT_SETTINGS },
    })
    console.log('[vercel] hardened build settings on existing store project', { project: project.id })
  } catch (err) {
    console.error('[vercel] SECURITY: could not harden build settings on store project', {
      project: project.id,
      ...summarizeDeploymentFailure(err),
    })
  }
}

// Store previews (*.vercel.app deployment URLs) are shown in the Studio iframe —
// notably while hosting is paused, when chat edits deploy as true previews and the raw
// deployment URL is the only place the new version runs. Vercel's default deployment
// protection (Vercel Authentication) would put a Vercel login wall there, so it is
// switched off on store projects (ssoProtection: null). This is safe because:
//   - a store deployment contains only the public storefront (the same content the
//     live subdomain serves); secrets live in encrypted env vars / Quante's API, never
//     in the bundle;
//   - deployment URLs are unguessable, and a paused store's preview cannot take
//     orders: /api/store/checkout refuses unless getHostingGate allows production, so
//     sharing a preview URL is not a way around the hosting paywall.
// Applied via PATCH (documented for /v9/projects/{id}), not on POST /v11/projects, so an
// API that rejects the field can never break project creation. Best-effort: a failure
// only means the Studio iframe may show Vercel's login page for previews. The PATCH is
// skipped only when a fetched project explicitly reports ssoProtection: null; when the
// state is unknown (just created, 409 lookup, field omitted) it is sent — it is
// idempotent. NOT yet verified against the live Vercel API: confirm once that a store
// preview URL opens without a Vercel login.
async function disableDeploymentProtection(project: { id: string; ssoProtection?: unknown }): Promise<void> {
  if ('ssoProtection' in project && project.ssoProtection === null) return
  try {
    await vercelApiFetch(`/v9/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: { ssoProtection: null },
    })
  } catch (err) {
    console.warn('[vercel] could not disable deployment protection on store project', {
      project: project.id,
      ...summarizeDeploymentFailure(err),
    })
  }
}

async function createOrGetOwnVercelProject(projectId: string): Promise<string> {
  const name = vercelProjectNameFor(projectId)
  try {
    const created = await vercelApiFetch<{ id?: string }>('/v11/projects', {
      method: 'POST',
      body: { name, ...STORE_PROJECT_SETTINGS },
    })
    if (typeof created?.id === 'string' && created.id) {
      await disableDeploymentProtection({ id: created.id })
      return created.id
    }
  } catch (err) {
    // 409 = a concurrent first deploy of this same project already created it.
    if (statusOf(err) !== 409) throw err
  }
  const existing = await getVercelProject(name)
  if (!existing) throw new Error(`Vercel project ${name} could not be created or found`)
  // The concurrent creator also PATCHes; doing it here too means neither request's
  // failure leaves protection on until the next ensureProjectVercel call.
  await hardenProjectSettings(existing)
  await disableDeploymentProtection(existing)
  return existing.id
}

/**
 * Returns the Vercel project id for this Quante project, creating it on first use.
 * Callers MUST have verified the caller owns `projectId` (getOwnedProject) first.
 */
export async function ensureProjectVercel(projectId: string): Promise<string> {
  if (!isUuid(projectId)) throw new Error('ensureProjectVercel: invalid project id')

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, vercel_project_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`ensureProjectVercel: project lookup failed: ${error.message}`)
  if (!data) throw new Error('ensureProjectVercel: project not found')

  const stored = (data as { vercel_project_id: string | null }).vercel_project_id ?? null
  if (stored) {
    const live = await getVercelProject(stored)
    if (live) {
      await warnIfSharedVercelProject(projectId, stored)
      await hardenProjectSettings(live)
      await disableDeploymentProtection(live)
      return stored
    }
    console.warn(`[vercel] stored Vercel project ${stored} for ${projectId} no longer exists — recreating`)
  }

  const fresh = await createOrGetOwnVercelProject(projectId)

  // Compare-and-set so two concurrent first deploys agree on one id (and a recreate
  // only replaces the exact stale id we saw).
  const base = supabaseAdmin.from('projects').update({ vercel_project_id: fresh }).eq('id', projectId)
  const { error: updErr } = stored
    ? await base.eq('vercel_project_id', stored)
    : await base.is('vercel_project_id', null)
  if (updErr) throw new Error(`ensureProjectVercel: failed to persist vercel_project_id: ${updErr.message}`)

  const { data: reread, error: rereadErr } = await supabaseAdmin
    .from('projects')
    .select('vercel_project_id')
    .eq('id', projectId)
    .maybeSingle()
  if (rereadErr) throw new Error(`ensureProjectVercel: re-read failed: ${rereadErr.message}`)
  const finalId = (reread as { vercel_project_id: string | null } | null)?.vercel_project_id ?? null
  if (!finalId) throw new Error('ensureProjectVercel: vercel_project_id missing after persist')
  return finalId
}

// Legacy rows created by the old name-based lookup can point two Quante projects at
// one Vercel project. We can't safely tell which tenant is the rightful owner here,
// so surface it loudly for manual migration (see migration-security-foundation.sql).
async function warnIfSharedVercelProject(projectId: string, vercelProjectId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('vercel_project_id', vercelProjectId)
      .neq('id', projectId)
      .limit(1)
    if (data && data.length > 0) {
      console.error(
        `[vercel] SECURITY: Vercel project ${vercelProjectId} is shared by Quante projects ${projectId} and ${data[0].id} — migrate manually`,
      )
    }
  } catch {
    // diagnostics only
  }
}

// ─── Store slug (public <slug>.stores subdomain) ──────────────────────────────

const RESERVED_STORE_SLUGS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'quante', 'dashboard', 'stores', 'status',
])

// DNS label: 1-63 chars of [a-z0-9-], no leading/trailing hyphen.
const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function isValidStoreSlug(slug: string): boolean {
  return STORE_SLUG_RE.test(slug) && !RESERVED_STORE_SLUGS.has(slug)
}

async function readStoreSlug(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('store_slug')
    .eq('id', projectId)
    .maybeSingle()
  if (error) {
    throw new Error(
      `getOrClaimStoreSlug: store_slug lookup failed (run supabase/migration-security-foundation.sql?): ${error.message}`,
    )
  }
  if (!data) throw new Error('getOrClaimStoreSlug: project not found')
  return (data as { store_slug: string | null }).store_slug ?? null
}

// Belt-and-braces on top of the UNIQUE index: skip slugs held by another project row
// or still live on another project's (pre-backfill) deployment.
async function slugTakenElsewhere(projectId: string, slug: string): Promise<boolean> {
  const { data: owner } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('store_slug', slug)
    .neq('id', projectId)
    .limit(1)
  if (owner && owner.length > 0) return true

  const { data: legacy } = await supabaseAdmin
    .from('deployments')
    .select('project_id')
    .eq('domain', `${slug}.${HOSTING_ROOT_DOMAIN}`)
    .neq('project_id', projectId)
    .limit(1)
  return !!legacy && legacy.length > 0
}

/**
 * Returns this project's permanent store slug, claiming a unique one on first use
 * (base, base-2, base-3, …). Once set it never changes, so renaming the project or
 * the AI rewriting the brand name can't move or collide the store's subdomain.
 * Callers MUST have verified the caller owns `projectId` first.
 */
export async function getOrClaimStoreSlug(projectId: string, desiredName: string): Promise<string> {
  if (!isUuid(projectId)) throw new Error('getOrClaimStoreSlug: invalid project id')

  const existing = await readStoreSlug(projectId)
  if (existing) return existing

  // Leave room for a numeric suffix inside the 63-char DNS label limit.
  const base = toStoreSlug(String(desiredName ?? '')).slice(0, 50).replace(/-+$/g, '') || 'store'
  const candidates: string[] = [base]
  for (let i = 2; i <= 30; i++) candidates.push(`${base}-${i}`)
  // Last resort: a suffix only this project can produce.
  candidates.push(`${base}-${projectId.replace(/-/g, '').slice(0, 8)}`)

  for (const candidate of candidates) {
    if (!isValidStoreSlug(candidate)) continue
    if (await slugTakenElsewhere(projectId, candidate)) continue

    const { error } = await supabaseAdmin
      .from('projects')
      .update({ store_slug: candidate })
      .eq('id', projectId)
      .is('store_slug', null)
    if (error) {
      // 23505 = unique violation: another project grabbed it between check and claim.
      if ((error as { code?: string }).code === '23505') continue
      throw new Error(`getOrClaimStoreSlug: claim failed: ${error.message}`)
    }
    // Claimed — or 0 rows updated because a concurrent request already claimed a
    // slug for this project. Either way the re-read below is authoritative.
    break
  }

  const final = await readStoreSlug(projectId)
  if (!final) throw new Error('getOrClaimStoreSlug: could not claim a store slug')
  return final
}

export async function removeProject(vercelProjectId: string): Promise<void> {
  await vercelApiFetch(`/v9/projects/${encodeURIComponent(vercelProjectId)}`, {
    method: 'DELETE',
  })
}

// ─── Env vars ─────────────────────────────────────────────────────────────────

const STORE_ENV_KEY_RE = /^(?:QUANTE_API_URL|QUANTE_PROJECT_ID|QUANTE_API_KEY|NEXT_PUBLIC_[A-Z0-9_]+)$/

export async function setEnvVars(
  vercelProjectId: string,
  vars: Record<string, string>,
  options: { encrypted?: string[] } = {},
): Promise<void> {
  if (Object.keys(vars).length === 0) return

  // SECURITY (F9): store projects run AI-authored code, so only the store's own
  // connection values and public build-time vars may ever be set on them — never a
  // platform secret (service-role key, Stripe secret, Clerk/Anthropic keys …).
  const disallowed = Object.keys(vars).filter((k) => !STORE_ENV_KEY_RE.test(k))
  if (disallowed.length > 0) {
    throw new Error(`[vercel] refusing to set non-store env vars on a store project: ${disallowed.join(', ')}`)
  }

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
        projectSettings: STORE_DEPLOYMENT_SETTINGS,
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
        projectSettings: STORE_DEPLOYMENT_SETTINGS,
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

  // Attach subdomain and use it as the canonical URL once the domain is on THIS project.
  // verified=false just means DNS isn't confirmed yet — Vercel will start routing as soon as it propagates.
  // SECURITY: an attach error is no longer swallowed. attachDomain already treats
  // "already attached to this same project" as success, so any error left means the
  // host belongs to another project (another tenant) — reporting it as our URL would
  // show the merchant someone else's site. Fall back to the raw deployment URL.
  if (storeSlug && HOSTING_ROOT_DOMAIN) {
    if (!STORE_SLUG_RE.test(storeSlug)) {
      console.error('[vercel] createPreviewDeployment: refusing invalid store slug', { storeSlug })
      return { deploymentId: id, url: rawUrl }
    }
    const storeDomain = `${storeSlug}.${HOSTING_ROOT_DOMAIN}`
    try {
      await attachDomain(vercelProjectId, storeDomain)
    } catch (err) {
      console.error('[vercel] attachDomain failed — subdomain unavailable for this project:', {
        storeDomain,
        project: vercelProjectId,
        ...summarizeDeploymentFailure(err),
      })
      return { deploymentId: id, url: rawUrl }
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
        projectSettings: STORE_DEPLOYMENT_SETTINGS,
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
  if (!token) throw new Error('VERCEL_TOKEN is not configured')
  const teamParam = TEAM_ID ? `&teamId=${encodeURIComponent(TEAM_ID)}` : ''
  const url = `https://api.vercel.com/v2/deployments/${encodeURIComponent(deploymentId)}/events?direction=forward&follow=1${teamParam}`

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
  const result = await vercelApiFetch<{ readyState?: string; url?: string; target?: string | null }>(
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
  )
  return {
    state: mapReadyState(result.readyState),
    url: result.url ? `https://${result.url}` : undefined,
    // 'production' for production-target deployments, null for previews.
    target: typeof result.target === 'string' ? result.target : null,
  }
}

export async function getBuildError(deploymentId: string): Promise<string> {
  try {
    const token = process.env.VERCEL_TOKEN
    if (!token) return 'Build failed — no details available.'
    const teamParam = TEAM_ID ? `&teamId=${encodeURIComponent(TEAM_ID)}` : ''
    const res = await fetch(
      `https://api.vercel.com/v2/deployments/${encodeURIComponent(deploymentId)}/events?type=stderr&direction=backward&limit=20${teamParam}`,
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

interface ProjectDomainResponse {
  name?: string
  projectId?: string
  verified?: boolean
  verification?: Array<{ type?: string; domain?: string; value?: string }>
}

// GET /v9/projects/{id}/domains/{domain} → the domain config only if it is attached to
// THAT project; null otherwise (404, or any lookup failure — callers treat null as
// "not ours").
async function getProjectDomain(vercelProjectId: string, domain: string): Promise<ProjectDomainResponse | null> {
  try {
    const res = await vercelApiFetch<ProjectDomainResponse>(
      `/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(domain)}`,
    )
    if (!res || typeof res !== 'object') return null
    if (res.name && res.name.toLowerCase() !== domain.toLowerCase()) return null
    if (res.projectId && res.projectId !== vercelProjectId) return null
    return res
  } catch {
    return null
  }
}

// SECURITY: Vercel answers an "add domain" with an error (409 / domain_already_in_use)
// both when the domain is already on THIS project and when a different project in the
// shared team owns it. Only the former is success; the latter now throws so callers
// can't silently report another tenant's host as their own.
export async function attachDomain(
  vercelProjectId: string,
  domain: string,
): Promise<{ verified: boolean; dnsInstructions?: string }> {
  let result: ProjectDomainResponse
  try {
    result = await vercelApiFetch<ProjectDomainResponse>(
      `/v10/projects/${encodeURIComponent(vercelProjectId)}/domains`,
      {
        method: 'POST',
        body: { name: domain },
      },
    )
  } catch (err) {
    const ownDomain = await getProjectDomain(vercelProjectId, domain)
    if (!ownDomain) throw err
    result = ownDomain
  }

  if (result.verified) return { verified: true }

  const record = result.verification?.[0]
  const dnsInstructions = record?.type === 'TXT'
    ? `Add TXT record on ${record.domain} with value: ${record.value}`
    : `Add CNAME: ${domain} → cname.vercel-dns.com`

  return { verified: false, dnsInstructions }
}

/**
 * Whether the public DNS for `domain` actually points at Vercel
 * (GET /v6/domains/{domain}/config → misconfigured === false). Unlike the `verified`
 * flag from attachDomain — which inside Quante's own team is true for any domain no
 * other Vercel account claims, with no DNS proof at all — this only turns true once
 * whoever controls the zone has created the records. Returns null when Vercel can't be
 * asked (callers must treat null as "not proven").
 */
export async function getDomainDnsConfigured(domain: string): Promise<boolean | null> {
  try {
    const res = await vercelApiFetch<{ misconfigured?: boolean }>(
      `/v6/domains/${encodeURIComponent(domain)}/config`,
    )
    return typeof res?.misconfigured === 'boolean' ? !res.misconfigured : null
  } catch (err) {
    console.error('[vercel] domain config lookup failed', { domain, ...summarizeDeploymentFailure(err) })
    return null
  }
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
