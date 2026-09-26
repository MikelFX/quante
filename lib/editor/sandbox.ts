// Visual editor v1 — editing sandboxes on Vercel Sandbox (2026-09-26). Server-only.
//
// Layout (measured in the spike, docs/update-log.md 2026-09-26):
//   - one persistent BASE sandbox per store package.json (`qe-editor-base-<hash>`): only
//     package.json + node_modules (npm install ~17 s, created on first use, then stopped
//     so its filesystem is kept as a snapshot, ~500 MB);
//   - one SESSION sandbox per project (`qe-editor-<projectId>`), forked from the base
//     (~1.3 s), with the store's files written in and `next dev` on port 3000 (first
//     page ~7 s, HMR ~0.5 s). Short timeout, kept alive by the Studio's heartbeat, so a
//     closed tab costs at most EDITOR_IDLE_MS of sandbox time. Deleted on "Done".
// No database state: sessions are found by name, a user's sessions by tag.

import { createHash } from 'node:crypto'
import { Sandbox } from '@vercel/sandbox'

const ROOT = '/vercel/sandbox'
const PORT = 3000
/** A session dies this long after the last heartbeat. */
export const EDITOR_IDLE_MS = 8 * 60 * 1000
/** Hard cap on one editing session (heartbeats stop extending it after this). */
export const EDITOR_MAX_SESSION_MS = 60 * 60 * 1000
/** Parallel editing sessions per user (other projects). */
export const EDITOR_MAX_SESSIONS_PER_USER = 2
const DEV_READY_TIMEOUT_MS = 45_000

export class EditorUnavailableError extends Error {}

function credentials() {
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.SANDBOX_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) throw new EditorUnavailableError('Visual editor is not configured (sandbox credentials missing).')
  return { token, teamId, projectId }
}

function status404(err: unknown): boolean {
  const s = (err as { response?: { status?: number } } | null)?.response?.status
  return s === 404 || /not[_ ]found/i.test(String((err as Error)?.message ?? ''))
}

async function tryGet(name: string): Promise<Sandbox | null> {
  try {
    return await Sandbox.get({ ...credentials(), name })
  } catch (err) {
    if (status404(err)) return null
    throw err
  }
}

export function sessionName(projectId: string): string {
  return `qe-editor-${projectId}`
}

function baseName(packageJson: string): string {
  return `qe-editor-base-${createHash('sha256').update(packageJson).digest('hex').slice(0, 12)}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The base sandbox for this package.json, created (npm install) on first use. */
async function ensureBase(packageJson: string): Promise<string> {
  const name = baseName(packageJson)
  for (let attempt = 0; attempt < 30; attempt++) {
    const existing = await tryGet(name)
    if (existing) {
      if (existing.status === 'stopped') return name
      // Another request is installing it (or a stop is persisting it) — wait.
      if (['running', 'pending', 'stopping', 'snapshotting'].includes(existing.status)) { await sleep(3000); continue }
      await existing.delete({ deleteOrphanSnapshots: true }).catch(() => {})
      continue
    }
    let base: Sandbox
    try {
      base = await Sandbox.create({
        ...credentials(), name, runtime: 'node24', persistent: true, resources: { vcpus: 2 },
        timeout: 5 * 60 * 1000, tags: { kind: 'quante-editor-base' },
      })
    } catch {
      await sleep(2000) // lost a creation race — the other request's base shows up above
      continue
    }
    try {
      await base.writeFiles([{ path: `${ROOT}/package.json`, content: Buffer.from(packageJson) }])
      const r = await base.runCommand({ cmd: 'npm', args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], cwd: ROOT })
      if (r.exitCode !== 0) throw new Error(`npm install failed: ${(await r.stderr()).slice(-500)}`)
      await base.stop() // persists the filesystem
      return name
    } catch (err) {
      await base.delete({ deleteOrphanSnapshots: true }).catch(() => {})
      throw err
    }
  }
  throw new EditorUnavailableError('The editor environment is still being prepared — try again in a minute.')
}

async function devServerUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    return res.status < 500
  } catch {
    return false
  }
}

async function startDevServer(sb: Sandbox): Promise<string> {
  await sb.runCommand({
    cmd: 'sh',
    args: ['-c', 'npx next dev -p 3000 -H 0.0.0.0 > /tmp/next-dev.log 2>&1'],
    cwd: ROOT,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
    detached: true,
  })
  const url = sb.domain(PORT)
  const deadline = Date.now() + DEV_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (res.status < 500) return url
      if (res.status === 500) {
        // A compile error in the store code — surface the dev server's own message.
        const log = await sb.runCommand({ cmd: 'sh', args: ['-c', 'tail -c 1500 /tmp/next-dev.log'], cwd: ROOT })
        throw new Error(`The store failed to compile in the editor:\n${(await log.stdout()).slice(-1200)}`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('The store failed')) throw err
    }
    await sleep(1000)
  }
  throw new Error('The editor preview did not start in time.')
}

export interface SandboxFile { path: string; content: string | Buffer }

function toWrite(files: SandboxFile[]) {
  return files.map((f) => ({ path: `${ROOT}/${f.path}`, content: typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content }))
}

/** Sessions of this user that are running for OTHER projects. */
export async function otherActiveSessions(userId: string, projectId: string): Promise<number> {
  const list = await Sandbox.list({ ...credentials(), tags: { user: userId } })
  const all = await list.toArray()
  return all.filter((s) => s.name !== sessionName(projectId) && ['running', 'pending'].includes(s.status)).length
}

/**
 * Starts (or reuses) the project's editing sandbox with `files` (the complete store,
 * instrumented) and returns the preview URL once the dev server answers.
 */
export async function startEditorSession(opts: { projectId: string; userId: string; files: SandboxFile[] }): Promise<{ url: string; reused: boolean }> {
  const name = sessionName(opts.projectId)
  const existing = await tryGet(name)
  if (existing && existing.status === 'running') {
    await existing.writeFiles(toWrite(opts.files))
    const url = existing.domain(PORT)
    if (await devServerUp(url)) return { url, reused: true }
    return { url: await startDevServer(existing), reused: true }
  }
  if (existing) await existing.delete({ deleteOrphanSnapshots: true }).catch(() => {})

  const pkg = opts.files.find((f) => f.path === 'package.json')
  if (!pkg) throw new Error('Store files have no package.json.')
  const base = await ensureBase(typeof pkg.content === 'string' ? pkg.content : pkg.content.toString('utf8'))

  const sb = await Sandbox.fork({
    ...credentials(),
    sourceSandbox: base,
    name,
    persistent: false,
    ports: [PORT],
    timeout: EDITOR_IDLE_MS,
    resources: { vcpus: 2 },
    tags: { kind: 'quante-editor', project: opts.projectId, user: opts.userId },
  })
  try {
    const check = await sb.runCommand({ cmd: 'test', args: ['-x', 'node_modules/.bin/next'], cwd: ROOT })
    if (check.exitCode !== 0) {
      // A broken base (interrupted install) — drop it so the next start rebuilds it.
      const b = await tryGet(base)
      await b?.delete({ deleteOrphanSnapshots: true }).catch(() => {})
      throw new EditorUnavailableError('The editor environment was incomplete and has been reset — try again.')
    }
    await sb.writeFiles(toWrite(opts.files))
    return { url: await startDevServer(sb), reused: false }
  } catch (err) {
    await sb.stop().catch(() => {})
    await sb.delete().catch(() => {})
    throw err
  }
}

/** Writes changed files into a running session (hot reload picks them up). false = no running session. */
export async function writeEditorFiles(projectId: string, files: SandboxFile[]): Promise<boolean> {
  const sb = await tryGet(sessionName(projectId))
  if (!sb || sb.status !== 'running') return false
  await sb.writeFiles(toWrite(files))
  return true
}

/** Keeps a session alive (up to EDITOR_MAX_SESSION_MS). */
export async function heartbeatEditorSession(projectId: string): Promise<{ running: boolean; capped?: boolean }> {
  const sb = await tryGet(sessionName(projectId))
  if (!sb || sb.status !== 'running') return { running: false }
  if (Date.now() - sb.createdAt.getTime() > EDITOR_MAX_SESSION_MS) return { running: true, capped: true }
  await sb.extendTimeout(60_000)
  return { running: true }
}

export async function stopEditorSession(projectId: string): Promise<void> {
  const sb = await tryGet(sessionName(projectId))
  if (!sb) return
  await sb.stop().catch(() => {})
  await sb.delete({ deleteOrphanSnapshots: true }).catch(() => {})
}
