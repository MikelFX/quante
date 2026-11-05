// Qbox engine on Vercel Sandbox (Firecracker microVMs run by Vercel). Server-only.
//
// Same credentials as the visual editor (lib/editor/sandbox.ts). The region comes from
// QBOX_SANDBOX_REGION (e.g. "fra1"); unset = Vercel's default (iad1, USA). Our platform secrets
// never enter a sandbox: only the member's own `env` is passed in.

import { Sandbox } from '@vercel/sandbox'
import { EngineUnavailableError, SandboxGoneError, type EngineCreate, type EngineExec, type EngineExecResult, type SandboxEngine } from './provider'
import { QBOX_REGISTRY_DOMAINS, SANDBOX_HOME, type QboxNetwork } from './model'

/** Our network modes as a Vercel Sandbox firewall policy (domain rules match HTTPS by SNI). */
export function vercelNetworkPolicy(network: QboxNetwork) {
  if (network === 'open') return 'allow-all' as const
  if (network === 'none') return 'deny-all' as const
  return { allow: [...QBOX_REGISTRY_DOMAINS] }
}

function credentials() {
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.SANDBOX_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) throw new EngineUnavailableError('Sandbox engine is not configured.')
  return { token, teamId, projectId }
}

function isNotFound(err: unknown): boolean {
  const s = (err as { response?: { status?: number } } | null)?.response?.status
  return s === 404 || s === 410 || /not[_ ]found|gone/i.test(String((err as Error)?.message ?? ''))
}

const engineName = (id: string) => `qbx-${id}`

async function open(id: string): Promise<Sandbox> {
  try {
    const sb = await Sandbox.get({ ...credentials(), name: engineName(id), resume: false })
    if (!['running', 'pending'].includes(String(sb.status))) throw new SandboxGoneError('The sandbox has stopped.')
    return sb
  } catch (err) {
    if (err instanceof SandboxGoneError || err instanceof EngineUnavailableError) throw err
    if (isNotFound(err)) throw new SandboxGoneError('The sandbox has stopped.')
    throw err
  }
}

export const vercelEngine: SandboxEngine = {
  name: 'vercel',

  async create(input: EngineCreate) {
    const region = process.env.QBOX_SANDBOX_REGION?.trim() || undefined
    await Sandbox.create({
      ...credentials(),
      name: engineName(input.id),
      runtime: input.template,
      timeout: input.timeoutMs,
      ports: input.ports,
      resources: { vcpus: input.vcpus },
      networkPolicy: vercelNetworkPolicy(input.network),
      env: input.env,
      tags: { kind: 'qbox', ...input.tags },
      ...(region ? { region } : {}),
    })
  },

  async exec(id: string, input: EngineExec): Promise<EngineExecResult> {
    const sb = await open(id)
    const signal = AbortSignal.timeout(input.timeoutMs)
    try {
      const done = await sb.runCommand({ cmd: input.cmd, args: input.args, cwd: input.cwd ?? SANDBOX_HOME, env: input.env, signal })
      const [stdout, stderr] = await Promise.all([done.stdout(), done.stderr()])
      return { exitCode: done.exitCode, stdout, stderr, timedOut: false }
    } catch (err) {
      if (signal.aborted) return { exitCode: null, stdout: '', stderr: `Command stopped after ${Math.round(input.timeoutMs / 1000)} s.`, timedOut: true }
      if (isNotFound(err)) throw new SandboxGoneError('The sandbox has stopped.')
      throw err
    }
  },

  async writeFile(id, path, content) {
    const sb = await open(id)
    const dir = path.slice(0, path.lastIndexOf('/'))
    if (dir && dir !== SANDBOX_HOME) await sb.runCommand({ cmd: 'mkdir', args: ['-p', dir] })
    await sb.writeFiles([{ path, content }])
  },

  async readFile(id, path) {
    const sb = await open(id)
    return sb.readFileToBuffer({ path })
  },

  async previewUrl(id, port) {
    const sb = await open(id)
    try {
      return sb.domain(port)
    } catch {
      return null
    }
  },

  async kill(id) {
    let sb: Sandbox
    try {
      sb = await Sandbox.get({ ...credentials(), name: engineName(id), resume: false })
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
    await sb.delete({ deleteOrphanSnapshots: true }).catch(async () => {
      await sb.stop().catch(() => {})
    })
  },
}

/** The engine the API uses. One place to switch when our own nodes exist. */
export function engine(): SandboxEngine {
  return vercelEngine
}
