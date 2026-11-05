// "Run code once" for AI agents (pure, no I/O): the input of the paid one-shot Qbox run — one
// snippet of Python, JavaScript or shell in a fresh sandbox with NO network, then the sandbox is
// gone. For agents that need to compute, parse or test something and have no sandbox account.
// lib/agents/agent-tools.ts runs it on the Qbox engine. Tested in __tests__/agent-tools.test.mjs.
import type { QboxTemplate } from '@/lib/qbox/limits'

export const RUN_ONCE = {
  /** Longest a snippet may run. */
  execMs: 40_000,
  /** The sandbox's whole life (start + run + stop). */
  lifetimeMs: 60_000,
  vcpus: 1,
  maxCodeChars: 20_000,
  maxStdinChars: 100_000,
  /** One-shot runs alive at the same time, across all agents (on top of Qbox's global cap). */
  concurrent: 5,
  /** The `user_id` the runs are recorded under in qbox_sandboxes (no account behind it). */
  userId: 'agent_x402_run',
} as const

export const RUN_LANGUAGES = ['python', 'javascript', 'shell'] as const
export type RunLanguage = (typeof RUN_LANGUAGES)[number]

export interface RunOnceInput {
  language: RunLanguage
  template: QboxTemplate
  cmd: string
  args: string[]
  stdin: string | null
}

export class RunInputError extends Error {}

/** { language, code, stdin? } → what to start and run. */
export function parseRunOnce(body: unknown): RunOnceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RunInputError('Send { "language": "python" | "javascript" | "shell", "code": "…" }.')
  const b = body as Record<string, unknown>
  const lang = b.language === 'js' || b.language === 'node' ? 'javascript' : b.language === 'py' ? 'python' : b.language === 'sh' || b.language === 'bash' ? 'shell' : b.language
  if (!(RUN_LANGUAGES as readonly unknown[]).includes(lang)) throw new RunInputError('language must be "python", "javascript" or "shell".')
  if (typeof b.code !== 'string' || !b.code.trim()) throw new RunInputError('code must be a non-empty string.')
  if (b.code.length > RUN_ONCE.maxCodeChars || b.code.includes('\0')) throw new RunInputError(`code must be at most ${RUN_ONCE.maxCodeChars} characters.`)
  let stdin: string | null = null
  if (b.stdin !== undefined && b.stdin !== null) {
    if (typeof b.stdin !== 'string' || b.stdin.length > RUN_ONCE.maxStdinChars || b.stdin.includes('\0')) throw new RunInputError(`stdin must be a string of at most ${RUN_ONCE.maxStdinChars} characters.`)
    stdin = b.stdin
  }
  const language = lang as RunLanguage
  if (language === 'python') return { language, template: 'python3.13', cmd: 'python3', args: ['-c', b.code], stdin }
  if (language === 'javascript') return { language, template: 'node24', cmd: 'node', args: ['-e', b.code], stdin }
  return { language, template: 'node24', cmd: 'sh', args: ['-c', b.code], stdin }
}
