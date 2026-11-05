// Qbox engine interface. Server-only.
//
// The API (app/api/qbox/v1) talks only to this interface, so the engine underneath can change
// (Vercel Sandbox today; later our own Firecracker nodes, plan phase 1) without changing anything
// a customer sees. An engine never learns who the member is beyond an opaque tag.

import type { QboxNetwork, QboxTemplate } from './model'

export interface EngineCreate {
  /** Our sandbox id; the engine uses it as its name, so `get` needs nothing else. */
  id: string
  template: QboxTemplate
  timeoutMs: number
  ports: number[]
  /** open = internet, registries = QBOX_REGISTRY_DOMAINS only, none = no network. */
  network: QboxNetwork
  env: Record<string, string>
  vcpus: number
  tags: Record<string, string>
}

export interface EngineExec {
  cmd: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  timeoutMs: number
}

export interface EngineExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SandboxEngine {
  readonly name: string
  create(input: EngineCreate): Promise<void>
  exec(id: string, input: EngineExec): Promise<EngineExecResult>
  writeFile(id: string, path: string, content: Uint8Array): Promise<void>
  /** null when the file does not exist. */
  readFile(id: string, path: string): Promise<Buffer | null>
  previewUrl(id: string, port: number): Promise<string | null>
  /** Stops and deletes the sandbox; a sandbox that is already gone is not an error. */
  kill(id: string): Promise<void>
}

export class EngineUnavailableError extends Error {}
/** The sandbox no longer exists in the engine (timed out or stopped). */
export class SandboxGoneError extends Error {}
