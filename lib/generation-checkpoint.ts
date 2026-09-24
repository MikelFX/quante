// Shared helpers for /api/quante/generate's checkpointing (Level 1 of the "device dies
// mid-generation" fix — see docs/update-log.md and supabase/migration-generation-jobs.sql).
//
// extractFileBlocks() is the single source of truth for "what complete files exist in this
// raw Claude output so far" — used both by the route's final parseCodeOutput() (which then
// validates CORE_FILES are present) and by the periodic in-flight checkpoint (which just
// wants whatever's done so far, no validation, safe to call on partial/incomplete output).

export type GenerationJobStatus = 'running' | 'completed' | 'failed'

const FILE_BLOCK_RE = /<file path="([^"]+)">([\s\S]*?)<\/file>/g

/**
 * Extracts every *complete* <file path="...">...</file> block from raw model output.
 * A block that hasn't been closed yet (the model is still mid-way through writing it)
 * simply won't match — it's silently omitted, not an error. Safe to call repeatedly on a
 * growing string; each call re-scans from scratch (regexes are stateless here since we
 * always pass a fresh RegExp — `g` flag state is per-exec-call only when reusing the same
 * instance, so a fresh literal per call, as used below, avoids lastIndex bugs entirely).
 */
export function extractFileBlocks(raw: string): Record<string, string> {
  const files: Record<string, string> = {}
  const re = new RegExp(FILE_BLOCK_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    files[match[1].trim()] = match[2].replace(/^\n/, '').replace(/\n$/, '')
  }
  return files
}

/** An AI-produced file removed by filterAiStoreFiles() (lib/store-template/build.ts). */
export interface DroppedFile {
  path: string
  reason: string
}

const MAX_DROPPED_REPORTED = 50
const MAX_DROPPED_PATH_CHARS = 200

/**
 * Bounds the dropped-file list before it is stored (generation_jobs.dropped_files) or
 * sent to the Studio (`droppedFiles` in the generate status / iterate / fix payloads).
 * Paths come straight from model output, so they are capped in count and length.
 */
export function normalizeDroppedFiles(dropped: ReadonlyArray<DroppedFile>): DroppedFile[] {
  const seen = new Set<string>()
  const out: DroppedFile[] = []
  for (const d of dropped) {
    const path = String(d.path ?? '').slice(0, MAX_DROPPED_PATH_CHARS)
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, reason: String(d.reason ?? '').slice(0, 200) })
    if (out.length >= MAX_DROPPED_REPORTED) break
  }
  return out
}

/**
 * Appended (server-side) to the generate / iterate / fix user message. filterAiStoreFiles()
 * rejects a whole .ts/.tsx file when one of these words appears as a bare token — also
 * inside ordinary copy (`tags: ['global']`, `<dt>Function</dt>`), which used to fail
 * legitimate stores. Telling the model up front avoids most of those false positives.
 * Keep in sync with AI_FORBIDDEN_IDENTS / AI_FORBIDDEN_CODE in lib/store-template/build.ts.
 */
export const AI_FILTER_PROMPT_NOTE =
  '[Platform constraint — every .ts/.tsx file you write is checked by an automated safety filter, ' +
  'and a file that fails it is discarded. Words inside string values, JSX text and comments are fine. ' +
  'In CODE (identifiers, variables, object keys written without quotes) never use: process (except reading ' +
  'process.env.NEXT_PUBLIC_* or process.env.NODE_ENV), global, globalThis, eval, Function, require, module; ' +
  'never access .constructor or __proto__, never use a string that is exactly "constructor" or "__proto__"; ' +
  'no XMLHttpRequest, WebSocket, EventSource or sendBeacon; no fetch() to absolute/external URLs; no dynamic ' +
  'import() with a computed path; no Node built-in imports (fs, child_process, crypto, …), no next/headers or ' +
  'next/server imports, no imports from lib/platform or app/api; no "use server"; no route segment config ' +
  '(maxDuration/runtime/preferredRegion exports). Never use \\u escapes for plain ASCII letters.]'

/** Just the paths, for the additive `droppedFiles: string[]` response field. */
export function droppedFilePaths(dropped: ReadonlyArray<DroppedFile>): string[] {
  return normalizeDroppedFiles(dropped).map((d) => d.path)
}

/** Short human-readable list for user-facing messages: "a.tsx (forbidden code: global), …". */
export function describeDroppedFiles(dropped: ReadonlyArray<DroppedFile>, max = 5): string {
  const list = normalizeDroppedFiles(dropped)
  const shown = list.slice(0, max).map((d) => `${d.path.slice(0, 120)} (${d.reason.slice(0, 80)})`)
  if (list.length > max) shown.push(`${list.length - max} more`)
  return shown.join(', ')
}

/**
 * Cheap "did the set of complete files change since the last checkpoint" check, so callers
 * can skip a DB write when nothing new has landed since the last tick (e.g. Claude is mid-
 * way through a long file — same file count, same content, no point re-saving raw_output
 * that also hasn't meaningfully changed... though callers may still choose to checkpoint
 * raw_output on a time cadence regardless, since even an in-progress trailing file's prose
 * is useful context on crash recovery. This helper is about the *files* snapshot only.
 */
export function filesChanged(previous: Record<string, string>, next: Record<string, string>): boolean {
  const prevKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return true
  for (const key of nextKeys) {
    if (previous[key] !== next[key]) return true
  }
  return false
}
