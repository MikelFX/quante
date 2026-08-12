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
