// Server-only. Parse the generated store's data/config.ts (StoreConfig object literal),
// same approach as lib/store-products.ts for data/products.ts: extract the literal with a
// brace-depth scanner and parse it with JSON5 (tolerates unquoted keys, single quotes,
// trailing commas). No code execution. Read-only today — no callers need to rewrite
// config.ts yet, so there's no serializeConfigFile() counterpart (unlike products).

import JSON5 from 'json5'
import type { StoreConfig } from '@/types/store-code'

export const CONFIG_FILE = 'data/config.ts'

// Matches `export const config: StoreConfig = { ... }` as written by
// lib/store-template/build.ts. Returns null when the file deviates too far from a plain
// object literal (template strings, spread, computed values) — callers must degrade
// gracefully rather than guess.
export function parseConfigFile(content: string): StoreConfig | null {
  const assignMatch = content.match(/config\s*(?::\s*[A-Za-z0-9_$[\]<>,.\s]+)?=\s*\{/)
  if (!assignMatch || assignMatch.index === undefined) return null

  const start = assignMatch.index + assignMatch[0].length - 1
  let depth = 0
  let end = -1
  let inString: string | null = null
  let escaped = false

  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  const literal = content.slice(start, end + 1)
  try {
    const parsed: unknown = JSON5.parse(literal)
    if (!isStoreConfigLike(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function isStoreConfigLike(c: unknown): c is StoreConfig {
  if (typeof c !== 'object' || c === null) return false
  const o = c as Record<string, unknown>
  if (typeof o.brand !== 'object' || o.brand === null) return false
  if (typeof o.design !== 'object' || o.design === null) return false
  const brand = o.brand as Record<string, unknown>
  const design = o.design as Record<string, unknown>
  return (
    typeof brand.name === 'string' &&
    typeof design.colors === 'object' && design.colors !== null &&
    typeof design.fonts === 'object' && design.fonts !== null
  )
}
