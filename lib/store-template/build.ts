// Build the Next.js source tree for a generated storefront.
// Supports two modes:
//   1. Legacy manifest mode: buildStoreFiles(manifest, customComponents?)
//      Used by /api/export and the old /api/deploy
//   2. Code-gen mode: buildStoreFiles(codeFiles)
//      Used by the new /api/quante/generate, /api/quante/iterate, /api/quante/fix
//      Provides a scaffold and merges AI-generated files on top of it.
//
// Output paths are POSIX, relative to the project root (no leading slash, no slug prefix).

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import type { ShopManifest } from '@/types/manifest'
import type { CodeVersionFiles } from '@/types/store-code'

export interface GeneratedFile {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

export function toStoreSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Version of the platform-owned code-gen scaffold (buildCodeGenScaffold + the LOCKED
// files forced in buildStoreFiles). BUMP THIS whenever the LOCKED / scaffold output
// changes in a way live stores should receive — the scaffold rollout
// (lib/hosting/scaffold-rollout.ts, /api/cron/scaffold-rollout, Admin → Store updates)
// then redeploys every live store's currently LIVE code version with the new scaffold.
// Recorded per build in deployments.scaffold_version (supabase/migration-scaffold-version.sql).
//   1 = everything deployed before deployments.scaffold_version existed (NULL rows)
//   2 = security refactor 2026-09 (keyed checkout proxy, AI file filter, locked config)
export const SCAFFOLD_VERSION = 2

export interface CustomComponentRecord {
  ref: string
  name: string
  code: string
}

// ─── Shared generated files (both scaffolds) ─────────────────────────────────

// next.config.ts. Security: stores may only be framed by themselves and by the
// Studio preview (quantecode.com). The legacy scaffold's /admin panel is never
// frameable at all (its "mark as shipped" buttons were clickjackable).
function buildNextConfig(withAdmin: boolean): string {
  const adminRules = withAdmin
    ? `
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/api/admin/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },`
    : ''
  return `import type { NextConfig } from 'next'

const FRAME_ANCESTORS = "frame-ancestors 'self' https://quantecode.com https://*.quantecode.com"

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: FRAME_ANCESTORS }] },${adminRules}
    ]
  },
}
export default nextConfig
`
}

// lib/platform.ts — hosted-mode helpers. Security:
//  - fails closed when QUANTE_API_URL is missing/malformed (no hard-coded fallback
//    host that someone else could register and receive carts + the store API key);
//  - only follows payment redirects to known providers or back to the store itself;
//  - never touches QUANTE_API_KEY (R9): it used to export platformHeaders(), which
//    let any page/component that imported this module read the store's key.
const PLATFORM_HELPER_TS = `// Hosted-mode helpers (server-side only).

// Base URL of the hosting platform. Returns null when QUANTE_API_URL is unset or
// not https (http is accepted for localhost only), so callers fail closed instead
// of falling back to a hard-coded host.
export function platformUrl(): string | null {
  const raw = process.env.QUANTE_API_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'https:' || (local && u.protocol === 'http:')) return u.origin
  } catch {}
  return null
}

// NOTE: nothing in this module reads QUANTE_API_KEY. The key is read only inside the
// locked route handlers (see storeKeyHeaders there), so page/component code cannot
// get at it by importing a shared helper.

// Origin of the incoming browser request (used for payment return URLs).
export function storeOriginOf(request: Request): string {
  const origin = request.headers.get('origin')
  if (origin) return origin
  const host = request.headers.get('host')
  return host ? 'https://' + host : 'http://localhost:3000'
}

// Shopper IP forwarded to the platform as x-quante-client-ip so its checkout rate
// limit keys on each shopper instead of this store's shared egress IP. The platform
// only trusts it alongside this store's API key. On Vercel these headers are set by
// the platform edge; an unparseable value is simply not forwarded.
export function shopperIpHeader(request: Request): Record<string, string> {
  const ip = request.headers.get('x-real-ip')?.trim()
    || (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return ip && /^[0-9A-Fa-f:.]{3,45}$/.test(ip) ? { 'x-quante-client-ip': ip } : {}
}

const PAYMENT_HOSTS = ['stripe.com', 'comgate.cz', 'gopay.cz', 'gopay.com', 'paypal.com']

// A checkout redirect is only followed when it points at a known payment provider
// or back at this store. Extra provider hosts can be allowed with
// PAYMENT_REDIRECT_HOSTS (comma-separated, e.g. a custom Stripe Checkout domain).
export function isAllowedRedirect(url: unknown, storeOrigin: string): url is string {
  if (typeof url !== 'string') return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  try { if (u.origin === new URL(storeOrigin).origin) return true } catch {}
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  const extra = (process.env.PAYMENT_REDIRECT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  return [...PAYMENT_HOSTS, ...extra].some((d) => host === d || host.endsWith('.' + d))
}

// Trimmed, length-capped string or undefined.
export function cleanString(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

export function cleanAddress(v: unknown): { ulice: string; mesto: string; psc: string; zeme?: string } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const a = v as Record<string, unknown>
  const ulice = cleanString(a.ulice), mesto = cleanString(a.mesto), psc = cleanString(a.psc, 20)
  if (!ulice || !mesto || !psc) return undefined
  return { ulice, mesto, psc, zeme: cleanString(a.zeme, 2) }
}
`

// Spliced into each LOCKED route handler that calls the platform with the store's
// API key. Deliberately a module-private function in the route file itself (route
// files cannot be imported by AI code: rejectAiStoreFile refuses app/api imports),
// never an export of a shared module.
const STORE_KEY_HEADERS_FN = `// Request headers carrying this store's API key. Read only here, inside this
// locked route handler — never exported from a module other code could import.
function storeKeyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.QUANTE_API_KEY
  return key ? { ...extra, Authorization: 'Bearer ' + key } : { ...extra }
}`

// ─── AI file allowlist (security) ────────────────────────────────────────────
// Generated code is deployed into Quante's own Vercel team, so AI-authored files
// are restricted to presentational code that slots into the hand-written engine
// (CLAUDE.md §2.3/§4.3). Everything else — route handlers, middleware/proxy,
// instrumentation, vercel.json, package.json, next.config, dotfiles, public/ —
// is dropped. Exported so generate/iterate/fix/checkpoint can filter BEFORE
// storing code_versions; buildStoreFiles() re-applies it as defence in depth
// because rows saved before this check existed may already contain such files.

const AI_ALLOWED_ROOTS = new Set(['app', 'components', 'data', 'styles', 'lib', 'hooks', 'types'])
// Only these file names may be written under app/ — UI segments, never route
// handlers (route.ts) or metadata routes (sitemap.ts, robots.ts, opengraph-image…).
// The root app/layout.tsx is LOCKED separately.
const AI_ALLOWED_APP_FILES = new Set(['page.tsx', 'layout.tsx', 'template.tsx', 'not-found.tsx', 'loading.tsx', 'error.tsx'])
const AI_MAX_FILE_BYTES = 512 * 1024

export function isAllowedStorePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false
  if (p.includes('\\') || p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return false
  const segs = p.split('/')
  if (segs.length < 2 || segs.length > 10) return false
  for (const s of segs) {
    // No empty, ".", ".." or hidden (".env", ".npmrc", ".vercel") segments.
    if (!s || s.startsWith('.') || !/^[A-Za-z0-9_\-[\]().]+$/.test(s)) return false
  }
  if (!AI_ALLOWED_ROOTS.has(segs[0])) return false
  const file = segs[segs.length - 1]
  if (!/\.(tsx|ts|css)$/.test(file)) return false
  // Root-level middleware/proxy/instrumentation and pages/ are already excluded by
  // AI_ALLOWED_ROOTS; under app/ only page-like files are allowed (no route.ts).
  if (segs[0] === 'app') {
    if (segs[1] === 'api') return false
    if (file.endsWith('.css')) return true
    return AI_ALLOWED_APP_FILES.has(file)
  }
  return true
}

// Server-only capabilities AI presentational code never needs. Best-effort static
// check — the path allowlist above is the primary control.
//
// The checks run on a tokenized view of each .ts/.tsx file (scanSource below):
// string literals, template text, comments, regex bodies and JSX text are blanked
// out first, so copy such as `tags: ['global']`, `label: 'Function'` or
// `<p>Global shipping</p>` no longer drops a legitimate file, while real code
// usages (identifiers, member accesses, imports) are still rejected. Where the lexer
// has to guess (regex vs division, JSX vs less-than/generics) it always picks the
// reading that scans MORE text as code, so a guess can only make the check stricter.
// A file the lexer cannot follow falls back to the stricter raw-text checks
// (AI_FORBIDDEN_CODE + findForbiddenIdentRaw), which is the old behaviour.

// Raw-text checks — used only when scanSource() cannot tokenize a file.
const AI_FORBIDDEN_CODE: Array<{ re: RegExp; why: string }> = [
  { re: /['"]use server['"]/, why: "'use server' (server actions)" },
  { re: /export\s+(?:const|let|var|async\s+function|function)\s+(?:maxDuration|runtime|preferredRegion)\b/, why: 'route segment config' },
  { re: /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"`](?:node:[^'"`]*|child_process|fs|fs\/promises|net|tls|dgram|dns|cluster|worker_threads|http|https|http2|os|vm|v8|inspector|module|perf_hooks|async_hooks|process|crypto|stream)['"`]/, why: 'Node built-in import' },
  // Request headers/cookies (incl. platform-injected tokens) and route-handler APIs.
  { re: /(?:\bfrom\s*|\bimport\s*\(\s*)['"`]next\/(?:headers|server)['"`]/, why: 'next/headers or next/server import' },
  // Dynamic import() of anything but a plain string literal (e.g. 'no' + 'de:fs').
  { re: /\bimport\s*\(\s*(?!['"][^'"`+]*['"]\s*\))/, why: 'computed dynamic import()' },
  // \u escapes of ASCII letters/$/_ let an identifier dodge the word checks below
  // (process === process). Copy text never needs to escape plain ASCII.
  { re: /\\u(?:\{0*(?:24|5f|[46][1-9a-f]|[57][0-9a])\}|00(?:24|5f|[46][1-9a-f]|[57][0-9a]))/i, why: 'unicode-escaped identifier' },
  // Reaching Function through a prototype: [].map.constructor('…')().
  { re: /\.\s*constructor\b|['"`]constructor['"`]/, why: 'constructor access' },
  // Outbound requests to another host (skimming / exfiltration).
  { re: /(?<![\w$])fetch\s*\(\s*['"`]\s*(?:[A-Za-z][A-Za-z0-9+.-]*:|[\\/]{2})/, why: 'fetch to an external URL' },
  { re: /(?<![\w$])(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)(?![\w$])/, why: 'network API' },
]

// Identifiers that give AI code the Node runtime (process.env secrets, require,
// eval/Function). Any use in code is rejected — not just the obvious `process.env.X`
// spelling, since `const { env } = process`, `(0, eval)(…)` or `Function('…')`
// work just as well. The only exception is the build-time-inlined public env reads
// (NEXT_PUBLIC_* / NODE_ENV): those values are public by definition (Next inlines
// them into the browser bundle) and the generation prompt allows them, so older
// stores that read e.g. NEXT_PUBLIC_SITE_URL keep deploying. Server secrets
// (QUANTE_API_KEY, STRIPE_SECRET_KEY …) never match that pattern.
const AI_FORBIDDEN_IDENTS = ['process', 'globalThis', 'global', 'eval', 'Function', 'require', 'module', '__non_webpack_require__']
const AI_ALLOWED_PROCESS_USE = /^process\s*\.\s*env\s*\.\s*(?:NEXT_PUBLIC_[A-Z0-9_]+|NODE_ENV)(?![A-Za-z0-9_$])/
// Property names that reach the runtime or Function when used as a computed key
// (`x['eval']`, `x['con' + 'structor']`).
const AI_FORBIDDEN_KEYS = new Set([...AI_FORBIDDEN_IDENTS, 'constructor', '__proto__'])
// Network primitives presentational code never needs.
const AI_FORBIDDEN_NETWORK = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']
const NODE_BUILTIN_MODULE = /^(?:node:.*|child_process|fs|fs\/promises|net|tls|dgram|dns|cluster|worker_threads|http|https|http2|os|vm|v8|inspector|module|perf_hooks|async_hooks|process|crypto|stream)(?:\/.*)?$/
const ROUTE_CONFIG_RE = /export\s+(?:const|let|var|async\s+function|function)\s+(?:maxDuration|runtime|preferredRegion)(?![\w$])/
// Code right before a string literal that makes the literal a module specifier.
const MODULE_SPECIFIER_BEFORE = /(?:(?<![\w$.])(?:from|import)|(?<![\w$.])(?:import|require)\s*\()\s*$/
// URL literals that leave the store: any scheme (https:, data: …) or protocol-relative.
const ABSOLUTE_URL_RE = /^\s*(?:[A-Za-z][A-Za-z0-9+.-]*:|[\\/]{2})/
// JSX text never legitimately looks like this; checked as defence in depth in case
// the lexer ever reads real code as JSX text.
const JSX_TEXT_CODE_RE = /\bprocess\s*(?:\.\s*env\b|\[)|\bglobalThis\b|__non_webpack_require__/

// JS/TS words that may legally sit next to an identifier on the same line
// (`return process`, `typeof process`, `process as any`, `x in process` …).
const JS_ADJACENT_KEYWORDS = new Set([
  'abstract', 'accessor', 'as', 'assert', 'asserts', 'async', 'await', 'case', 'catch', 'class', 'const', 'debugger',
  'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function',
  'get', 'if', 'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module',
  'namespace', 'new', 'of', 'out', 'override', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies',
  'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'unique', 'using', 'var', 'void',
  'while', 'with', 'yield',
])

// Raw-text fallback only. True when the word at [start, end) is plain prose ("our
// process is simple"): it has a non-keyword word right next to it on the same line,
// separated only by spaces/tabs. Two juxtaposed identifiers are a syntax error in
// code, so this can only match inside strings, comments or JSX text.
function isProseWord(src: string, start: number, end: number): boolean {
  const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c)
  const isIdentChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$\\]/.test(c)

  let i = start - 1
  while (i >= 0 && (src[i] === ' ' || src[i] === '\t')) i--
  if (i < start - 1 && isLetter(src[i])) {
    let j = i
    while (j >= 0 && isLetter(src[j])) j--
    if (!isIdentChar(src[j]) && !JS_ADJACENT_KEYWORDS.has(src.slice(j + 1, i + 1))) return true
  }

  let k = end
  while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++
  if (k > end && isLetter(src[k])) {
    let m = k
    while (m < src.length && isLetter(src[m])) m++
    if (!isIdentChar(src[m]) && !JS_ADJACENT_KEYWORDS.has(src.slice(k, m))) return true
  }
  return false
}

function findForbiddenIdentRaw(src: string): string | null {
  for (const ident of AI_FORBIDDEN_IDENTS) {
    const re = new RegExp(`(?<![A-Za-z0-9_$\\\\])${ident}(?![A-Za-z0-9_$])`, 'g')
    for (const m of src.matchAll(re)) {
      const start = m.index ?? 0
      if (ident === 'process' && AI_ALLOWED_PROCESS_USE.test(src.slice(start, start + 120))) continue
      if (isProseWord(src, start, start + ident.length)) continue
      return ident
    }
  }
  return null
}

// ── Lexer ────────────────────────────────────────────────────────────────────

interface ScannedLiteral {
  /** 'string' = quoted string or JSX attribute string; 'jsx' = JSX text. */
  kind: 'string' | 'template' | 'jsx'
  /** Decoded value. Templates: the static text with the ${…} parts left out. */
  value: string
  /** Templates: static text before the first ${…}. Otherwise the value. */
  head: string
  /** Index of the opening quote/backtick (JSX text: first text char). */
  start: number
  /** Index just after the closing quote/backtick (JSX text: end of the text). */
  end: number
}

interface ScannedSource {
  /** Same length as the source; literal/comment/regex/JSX-text contents are spaces. */
  code: string
  literals: ScannedLiteral[]
}

const IDENT_CHAR_RE = /[A-Za-z0-9_$]/
const JSX_NAME_CHAR_RE = /[A-Za-z0-9_$.:-]/
// Reserved words after which a new expression (so a regex literal or JSX) starts.
const EXPR_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await'])

function isWs(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'
    || c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029'
}

// Can a new expression start at `pos` (i.e. is a '/' there a regex and a '<' JSX)?
// Decided from the previous significant token. Anything that can end an operand —
// identifiers, literals, `)`, `]`, `}`, postfix `++`/`--`, TS's non-null `!` —
// answers no, so a doubtful '/' or '<' is scanned as code instead of being blanked.
function canStartExpression(buf: ArrayLike<string>, pos: number): boolean {
  let k = pos - 1
  while (k >= 0 && isWs(buf[k])) k--
  if (k < 0) return true
  const c = buf[k]
  if (IDENT_CHAR_RE.test(c)) {
    let s = k
    while (s > 0 && IDENT_CHAR_RE.test(buf[s - 1])) s--
    let word = ''
    for (let q = s; q <= k; q++) word += buf[q]
    let p = s - 1
    while (p >= 0 && isWs(buf[p])) p--
    if (p >= 0 && buf[p] === '.') return false // property name (a.in, x.return)
    return EXPR_KEYWORDS.has(word)
  }
  if (c === '>') return k > 0 && buf[k - 1] === '=' // only the arrow `=>`
  if (c === '+' || c === '-') return !(k > 0 && buf[k - 1] === c) // not after postfix ++/--
  if (c === '!') return canStartExpression(buf, k) // prefix `!` vs TS non-null assertion
  return '(,=:[&|?{;*%~^<'.includes(c)
}

function decodeEscape(src: string, i: number): { ch: string; next: number } {
  const c = src[i + 1]
  if (c === undefined) throw new Error('scan')
  const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
  if (c in simple && !(c === '0' && /[0-9]/.test(src[i + 2] ?? ''))) return { ch: simple[c], next: i + 2 }
  if (c === '\r') return { ch: '', next: src[i + 2] === '\n' ? i + 3 : i + 2 }
  if (c === '\n' || c === '\u2028' || c === '\u2029') return { ch: '', next: i + 2 }
  if (c === 'x') {
    const hex = src.slice(i + 2, i + 4)
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('scan')
    return { ch: String.fromCharCode(parseInt(hex, 16)), next: i + 4 }
  }
  if (c === 'u') {
    if (src[i + 2] === '{') {
      const close = src.indexOf('}', i + 3)
      const hex = close < 0 ? '' : src.slice(i + 3, close)
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) throw new Error('scan')
      return { ch: String.fromCodePoint(parseInt(hex, 16)), next: close + 1 }
    }
    const hex = src.slice(i + 2, i + 6)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('scan')
    return { ch: String.fromCharCode(parseInt(hex, 16)), next: i + 6 }
  }
  return { ch: c, next: i + 2 }
}

// Tokenizes TS/TSX just enough to tell code from text. Returns null when the source
// cannot be followed (unterminated literal, unbalanced JSX …); callers then fall back
// to the raw-text checks.
function scanSource(src: string, jsx: boolean): ScannedSource | null {
  const n = src.length
  const out = src.split('')
  const literals: ScannedLiteral[] = []
  let i = 0

  const fail = (): never => { throw new Error('scan') }
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }

  function readQuoted(q: string): void {
    const start = i
    let value = ''
    i++
    for (;;) {
      if (i >= n) fail()
      const c = src[i]
      if (c === q) break
      if (c === '\n' || c === '\r') fail()
      if (c === '\\') { const d = decodeEscape(src, i); value += d.ch; i = d.next; continue }
      value += c
      i++
    }
    i++
    blank(start + 1, i - 1)
    literals.push({ kind: 'string', value, head: value, start, end: i })
  }

  function readTemplate(): void {
    const start = i
    let value = ''
    let head: string | null = null
    i++
    let segStart = i
    for (;;) {
      if (i >= n) fail()
      const c = src[i]
      if (c === '`') break
      if (c === '\\') { const d = decodeEscape(src, i); value += d.ch; i = d.next; continue }
      if (c === '$' && src[i + 1] === '{') {
        blank(segStart, i)
        if (head === null) head = value
        i += 2
        scanCode(true) // stops on the closing '}'
        i++
        segStart = i
        continue
      }
      value += c
      i++
    }
    blank(segStart, i)
    i++
    literals.push({ kind: 'template', value, head: head ?? value, start, end: i })
  }

  function readRegex(): void {
    const start = i
    i++
    let inClass = false
    for (;;) {
      if (i >= n) fail()
      const c = src[i]
      if (c === '\n' || c === '\r') fail()
      if (c === '\\') {
        if (src[i + 1] === '\n' || src[i + 1] === '\r' || i + 1 >= n) fail()
        i += 2
        continue
      }
      if (inClass) { if (c === ']') inClass = false }
      else if (c === '[') inClass = true
      else if (c === '/') break
      i++
    }
    blank(start + 1, i)
    i++
    while (i < n && IDENT_CHAR_RE.test(src[i])) i++ // flags
  }

  // A '<' in expression position is JSX unless it opens TS generics: `<T,>`,
  // `<T extends X>`, `<T = X>` or a generic function type `<T>(…) => R`. The last
  // one also turns away real JSX whose text starts with '(' — that file is then
  // scanned more strictly, never less.
  function looksLikeJsx(): boolean {
    let k = i + 1
    if (src[k] === '>') return true // fragment
    if (!/[A-Za-z_$]/.test(src[k] ?? '')) return false
    while (k < n && JSX_NAME_CHAR_RE.test(src[k])) k++
    while (k < n && isWs(src[k])) k++
    const c = src[k]
    if (c === ',' || c === '=') return false
    if (src.startsWith('extends', k) && !IDENT_CHAR_RE.test(src[k + 7] ?? '')) return false
    if (c === '>') {
      let p = k + 1
      while (p < n && isWs(src[p])) p++
      if (src[p] === '(') return false
    }
    return true
  }

  function readJsxAttrString(q: string): void {
    const start = i
    const close = src.indexOf(q, i + 1)
    if (close < 0) fail()
    const value = src.slice(i + 1, close)
    blank(start + 1, close)
    i = close + 1
    literals.push({ kind: 'string', value, head: value, start, end: i })
  }

  function readJsxElement(): void {
    // i at '<'
    i++
    if (src[i] === '>') { i++; readJsxChildren(); return } // <>…</>
    if (!/[A-Za-z_$]/.test(src[i] ?? '')) fail()
    while (i < n && JSX_NAME_CHAR_RE.test(src[i])) i++
    for (;;) {
      while (i < n && isWs(src[i])) i++
      if (i >= n) fail()
      const c = src[i]
      if (c === '/' && src[i + 1] === '/') { // comment between attributes
        const nl = src.indexOf('\n', i)
        const stop = nl < 0 ? n : nl
        blank(i, stop)
        i = stop
        continue
      }
      if (c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2)
        if (close < 0) fail()
        blank(i, close + 2)
        i = close + 2
        continue
      }
      if (c === '/') { if (src[i + 1] !== '>') fail(); i += 2; return }
      if (c === '>') { i++; readJsxChildren(); return }
      if (c === '{') { i++; scanCode(true); i++; continue } // {...spread}
      if (!/[A-Za-z_$]/.test(c)) fail()
      while (i < n && JSX_NAME_CHAR_RE.test(src[i])) i++
      while (i < n && isWs(src[i])) i++
      if (src[i] !== '=') continue // boolean attribute
      i++
      while (i < n && isWs(src[i])) i++
      const v = src[i]
      if (v === '"' || v === "'") readJsxAttrString(v)
      else if (v === '{') { i++; scanCode(true); i++ }
      else if (v === '<') readJsxElement()
      else fail()
    }
  }

  function readJsxChildren(): void {
    let textStart = i
    const flushText = () => {
      if (i > textStart) {
        literals.push({ kind: 'jsx', value: src.slice(textStart, i), head: '', start: textStart, end: i })
        blank(textStart, i)
      }
    }
    for (;;) {
      if (i >= n) fail()
      const c = src[i]
      if (c === '{') { flushText(); i++; scanCode(true); i++; textStart = i; continue }
      if (c === '<') {
        flushText()
        if (src[i + 1] === '/') { // closing tag
          i += 2
          while (i < n && (JSX_NAME_CHAR_RE.test(src[i]) || isWs(src[i]))) i++
          if (src[i] !== '>') fail()
          i++
          return
        }
        readJsxElement() // inside children every '<' opens an element
        textStart = i
        continue
      }
      i++
    }
  }

  // Scans code to EOF (top level) or to the '}' closing the current `${` / `{`
  // (nested), leaving i on that '}'.
  function scanCode(nested: boolean): void {
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === '"' || c === "'") { readQuoted(c); continue }
      if (c === '`') { readTemplate(); continue }
      if (c === '/') {
        const d = src[i + 1]
        if (d === '/') {
          const nl = src.indexOf('\n', i)
          const stop = nl < 0 ? n : nl
          blank(i, stop)
          i = stop
          continue
        }
        if (d === '*') {
          const close = src.indexOf('*/', i + 2)
          if (close < 0) fail()
          blank(i, close + 2)
          i = close + 2
          continue
        }
        if (canStartExpression(out, i)) { readRegex(); continue }
        i++
        continue
      }
      if (c === '<' && jsx && canStartExpression(out, i) && looksLikeJsx()) { readJsxElement(); continue }
      if (c === '{') depth++
      else if (c === '}') {
        if (depth === 0) { if (nested) return; fail() }
        depth--
      }
      i++
    }
    if (nested) fail()
  }

  try {
    scanCode(false)
  } catch {
    return null
  }
  return { code: out.join(''), literals }
}

// ── Checks ───────────────────────────────────────────────────────────────────

// Local modules AI code may never import: the hosted-mode helper module, the legacy
// admin-session module and every route handler (they run with the store's server env).
function isLockedModuleImport(filePath: string, spec: string): boolean {
  let target: string
  if (spec.startsWith('@/')) target = spec.slice(2)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    target = path.posix.join(path.posix.dirname(filePath), spec)
  } else if (spec.startsWith('/')) target = spec.slice(1)
  else target = spec
  target = path.posix.normalize(target).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '').toLowerCase()
  target = target.replace(/\.(?:tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '')
  return target === 'lib/platform' || target === 'lib/admin-session'
    || target === 'app/api' || target.startsWith('app/api/')
}

function forbiddenImport(filePath: string, spec: string): string | null {
  if (NODE_BUILTIN_MODULE.test(spec)) return 'Node built-in import'
  if (/^next\/(?:headers|server)(?:\.js)?$/.test(spec)) return 'next/headers or next/server import'
  if (isLockedModuleImport(filePath, spec)) return 'import of a locked platform module'
  return null
}

function findForbiddenIdentInCode(code: string): string | null {
  for (const ident of AI_FORBIDDEN_IDENTS) {
    const re = new RegExp(`(?<![A-Za-z0-9_$])${ident}(?![A-Za-z0-9_$])`, 'g')
    for (const m of code.matchAll(re)) {
      const start = m.index ?? 0
      if (ident === 'process' && AI_ALLOWED_PROCESS_USE.test(code.slice(start, start + 120))) continue
      return ident
    }
  }
  return null
}

function checkScannedCode(filePath: string, { code, literals }: ScannedSource): string | null {
  const sorted = [...literals].sort((a, b) => a.start - b.start)
  const byStart = new Map(sorted.map((l) => [l.start, l]))

  if (ROUTE_CONFIG_RE.test(code)) return 'route segment config'
  // Outside literals a backslash can only be an escaped identifier (process).
  if (code.includes('\\')) return 'unicode-escaped identifier'
  if (/(?<![\w$.])import\s*\(\s*(?!'[^'\n]*'\s*\)|"[^"\n]*"\s*\))/.test(code)) return 'computed dynamic import()'
  if (/\.\s*constructor(?![\w$])/.test(code)) return 'constructor access'

  for (const l of sorted) {
    if (l.kind === 'jsx') {
      if (JSX_TEXT_CODE_RE.test(l.value)) return 'code in JSX text'
      continue
    }
    if (l.kind === 'string' && l.value === 'use server') return "'use server' (server actions)"
    if (l.value === 'constructor' || l.value === '__proto__') return 'constructor access'
    if (l.kind === 'string' && MODULE_SPECIFIER_BEFORE.test(code.slice(Math.max(0, l.start - 40), l.start))) {
      const why = forbiddenImport(filePath, l.value)
      if (why) return why
    }
  }

  const ident = findForbiddenIdentInCode(code)
  if (ident) return ident

  // Computed member access with string keys: x['eval'], x['con' + 'structor'].
  // A '[' where an expression may start is an array literal (tags: ['global'],
  // `for (const t of ['global'])`, `export default ['global']`).
  for (let k = code.indexOf('['); k >= 0; k = code.indexOf('[', k + 1)) {
    if (canStartExpression(code, k) || /(?<![\w$.])(?:of|default)\s*$/.test(code.slice(Math.max(0, k - 12), k))) continue
    let depth = 0
    let close = code.length
    for (let q = k; q < code.length; q++) {
      if (code[q] === '[') depth++
      else if (code[q] === ']' && --depth === 0) { close = q; break }
    }
    // First literal starting after '[' (binary search), then every one up to ']'.
    let lo = 0
    let hi = sorted.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].start <= k) lo = mid + 1; else hi = mid }
    const parts: string[] = []
    for (let q = lo; q < sorted.length && sorted[q].start < close; q++) {
      if (sorted[q].kind === 'jsx') continue
      if (AI_FORBIDDEN_KEYS.has(sorted[q].value)) return `computed access to '${sorted[q].value}'`
      parts.push(sorted[q].value)
    }
    const joined = parts.join('')
    if (AI_FORBIDDEN_KEYS.has(joined)) return `computed access to '${joined}'`
  }

  for (const name of AI_FORBIDDEN_NETWORK) {
    if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(code)) return `network API: ${name}`
  }

  // fetch() of an absolute URL — given literally or through a const in this file.
  for (const m of code.matchAll(/(?<![\w$])fetch\s*\(\s*/g)) {
    const argStart = (m.index ?? 0) + m[0].length
    let lit = byStart.get(argStart)
    if (!lit) {
      const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(argStart, argStart + 100))?.[0]
      if (id) {
        const decl = new RegExp(`(?<![\\w$])(?:const|let|var)\\s+${id.replace(/\$/g, '\\$')}\\s*(?::[^=;]*)?=\\s*$`)
        lit = sorted.find((l) => l.kind !== 'jsx' && decl.test(code.slice(Math.max(0, l.start - 200), l.start)))
      }
    }
    if (lit && lit.kind !== 'jsx' && ABSOLUTE_URL_RE.test(lit.head)) return 'fetch to an external URL'
  }

  return null
}

function checkRawCode(filePath: string, content: string): string | null {
  for (const { re, why } of AI_FORBIDDEN_CODE) {
    if (re.test(content)) return why
  }
  const ident = findForbiddenIdentRaw(content)
  if (ident) return ident
  for (const m of content.matchAll(/(['"`])([^'"`\n]{1,300})\1/g)) {
    if (isLockedModuleImport(filePath, m[2])) return 'import of a locked platform module'
  }
  return null
}

// ── AST allowlist (security boundary, F7/F9) ─────────────────────────────────
// The lexical checks above are a denylist over text; a name rebuilt at runtime from
// pieces is invisible to them. This pass parses the file with the TypeScript
// compiler (same dependency lib/sandbox/validate-component.ts uses) and enforces an
// ALLOWLIST: known module specifiers only, no runtime/global escape hatches, no
// prototype-chain property names in any position, computed keys only when their
// value is provably not one of those names, and constant-folded string values
// checked against them. Anything the parser reports as a syntax error, or that the
// walker cannot fully analyse, is rejected (fail closed). Both passes must accept.

// Package specifiers AI files may import (all shipped by the scaffold package.json).
const AI_ALLOWED_PACKAGES = new Set([
  'react', 'react-dom', 'react/jsx-runtime',
  'next/link', 'next/image', 'next/navigation', 'next/font/google',
  'framer-motion', 'lucide-react',
])
// Extra specifiers allowed for `import type` only (erased at compile time).
const AI_TYPE_ONLY_PACKAGES = new Set(['next'])
// Free identifiers that give code the runtime, a global object, or raw network access.
const AST_FORBIDDEN_IDENTS = new Set([
  'process', 'global', 'globalThis', 'eval', 'Function', 'require', 'module', 'exports',
  'Reflect', 'Proxy', 'WebAssembly', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'importScripts', '__non_webpack_require__', '__webpack_require__', 'Buffer', 'setImmediate',
  'atob', 'unescape', 'SharedArrayBuffer', 'Atomics', 'Worker', 'SharedWorker',
])
// Browser globals: only in 'use client' files (never evaluated with the server env).
const AST_CLIENT_ONLY_IDENTS = new Set(['window', 'document'])
// Global-object aliases that are also common local names: flagged only when not
// declared in the file, and only allowed in 'use client' files.
const AST_AMBIGUOUS_GLOBALS = new Set(['self', 'top', 'parent', 'frames'])
// Property names forbidden in EVERY position (member access, computed key, object
// literal key, destructuring key, class member).
const AST_FORBIDDEN_PROPS = new Set([
  'constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments',
  'prepareStackTrace', 'captureStackTrace', 'getThis', 'getFunction',
])
// Additionally forbidden as the name in a member access (`x.eval`, `navigator.sendBeacon`).
const AST_FORBIDDEN_MEMBER_NAMES = new Set([
  ...AST_FORBIDDEN_IDENTS, 'sendBeacon', 'fromCharCode', 'fromCodePoint', 'mainModule',
  'binding', 'dlopen',
])
// A constant-folded string (or computed key) equal to one of these rejects the file.
const AST_FORBIDDEN_STRING_VALUES = new Set([
  ...AST_FORBIDDEN_PROPS, ...AST_FORBIDDEN_MEMBER_NAMES, 'env', 'window', 'document', 'self',
])
// Plain single literals are product copy far more often than code, so only the
// prototype-chain names are rejected there (the old lexical rule, extended).
const AST_FORBIDDEN_PLAIN_LITERALS = new Set([
  'constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
])
// Object.<name> members AI code may use.
const AST_OBJECT_ALLOWED_MEMBERS = new Set(['keys', 'values', 'entries', 'fromEntries', 'assign', 'freeze', 'isFrozen'])
const AST_ROUTE_CONFIG_NAMES = new Set(['maxDuration', 'runtime', 'preferredRegion'])
// Calls whose result is a string built at runtime; a variable initialised from one
// may not be used as a computed key.
const AST_STRING_BUILDING_METHODS = new Set([
  'join', 'concat', 'reverse', 'replace', 'replaceAll', 'slice', 'substring', 'substr',
  'toString', 'repeat', 'padStart', 'padEnd', 'trim', 'trimStart', 'trimEnd',
  'toLowerCase', 'toUpperCase', 'normalize', 'at', 'charAt', 'map', 'reduce', 'split',
])

function astUnwrap(node: ts.Expression): ts.Expression {
  let e = node
  while (
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)
  ) e = e.expression
  return e
}

type AstFolded = string | string[] | null

// Best-effort constant folding of string-building expressions over literals and
// file-level constant strings ('a' + 'b', `a${'b'}`, ['a','b'].join(''), 'a'.concat('b')).
function astFold(node: ts.Expression, consts: Map<string, string>, depth = 0): AstFolded {
  if (depth > 300) throw new Error('expression nested too deeply')
  const e = astUnwrap(node)
  const str = (x: ts.Expression): string | null => {
    const v = astFold(x, consts, depth + 1)
    return typeof v === 'string' ? v : null
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return e.text
  if (ts.isIdentifier(e)) return consts.get(e.text) ?? null
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text
    for (const span of e.templateSpans) {
      const v = str(span.expression)
      if (v === null) return null
      out += v + span.literal.text
    }
    return out
  }
  if (ts.isTaggedTemplateExpression(e)) {
    const t = e.template
    if (ts.isNoSubstitutionTemplateLiteral(t)) return t.rawText ?? t.text
    return null
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = str(e.left)
    const r = l === null ? null : str(e.right)
    return l === null || r === null ? null : l + r
  }
  if (ts.isConditionalExpression(e)) {
    // Either branch may be the runtime value; report one that folds to a forbidden name.
    const a = str(e.whenTrue)
    const b = str(e.whenFalse)
    if (a !== null && AST_FORBIDDEN_STRING_VALUES.has(a)) return a
    if (b !== null && AST_FORBIDDEN_STRING_VALUES.has(b)) return b
    return a !== null && a === b ? a : null
  }
  if (ts.isArrayLiteralExpression(e)) {
    const parts: string[] = []
    for (const el of e.elements) {
      const v = str(el)
      if (v === null) return null
      parts.push(v)
    }
    return parts
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const method = e.expression.name.text
    const target = astFold(e.expression.expression, consts, depth + 1)
    if (target === null) return null
    const args: string[] = []
    for (const a of e.arguments) {
      const v = str(a)
      if (v === null) return null
      args.push(v)
    }
    if (typeof target === 'string') {
      if (method === 'concat') return target + args.join('')
      if (method === 'split') return target.split(args[0] ?? '')
      if (method === 'toString' || method === 'valueOf') return target
      if (method === 'trim') return target.trim()
      if (method === 'toLowerCase') return target.toLowerCase()
      if (method === 'toUpperCase') return target.toUpperCase()
      if (method === 'repeat') return target.repeat(Math.min(Number(args[0]) || 0, 64))
      if (method === 'slice' || method === 'substring') {
        return target[method](Number(args[0]) || 0, args[1] === undefined ? undefined : Number(args[1]))
      }
      return null
    }
    if (method === 'join') return target.join(args.length ? args[0] : ',')
    if (method === 'reverse') return [...target].reverse()
    if (method === 'concat') return [...target, ...args]
    return null
  }
  return null
}

function astConstStrings(sf: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>()
  const ambiguous = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text
      const v = astFold(node.initializer, consts)
      if (typeof v === 'string' && !ambiguous.has(name) && !consts.has(name)) consts.set(name, v)
      else { consts.delete(name); ambiguous.add(name) }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return consts
}

function astIsStringish(node: ts.Expression): boolean {
  const e = astUnwrap(node)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e) || ts.isTaggedTemplateExpression(e)) return true
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return astIsStringish(e.left) || astIsStringish(e.right)
  }
  return false
}

// Names bound (anywhere in the file) to a string assembled at runtime; such a name
// may not be used as a computed key because its value cannot be checked statically.
function astRuntimeStringNames(sf: ts.SourceFile, consts: Map<string, string>): Set<string> {
  const names = new Set<string>()
  const builds = (init: ts.Expression): boolean => {
    const e = astUnwrap(init)
    if (astFold(e, consts) !== null) return false
    if (astIsStringish(e)) return true
    if (ts.isCallExpression(e)) {
      const callee = astUnwrap(e.expression)
      if (ts.isPropertyAccessExpression(callee) && AST_STRING_BUILDING_METHODS.has(callee.name.text)) return true
      if (ts.isIdentifier(callee) && (callee.text === 'String' || callee.text === 'decodeURIComponent' || callee.text === 'decodeURI')) return true
    }
    if (ts.isConditionalExpression(e)) return builds(e.whenTrue) || builds(e.whenFalse)
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        return builds(e.left) || builds(e.right)
      }
    }
    return false
  }
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && builds(node.initializer)) {
      names.add(node.name.text)
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left) && builds(node.right)) {
      names.add(node.left.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function astDeclaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const addBinding = (b: ts.BindingName) => {
    if (ts.isIdentifier(b)) names.add(b.text)
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name)
  }
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBinding(node.name)
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text)
    else if (ts.isImportClause(node) && node.name) names.add(node.name.text)
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** Where an Identifier sits: a property/member name, a declaration name, or a value reference. */
function astIdentRole(id: ts.Identifier): 'member' | 'key' | 'decl' | 'jsxAttr' | 'label' | 'ref' {
  const p = id.parent
  if (!p) return 'ref'
  if (ts.isPropertyAccessExpression(p)) return p.name === id ? 'member' : 'ref'
  if (ts.isQualifiedName(p)) return 'member'
  if (ts.isJsxAttribute(p)) return 'jsxAttr'
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return 'label'
  if (ts.isBindingElement(p)) {
    if (p.propertyName === id) return 'key'
    if (p.name === id) return p.propertyName ? 'decl' : 'key' // `{ constructor }` reads that key
    return 'ref'
  }
  if (ts.isShorthandPropertyAssignment(p)) return p.name === id ? 'ref' : 'ref'
  if (
    ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)
  ) return (p as { name?: ts.Node }).name === id ? 'key' : 'ref'
  if (
    ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) || ts.isTypeParameterDeclaration(p) || ts.isEnumDeclaration(p) ||
    ts.isImportClause(p) || ts.isNamespaceImport(p)
  ) return (p as { name?: ts.Node }).name === id ? 'decl' : 'ref'
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return 'decl'
  return 'ref'
}

/** process.env.NEXT_PUBLIC_* / process.env.NODE_ENV, read as a plain member chain. */
function astIsAllowedProcessUse(id: ts.Identifier): boolean {
  const envAccess = id.parent
  if (!envAccess || !ts.isPropertyAccessExpression(envAccess) || envAccess.expression !== id || envAccess.name.text !== 'env') return false
  if (envAccess.questionDotToken) return false
  const varAccess = envAccess.parent
  if (!varAccess || !ts.isPropertyAccessExpression(varAccess) || varAccess.expression !== envAccess) return false
  const name = varAccess.name.text
  if (!/^(?:NEXT_PUBLIC_[A-Z0-9_]+|NODE_ENV)$/.test(name)) return false
  // The value may be read, never written or deleted.
  const use = varAccess.parent
  if (use && ts.isBinaryExpression(use) && use.left === varAccess &&
      use.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && use.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return false
  if (use && ts.isDeleteExpression(use)) return false
  return true
}

/** '@/x' or a relative specifier → project-relative path inside the AI-writable roots, else null. */
function astResolveLocalImport(filePath: string, spec: string): string | null {
  let target: string
  if (spec.startsWith('@/')) target = spec.slice(2)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    target = path.posix.join(path.posix.dirname(filePath), spec)
  } else return null
  if (target.includes('\\') || /[\u0000-\u001f]/.test(target)) return null
  target = path.posix.normalize(target).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  if (!target || target === '.' || target.startsWith('../') || target === '..' || target.startsWith('/')) return null
  const root = target.split('/')[0]
  if (!AI_ALLOWED_ROOTS.has(root)) return null
  return target
}

function astCheckModuleSpecifier(filePath: string, spec: ts.Expression | undefined, typeOnly: boolean): string | null {
  if (!spec) return null
  if (!ts.isStringLiteral(spec)) return 'non-literal module specifier'
  const s = spec.text
  if (AI_ALLOWED_PACKAGES.has(s)) return null
  if (typeOnly && AI_TYPE_ONLY_PACKAGES.has(s)) return null
  const local = astResolveLocalImport(filePath, s)
  if (local === null) return `import of '${s.slice(0, 80)}' is not allowed`
  if (isLockedModuleImport(filePath, s)) return 'import of a locked platform module'
  return null
}

function astIsTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return false // side-effect import
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const b = clause.namedBindings
  if (!b || ts.isNamespaceImport(b)) return false
  return b.elements.length > 0 && b.elements.every((el) => el.isTypeOnly)
}

function astHasUseClient(sf: ts.SourceFile): boolean {
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) return false
    if (st.expression.text === 'use client') return true
  }
  return false
}

function astIsRelativeUrl(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')
}

/** A computed key whose value cannot be assembled at runtime from strings. */
function astIsStaticKey(node: ts.Expression, runtimeNames: Set<string>, depth = 0): boolean {
  if (depth > 100) return false
  const e = astUnwrap(node)
  if (ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true
  if (ts.isIdentifier(e)) return !runtimeNames.has(e.text)
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return true
  if (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) return astIsStaticKey(e.operand, runtimeNames, depth + 1)
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind
    if (op === ts.SyntaxKind.CommaToken || (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment)) return false
    if (op === ts.SyntaxKind.PlusToken && (astIsStringish(e.left) || astIsStringish(e.right))) return false
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return astIsStaticKey(e.left, runtimeNames, depth + 1) && astIsStaticKey(e.right, runtimeNames, depth + 1)
    }
    return astIsStaticKey(e.left, runtimeNames, depth + 1) && astIsStaticKey(e.right, runtimeNames, depth + 1)
  }
  if (ts.isCallExpression(e)) {
    const callee = astUnwrap(e.expression)
    if (ts.isIdentifier(callee) && (callee.text === 'Number' || callee.text === 'parseInt' || callee.text === 'parseFloat')) return true
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math') return true
  }
  return false
}

function runAstStoreChecks(filePath: string, src: string): string | null {
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    const where = first.start !== undefined ? sf.getLineAndCharacterOfPosition(first.start).line + 1 : 0
    return `syntax error${where ? ` at line ${where}` : ''}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ').slice(0, 120)}`
  }

  const isClient = astHasUseClient(sf)
  const consts = astConstStrings(sf)
  const runtimeNames = astRuntimeStringNames(sf, consts)
  const declared = astDeclaredNames(sf)

  const checkKeyExpr = (key: ts.Expression): string | null => {
    const folded = astFold(key, consts)
    if (typeof folded === 'string') {
      return AST_FORBIDDEN_STRING_VALUES.has(folded) ? `computed access to '${folded}'` : null
    }
    if (Array.isArray(folded)) {
      const joined = folded.join(',')
      return AST_FORBIDDEN_STRING_VALUES.has(joined) ? `computed access to '${joined}'` : null
    }
    return astIsStaticKey(key, runtimeNames) ? null : 'computed property key built at runtime'
  }

  const checkFetchCall = (call: ts.CallExpression): string | null => {
    const arg = call.arguments[0]
    if (!arg) return null
    const folded = astFold(arg, consts)
    if (typeof folded === 'string') return astIsRelativeUrl(folded) ? null : 'fetch to an external URL'
    if (!isClient) return 'fetch with a non-literal URL in a server file'
    // Client files: the static start of the URL must still be relative.
    const e = astUnwrap(arg)
    let head: string | null = null
    if (ts.isTemplateExpression(e)) head = e.head.text
    else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      let left: ts.Expression = e
      while (ts.isBinaryExpression(left) && left.operatorToken.kind === ts.SyntaxKind.PlusToken) left = astUnwrap(left.left)
      const v = astFold(left, consts)
      head = typeof v === 'string' ? v : null
    }
    if (head !== null && head.length > 0 && !astIsRelativeUrl(head)) return 'fetch to an external URL'
    return null
  }

  const isFetchCallee = (n: ts.Node): boolean => {
    const p = n.parent
    return !!p && ts.isCallExpression(p) && astUnwrap(p.expression) === n
  }

  let reason: string | null = null
  const fail = (why: string) => { if (!reason) reason = why }

  const visit = (node: ts.Node): void => {
    if (reason) return
    // Types carry no runtime behaviour — except a class `extends <expression>`.
    if (ts.isTypeNode(node) && !(ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) &&
        node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent))) return
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
    if (ts.isModuleDeclaration(node)) {
      const ambient = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient
      if (!ambient) fail('namespace/module declaration')
      return // ambient declarations emit no code
    }
    if ((ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
        ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Ambient) return

    if (ts.isIdentifier(node)) {
      const name = node.text
      const role = astIdentRole(node)
      if (role === 'member') {
        if (AST_FORBIDDEN_PROPS.has(name) || AST_FORBIDDEN_MEMBER_NAMES.has(name)) fail(`access to '.${name}'`)
        else if (name === 'fetch' && !isFetchCallee(node.parent)) fail('fetch used as a value')
        return
      }
      if (role === 'key') {
        if (AST_FORBIDDEN_PROPS.has(name)) fail(`property key '${name}'`)
        return
      }
      if (role === 'jsxAttr' || role === 'label') return
      // decl / ref: forbidden names may be neither referenced nor shadowed.
      if (name === 'process' && role === 'ref' && astIsAllowedProcessUse(node)) return
      if (AST_FORBIDDEN_IDENTS.has(name)) { fail(name); return }
      if (role !== 'ref') return
      if (AST_CLIENT_ONLY_IDENTS.has(name) && !isClient) { fail(`${name} outside a 'use client' file`); return }
      if (AST_AMBIGUOUS_GLOBALS.has(name) && !declared.has(name) && !isClient) { fail(`global '${name}'`); return }
      if (name === 'fetch' && !isFetchCallee(node)) { fail('fetch used as a value'); return }
      if (name === 'Object') {
        const p = node.parent
        if (!(ts.isPropertyAccessExpression(p) && p.expression === node && AST_OBJECT_ALLOWED_MEMBERS.has(p.name.text))) {
          fail(ts.isPropertyAccessExpression(p) && p.expression === node ? `Object.${p.name.text}` : 'Object used as a value')
        }
      }
      if (name === 'String') {
        const p = node.parent
        if (ts.isPropertyAccessExpression(p) && p.expression === node && p.name.text !== 'raw') fail(`String.${p.name.text}`)
      }
      return
    }
    if (ts.isPrivateIdentifier(node)) {
      if (AST_FORBIDDEN_PROPS.has(node.text.slice(1))) fail(`property key '${node.text}'`)
      return
    }

    if (ts.isStringLiteral(node) && ts.isPropertyName(node) && node.parent && !ts.isComputedPropertyName(node.parent) &&
        (ts.isPropertyAssignment(node.parent) || ts.isBindingElement(node.parent) || ts.isMethodDeclaration(node.parent) ||
          ts.isPropertyDeclaration(node.parent) || ts.isGetAccessorDeclaration(node.parent) || ts.isSetAccessorDeclaration(node.parent)) &&
        (node.parent as { name?: ts.Node; propertyName?: ts.Node }).name === node ||
        (ts.isStringLiteral(node) && node.parent && ts.isBindingElement(node.parent) && node.parent.propertyName === node)) {
      if (AST_FORBIDDEN_PROPS.has(node.text)) { fail(`property key '${node.text}'`); return }
    }

    if (ts.isImportDeclaration(node)) {
      const why = astCheckModuleSpecifier(filePath, node.moduleSpecifier, astIsTypeOnlyImport(node))
      if (why) { fail(why); return }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const why = astCheckModuleSpecifier(filePath, node.moduleSpecifier, node.isTypeOnly)
        if (why) { fail(why); return }
      }
      const clause = node.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) if (AST_ROUTE_CONFIG_NAMES.has(el.name.text)) { fail('route segment config'); return }
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      fail('import = require()'); return
    } else if (ts.isExportAssignment(node) && node.isExportEquals) {
      fail('export ='); return
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      fail('import.meta'); return
    } else if (ts.isWithStatement(node)) {
      fail('with statement'); return
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      fail('dynamic import()'); return
    } else if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && AST_ROUTE_CONFIG_NAMES.has(d.name.text)) { fail('route segment config'); return }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && AST_ROUTE_CONFIG_NAMES.has(node.name.text) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      fail('route segment config'); return
    } else if (ts.isElementAccessExpression(node)) {
      const obj = astUnwrap(node.expression)
      if (ts.isIdentifier(obj) && (AST_CLIENT_ONLY_IDENTS.has(obj.text) || AST_AMBIGUOUS_GLOBALS.has(obj.text) ||
          obj.text === 'Object' || obj.text === 'String' || obj.text === 'navigator' || obj.text === 'location')) {
        fail(`computed member access on ${obj.text}`); return
      }
      const why = checkKeyExpr(node.argumentExpression)
      if (why) { fail(why); return }
    } else if (ts.isComputedPropertyName(node)) {
      const why = checkKeyExpr(node.expression)
      if (why) { fail(why); return }
    } else if (ts.isCallExpression(node)) {
      const callee = astUnwrap(node.expression)
      const isFetch = (ts.isIdentifier(callee) && callee.text === 'fetch') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch')
      if (isFetch) {
        const why = checkFetchCall(node)
        if (why) { fail(why); return }
      }
      if (ts.isIdentifier(callee) && (callee.text === 'setTimeout' || callee.text === 'setInterval') &&
          node.arguments[0] && (astIsStringish(node.arguments[0]) || typeof astFold(node.arguments[0], consts) === 'string')) {
        fail(`${callee.text} with a string`); return
      }
    }

    // String values: directives, plain literals, and anything folded from literals.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text === 'use server') { fail("'use server' (server actions)"); return }
      if (AST_FORBIDDEN_PLAIN_LITERALS.has(node.text) && !(node.parent && ts.isJsxAttribute(node.parent))) {
        fail(`string '${node.text}'`); return
      }
    }
    if (ts.isBinaryExpression(node) || ts.isTemplateExpression(node) || ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
      const folded = astFold(node, consts)
      if (typeof folded === 'string' && AST_FORBIDDEN_STRING_VALUES.has(folded)) { fail(`string built to '${folded}'`); return }
    }

    ts.forEachChild(node, visit)
  }
  visit(sf)
  return reason
}

function checkAstStoreFile(filePath: string, src: string): string | null {
  try {
    return runAstStoreChecks(filePath, src)
  } catch (err) {
    // Fail closed on anything the walker cannot fully analyse.
    return `could not be analysed: ${err instanceof Error ? err.message.slice(0, 80) : 'unknown error'}`
  }
}

// Returns the reason an AI file must be dropped, or null when it is acceptable.
export function rejectAiStoreFile(filePath: string, content: unknown): string | null {
  if (!isAllowedStorePath(filePath)) return 'path not allowed'
  if (typeof content !== 'string') return 'content is not text'
  if (content.length > AI_MAX_FILE_BYTES) return 'file too large'
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    const scanned = scanSource(content, filePath.endsWith('.tsx'))
    const why = scanned ? checkScannedCode(filePath, scanned) : checkRawCode(filePath, content)
    if (why) return `forbidden code: ${why}`
    // Security boundary: the AST allowlist must accept the file as well.
    const astWhy = checkAstStoreFile(filePath, content)
    if (astWhy) return `forbidden code: ${astWhy}`
  }
  return null
}

// Splits AI output into the files that may be stored/deployed and the dropped ones.
export function filterAiStoreFiles(codeFiles: CodeVersionFiles): {
  files: CodeVersionFiles
  dropped: Array<{ path: string; reason: string }>
} {
  const files: CodeVersionFiles = {}
  const dropped: Array<{ path: string; reason: string }> = []
  for (const [filePath, content] of Object.entries(codeFiles ?? {})) {
    const reason = rejectAiStoreFile(filePath, content)
    if (reason) dropped.push({ path: filePath, reason })
    else files[filePath] = content
  }
  return { files, dropped }
}

// ─── Sandboxed custom components (legacy manifest export) ────────────────────
// Security (R11): custom components are AI- or marketplace-authored, i.e. untrusted.
// They used to be written into the export as native components/custom/<ref>.tsx
// modules, so they ran during SSR/build with the store's server env
// (STRIPE_SECRET_KEY, ADMIN_PASSWORD, QUANTE_API_KEY) and in the browser on the store
// origin. Now each one is baked into a standalone HTML document and rendered exactly
// like the Studio preview (app/api/preview/component + CustomComponentFrame): an
// <iframe sandbox="allow-scripts"> WITHOUT allow-same-origin (opaque origin: no
// cookies, storage or same-origin APIs), a CSP with connect-src 'none', and Babel
// compiling the TSX inside the frame. Only validated design tokens (CSS custom
// properties) cross into the frame. Keep the CDN pins in sync with the preview route.

const SANDBOX_CDN = [
  // React 19 ships no UMD build; the isolated renderer uses React 18.3.1 UMD.
  { src: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js', integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z' },
  { src: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1' },
  { src: 'https://cdn.jsdelivr.net/npm/framer-motion@12.40.0/dist/framer-motion.js', integrity: 'sha384-CUXBBimBkXD9dbPEQX2QuMJ+sg6fDTMyOnCOLbeyMTwV5+uYt8Xi5Lf7lZ9lnPIR' },
  { src: 'https://unpkg.com/@babel/standalone@7.28.4/babel.min.js', integrity: 'sha384-tL0JdJBWAk5nHKZhc/dtWf7bZRpYP13x4HjH85NrwCr/JkBnrZ7RNBOAdDzJlpof' },
]

// The srcdoc document carries its own CSP (a srcdoc frame does not get response headers).
const SANDBOX_INNER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src https: data: blob:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

// Replaced at runtime (SandboxedComponent) with validated `:root{--x:…}` declarations.
const SANDBOX_VARS_PLACEHOLDER = '/*__QCC_VARS__*/'

/** JSON-encode for embedding inside an HTML <script> element. */
function jsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// Standalone HTML document rendering one custom component (same runtime as the
// Studio preview). The TSX source travels as escaped JSON, never spliced raw into
// a <script>, so a '</script>' inside it cannot break out.
function buildSandboxedComponentHtml(code: string): string {
  const scripts = SANDBOX_CDN
    .map((s) => `<script src="${s.src}" integrity="${s.integrity}" crossorigin="anonymous"></script>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_INNER_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:transparent;font-family:system-ui,sans-serif}
${SANDBOX_VARS_PLACEHOLDER}
</style>
</head>
<body>
<div id="root"></div>
${scripts}
<script type="application/json" id="__qcc_src">${jsonForHtmlScript(code)}</script>
<script>
(function() {
  var rootEl = document.getElementById('root');
  function fail(msg) {
    var p = document.createElement('p');
    p.style.cssText = 'color:#f87171;padding:1rem;font-size:0.875rem';
    p.textContent = msg;
    rootEl.replaceChildren(p);
  }
  function requireShim(mod) {
    if (mod === 'react') return React;
    if (mod === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
    if (mod === 'framer-motion') return window.Motion || window.FramerMotion || {};
    return {};
  }
  try {
    var source = JSON.parse(document.getElementById('__qcc_src').textContent || '""');
    var compiled = Babel.transform(source, {
      filename: 'component.tsx',
      presets: ['react', ['typescript', { isTSX: true, allExtensions: true }]],
      plugins: ['transform-modules-commonjs'],
    }).code;
    var mod = { exports: {} };
    new Function('exports', 'module', 'require', 'React', compiled)(mod.exports, mod, requireShim, React);
    var exported = mod.exports;
    var Component = exported && (exported['default'] || exported);
    if (typeof Component !== 'function') { fail('This section could not be displayed.'); return; }
    ReactDOM.createRoot(rootEl).render(React.createElement(Component, {}));
  } catch (e) {
    fail('This section could not be displayed.');
  }
})();
// Report the content height so the parent can size the frame. Target '*' is
// required: this document has an opaque origin. The parent only accepts the
// message from its own frame's contentWindow.
function reportHeight() {
  var h = document.documentElement.scrollHeight;
  if (h > 0) window.parent.postMessage({ type: '__qcc_height', height: h }, '*');
}
new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
window.addEventListener('load', reportHeight);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportHeight).observe(document.documentElement);
reportHeight();
</script>
</body>
</html>`
}

// components/custom/sources.ts — ref → sandbox document. Refs are pre-validated
// plain identifiers; duplicates keep the first component.
function buildCustomSourcesTs(components: CustomComponentRecord[]): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const c of components) {
    if (seen.has(c.ref)) continue
    seen.add(c.ref)
    // JSON.stringify yields a valid TS string literal; U+2028/9 escaped for older parsers.
    const literal = JSON.stringify(buildSandboxedComponentHtml(c.code))
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
    entries.push(`  ${JSON.stringify(c.ref)}: ${literal},`)
  }
  return [
    '// Custom sections, each a standalone HTML document rendered by SandboxedComponent',
    '// inside <iframe sandbox="allow-scripts"> (opaque origin, no network). The component',
    '// code never runs in this app itself — neither during the build nor on your domain.',
    'export const customSources: Record<string, string> = {',
    ...entries,
    '}',
    '',
  ].join('\n')
}

const SANDBOXED_COMPONENT_TSX = `'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { customSources } from './sources'

// SECURITY: custom section code is AI/marketplace-authored. It only ever runs inside
// this iframe: sandbox="allow-scripts" WITHOUT allow-same-origin gives it an opaque
// origin (no cookies, storage or same-origin APIs of this store) and the document's
// CSP blocks fetch/XHR. Never add allow-same-origin.
const VAR_KEY_RE = /^--[a-zA-Z0-9-]{1,40}$/
// Colors, lengths, numbers and font stacks. Excludes < > { } ; : @, backslashes and
// newlines so a value can neither end the declaration block nor the <style> element.
const VAR_VALUE_RE = /^[#a-zA-Z0-9 .,%()"'+\\/-]{1,120}$/
const VARS_PLACEHOLDER = '${SANDBOX_VARS_PLACEHOLDER}'

function cssVarsBlock(vars: Record<string, string>): string {
  const decls: string[] = []
  for (const [k, v] of Object.entries(vars)) {
    if (decls.length >= 40) break
    if (VAR_KEY_RE.test(k) && typeof v === 'string' && VAR_VALUE_RE.test(v)) decls.push(k + ':' + v)
  }
  return decls.length ? ':root{' + decls.join(';') + '}' : ''
}

interface Props {
  componentRef: string
  cssVars?: Record<string, string>
}

export function SandboxedComponent({ componentRef, cssVars }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)
  const template = Object.prototype.hasOwnProperty.call(customSources, componentRef) ? customSources[componentRef] : null
  const varsKey = cssVars ? JSON.stringify(cssVars) : '{}'
  const html = useMemo(
    () => (template ? template.replace(VARS_PLACEHOLDER, () => cssVarsBlock(JSON.parse(varsKey) as Record<string, string>)) : ''),
    [template, varsKey],
  )

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only trust height reports from our own frame.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const d = e.data as { type?: unknown; height?: unknown } | null
      if (d && d.type === '__qcc_height' && typeof d.height === 'number' && Number.isFinite(d.height) && d.height > 0) {
        setHeight(Math.min(d.height, 20000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (!template) return null

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      title={'Custom section ' + componentRef}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ display: 'block', width: '100%', height, border: 'none', overflow: 'hidden', transition: 'height 0.2s ease' }}
    />
  )
}
`

// Export SectionRenderer. Always generated: the platform's own SectionRenderer imports
// the Studio-only CustomComponentFrame (which fetches /api/preview/component), so a
// verbatim copy did not build inside an exported project.
function buildExportSectionRenderer(withCustom: boolean): string {
  const lines: Array<string | null> = [
    `import type { Section, ShopManifest } from '@/types/manifest'`,
    `import { Hero } from './sections/Hero'`,
    `import { ProductGrid } from './sections/ProductGrid'`,
    `import { FeatureRow } from './sections/FeatureRow'`,
    `import { Testimonials } from './sections/Testimonials'`,
    `import { RichText } from './sections/RichText'`,
    `import { Banner } from './sections/Banner'`,
    `import { Newsletter } from './sections/Newsletter'`,
    `import { Gallery } from './sections/Gallery'`,
    `import { Faq } from './sections/Faq'`,
    `import { Animations } from './sections/Animations'`,
    withCustom ? `import { manifestToCssVars } from './tokens'` : null,
    withCustom ? `import { SandboxedComponent } from '@/components/custom/SandboxedComponent'` : null,
    ``,
    `interface Props {`,
    `  section: Section`,
    `  manifest: ShopManifest`,
    `  basePath?: string`,
    `  projectId?: string`,
    `}`,
    ``,
    `export function SectionRenderer({ section, manifest, basePath = '' }: Props) {`,
    `  switch (section.type) {`,
    `    case 'hero': return <Hero props={section.props} basePath={basePath} />`,
    `    case 'productGrid': return <ProductGrid props={section.props} catalog={manifest.catalog} basePath={basePath} />`,
    `    case 'featureRow': return <FeatureRow props={section.props} />`,
    `    case 'testimonials': return <Testimonials props={section.props} />`,
    `    case 'richText': return <RichText props={section.props} />`,
    `    case 'banner': return <Banner props={section.props} basePath={basePath} />`,
    `    case 'newsletter': return <Newsletter props={section.props} />`,
    `    case 'gallery': return <Gallery props={section.props} />`,
    `    case 'faq': return <Faq props={section.props} />`,
    `    case 'animations': return <Animations props={section.props} catalog={manifest.catalog} basePath={basePath} />`,
    withCustom
      ? `    case 'customComponent': return <SandboxedComponent componentRef={section.ref} cssVars={manifestToCssVars(manifest)} />`
      : `    case 'customComponent': return null`,
    `    default: return null`,
    `  }`,
    `}`,
    ``,
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

// ─── Code-gen scaffold ────────────────────────────────────────────────────────
// Used when Claude generates actual TypeScript/React files directly.
// Provides the deterministic scaffold; AI files override scaffold files with the same path.

function buildCodeGenScaffold(): GeneratedFile[] {
  const files: GeneratedFile[] = []

  function add(name: string, content: string) {
    files.push({ path: name, content, encoding: 'utf-8' })
  }

  // ── package.json ──────────────────────────────────────────────────────────
  add('package.json', JSON.stringify({
    name: 'my-store',
    version: '1.0.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: {
      'framer-motion': '^12.40.0',
      'lucide-react': '^1.17.0',
      next: '16.2.7',
      react: '19.2.4',
      'react-dom': '19.2.4',
      // Only actually called from app/api/checkout/route.ts's self-hosted-mode
      // branch (QUANTE_PROJECT_ID unset) — hosted stores never execute it. But
      // Next's bundler still statically resolves the dynamic import('stripe')
      // at build time regardless of which runtime branch is live, so without
      // this listed as a real dependency the build fails outright with
      // "Module not found: Can't resolve 'stripe'" -- confirmed live 2026-08-27
      // on a Quante-hosted store stuck in a failed-build loop over this exact
      // error. Keep in sync with the root package.json's stripe version.
      stripe: '^22.2.0',
    },
    devDependencies: {
      '@tailwindcss/postcss': '^4',
      '@types/node': '^20',
      '@types/react': '^19',
      '@types/react-dom': '^19',
      tailwindcss: '^4',
      typescript: '^5',
    },
  }, null, 2))

  // ── tsconfig.json ─────────────────────────────────────────────────────────
  add('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2))

  // ── next.config.ts ────────────────────────────────────────────────────────
  // Security: only the store itself and the Studio (quantecode.com) may frame it.
  // `frame-ancestors *` let any site overlay the checkout (clickjacking).
  add('next.config.ts', buildNextConfig(false))

  // ── postcss.config.mjs ────────────────────────────────────────────────────
  add('postcss.config.mjs', `const config = { plugins: { '@tailwindcss/postcss': {} } }\nexport default config\n`)

  // ── next-env.d.ts ─────────────────────────────────────────────────────────
  add('next-env.d.ts', `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`)

  // ── lib/platform.ts (LOCKED) ──────────────────────────────────────────────
  // Hosted-mode connection helpers shared by the checkout/shipping/legal routes.
  add('lib/platform.ts', PLATFORM_HELPER_TS)

  // ── data/products.ts (fallback — Claude's version overrides this) ────────
  // The checkout route prices every cart line from this catalog, so it must
  // always exist even if a generation run somehow omitted it.
  add('data/products.ts', `import type { StoreProduct } from '@/types/store-code'

export const products: StoreProduct[] = []
`)

  // ── types/store-code.ts ───────────────────────────────────────────────────
  add('types/store-code.ts', `export interface StoreProduct {
  id: string
  name: string
  description: string
  price: number
  compareAtPrice?: number
  images: string[]
  slug: string
  available: boolean
  sku?: string
  tags?: string[]
  variants?: Array<{ id: string; name: string; price?: number; stock?: number; sku?: string }>
  lowStockThreshold?: number
}

export interface StoreConfig {
  brand: {
    name: string
    tagline: string
    currency: string
    language: string
    country: string
    logoText?: string
  }
  seo: { title: string; description: string }
  design: {
    colors: { bg: string; text: string; accent: string; accentText: string; muted: string; surface: string; border: string }
    fonts: { heading: string; body: string }
    radius: string
  }
  nav: Array<{ label: string; href: string }>
  footer: {
    columns: Array<{ title: string; links: Array<{ label: string; href: string }> }>
    legal: string
    socials?: Array<{ platform: string; url: string }>
  }
}

export interface CartItem {
  product: StoreProduct
  quantity: number
}

export interface StoreCodeOutput {
  files: Record<string, string>
  summary: string
}

export type CodeVersionFiles = Record<string, string>
`)

  // ── lib/utils.ts ─────────────────────────────────────────────────────────
  add('lib/utils.ts', `type ClassValue = string | undefined | null | boolean | Record<string, boolean>

export function cn(...classes: ClassValue[]): string {
  return classes
    .flatMap((c) => {
      if (!c || typeof c === 'boolean') return []
      if (typeof c === 'string') return [c]
      return Object.entries(c).filter(([, v]) => v).map(([k]) => k)
    })
    .join(' ')
}
`)

  // ── lib/store/cart.tsx ────────────────────────────────────────────────────
  add('lib/store/cart.tsx', `'use client'
import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react'
import type { StoreProduct, CartItem } from '@/types/store-code'

interface CartContextValue {
  items: CartItem[]
  total: number
  count: number
  addItem: (product: StoreProduct, qty?: number) => void
  removeItem: (productId: string) => void
  updateQty: (productId: string, qty: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = 'store-cart'

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setItems(JSON.parse(saved) as CartItem[])
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {}
  }, [items])

  const addItem = useCallback((product: StoreProduct, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) return prev.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i)
      return [...prev, { product, quantity: qty }]
    })
  }, [])

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.product.id !== productId))
  }, [])

  const updateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) { removeItem(productId); return }
    setItems((prev) => prev.map((i) => i.product.id === productId ? { ...i, quantity: qty } : i))
  }, [removeItem])

  const clearCart = useCallback(() => setItems([]), [])

  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <CartContext.Provider value={{ items, total, count, addItem, removeItem, updateQty, clearCart }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
`)

  // ── data/config.ts (fallback — Claude's version overrides this) ──────────
  add('data/config.ts', `import type { StoreConfig } from '@/types/store-code'

export const config: StoreConfig = {
  brand: { name: 'My Store', tagline: '', currency: 'EUR', language: 'en', country: 'US' },
  seo: { title: 'My Store', description: '' },
  design: {
    colors: { bg: '#ffffff', text: '#111111', accent: '#111111', accentText: '#ffffff', muted: '#6b7280', surface: '#f9fafb', border: '#e5e7eb' },
    fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
    radius: '8px',
  },
  nav: [{ label: 'Products', href: '/collections/all' }],
  footer: { columns: [], legal: '' },
}
`)

  // ── lib/i18n.ts (LOCKED) ──────────────────────────────────────────────────
  // Added 2026-08-22: the scaffold's fixed UI chrome (cart, checkout, success,
  // cookie banner, legal-page fallback, 404) used to be hardcoded English strings
  // regardless of config.brand.language/country — a store generated for the Czech
  // market got AI-written Czech homepage copy but an English checkout. Config
  // already carried a `language` field (unused by the scaffold until now); this
  // adds `country` alongside it plus a small dictionary + Intl-based locale
  // formatting so the deterministic parts of the store adapt to its actual market,
  // the same way currency already did. Starts with full en/cs coverage (Quante's
  // two proven markets this session); any other language code falls back to en
  // rather than showing missing strings.
  add('lib/i18n.ts', `import { config } from '@/data/config'

type StringKey =
  | 'cart' | 'cartEmpty' | 'continueShopping' | 'subtotal' | 'item' | 'items'
  | 'shipping' | 'free' | 'total' | 'fullName' | 'email' | 'phone'
  | 'shippingMethod' | 'shippingAddress' | 'street' | 'city' | 'state'
  | 'zip' | 'postcode' | 'postalCode' | 'country' | 'proceedToPayment' | 'redirecting'
  | 'errorEmail' | 'errorAddress' | 'errorShippingMethod' | 'errorGeneric'
  | 'thankYou' | 'confirmationNote' | 'cartHeading' | 'checkout'
  | 'cookieMessage' | 'learnMore' | 'accept'
  | 'pageNotFound' | 'pageNotFoundBody' | 'backTo' | 'legalNotConfigured'
  | 'termsOfService' | 'privacyPolicy' | 'cookiePolicy' | 'contact'

const STRINGS: Record<'en' | 'cs', Record<StringKey, string>> = {
  en: {
    cart: 'Your cart', cartEmpty: 'Your cart is empty.', continueShopping: 'Continue shopping',
    subtotal: 'Subtotal', item: 'item', items: 'items',
    shipping: 'Shipping', free: 'Free', total: 'Total',
    fullName: 'Full name', email: 'Email address', phone: 'Phone (optional)',
    shippingMethod: 'Shipping method', shippingAddress: 'Shipping address',
    street: 'Street address', city: 'City', state: 'State',
    zip: 'ZIP code', postcode: 'Postcode', postalCode: 'Postal code', country: 'Country',
    proceedToPayment: 'Proceed to payment', redirecting: 'Redirecting…',
    errorEmail: 'Please enter your email address.',
    errorAddress: 'Please fill in your shipping address.',
    errorShippingMethod: 'Please select a shipping method.',
    errorGeneric: 'Something went wrong. Please try again.',
    thankYou: 'Thank you — your order is confirmed.',
    confirmationNote: 'A confirmation email is on its way. We\\'ll let you know as soon as your order ships.',
    cartHeading: 'Cart', checkout: 'Checkout',
    cookieMessage: 'We use cookies to make this store work and, with your consent, to understand how it\\'s used.',
    learnMore: 'Learn more', accept: 'Accept',
    pageNotFound: 'Page not found',
    pageNotFoundBody: 'The page you\\'re looking for doesn\\'t exist or may have moved.',
    backTo: 'Back to', legalNotConfigured: 'This page has not been set up yet.',
    termsOfService: 'Terms of Service', privacyPolicy: 'Privacy Policy',
    cookiePolicy: 'Cookies', contact: 'Contact',
  },
  cs: {
    cart: 'Váš košík', cartEmpty: 'Váš košík je prázdný.', continueShopping: 'Pokračovat v nákupu',
    subtotal: 'Mezisoučet', item: 'položka', items: 'položek',
    shipping: 'Doprava', free: 'Zdarma', total: 'Celkem',
    fullName: 'Jméno a příjmení', email: 'E-mailová adresa', phone: 'Telefon (nepovinné)',
    shippingMethod: 'Způsob dopravy', shippingAddress: 'Doručovací adresa',
    street: 'Ulice a číslo popisné', city: 'Město', state: 'Stát',
    zip: 'PSČ', postcode: 'PSČ', postalCode: 'PSČ', country: 'Země',
    proceedToPayment: 'Pokračovat k platbě', redirecting: 'Přesměrovávám…',
    errorEmail: 'Zadejte prosím svou e-mailovou adresu.',
    errorAddress: 'Vyplňte prosím doručovací adresu.',
    errorShippingMethod: 'Vyberte prosím způsob dopravy.',
    errorGeneric: 'Něco se nepovedlo. Zkuste to prosím znovu.',
    thankYou: 'Děkujeme — vaše objednávka je potvrzena.',
    confirmationNote: 'Potvrzovací e-mail je na cestě. Jakmile objednávku odešleme, dáme vám vědět.',
    cartHeading: 'Košík', checkout: 'K pokladně',
    cookieMessage: 'Používáme cookies, aby obchod fungoval, a s vaším souhlasem i k pochopení, jak ho používáte.',
    learnMore: 'Zjistit více', accept: 'Přijmout',
    pageNotFound: 'Stránka nenalezena',
    pageNotFoundBody: 'Stránka, kterou hledáte, neexistuje nebo byla přesunuta.',
    backTo: 'Zpět na', legalNotConfigured: 'Tato stránka zatím není nastavena.',
    termsOfService: 'Obchodní podmínky', privacyPolicy: 'Zásady ochrany osobních údajů',
    cookiePolicy: 'Cookies', contact: 'Kontakt',
  },
}

function resolveLang(): 'en' | 'cs' {
  return config.brand.language === 'cs' ? 'cs' : 'en'
}

export function t(key: StringKey): string {
  return STRINGS[resolveLang()][key]
}

// BCP-47 locale for Intl formatting, e.g. "en-US", "cs-CZ".
export function getLocale(): string {
  const language = config.brand.language || 'en'
  const country = (config.brand.country || 'US').toUpperCase()
  return \`\${language}-\${country}\`
}

export function formatMoney(amount: number): string {
  try {
    return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: config.brand.currency || 'USD' }).format(amount)
  } catch {
    return \`\${amount.toFixed(2)} \${config.brand.currency}\`
  }
}

export function formatDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}

// Postal-code field label, adapted per country convention.
export function postalLabel(): string {
  const c = (config.brand.country || '').toUpperCase()
  if (c === 'US') return t('zip')
  if (c === 'GB') return t('postcode')
  return t('postalCode')
}

// Whether this country conventionally collects a "State / Province" field.
export function usesStateField(): boolean {
  return ['US', 'CA', 'AU', 'MX', 'BR', 'IN'].includes((config.brand.country || '').toUpperCase())
}
`)

  // ── components/layout/CartDrawer.tsx ─────────────────────────────────────
  add('components/layout/CartDrawer.tsx', `'use client'
import { X, Trash2, Plus, Minus, ShoppingBag } from 'lucide-react'
import Link from 'next/link'
import { useCart } from '@/lib/store/cart'
import { t, formatMoney } from '@/lib/i18n'

interface Props { open: boolean; onClose: () => void }

export function CartDrawer({ open, onClose }: Props) {
  const { items, total, removeItem, updateQty } = useCart()

  if (!open) return null

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 49 }} />
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(400px, 100vw)', zIndex: 50,
        background: 'var(--color-bg)', borderLeft: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-heading)' }}>{t('cartHeading')} ({items.length})</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 4, lineHeight: 0 }}><X size={20} /></button>
        </div>

        {items.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--color-muted)' }}>
            <ShoppingBag size={36} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 14 }}>{t('cartEmpty')}</p>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {items.map(({ product, quantity }) => (
                <div key={product.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {product.images[0] ? (
                    <img src={product.images[0]} alt={product.name} style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 'calc(var(--radius) * 0.6)', flexShrink: 0, border: '1px solid var(--color-border)' }} />
                  ) : (
                    <div style={{ width: 68, height: 68, background: 'var(--color-surface)', borderRadius: 'calc(var(--radius) * 0.6)', flexShrink: 0, border: '1px solid var(--color-border)' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.name}</p>
                    <p style={{ fontSize: 13, color: 'var(--color-accent)', fontWeight: 600 }}>{formatMoney(product.price)}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <button onClick={() => updateQty(product.id, quantity - 1)} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={12} /></button>
                      <span style={{ fontSize: 13, minWidth: 20, textAlign: 'center' }}>{quantity}</span>
                      <button onClick={() => updateQty(product.id, quantity + 1)} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={12} /></button>
                      <button onClick={() => removeItem(product.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginLeft: 'auto', padding: 4, lineHeight: 0 }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 14 }}>
                <span>{t('total')}</span>
                <span style={{ fontWeight: 700 }}>{formatMoney(total)}</span>
              </div>
              <Link
                href="/cart" onClick={onClose}
                style={{ display: 'block', textAlign: 'center', padding: '0.75rem', background: 'var(--color-accent)', color: 'var(--color-accent-text)', borderRadius: 'var(--radius)', fontWeight: 600, textDecoration: 'none', fontSize: 14 }}
              >
                {t('checkout')}
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  )
}
`)

  // ── app/not-found.tsx ──────────────────────────────────────────────────────
  // Added 2026-08-21: nothing in the scaffold ever provided a 404 page, so every
  // deployed store fell back to Next.js's own generic unstyled default (plain black
  // text on white) instead of matching the store's design tokens. Not locked — the
  // AI can restyle it further if asked, but it always exists as a sensible default.
  add('app/not-found.tsx', `import Link from 'next/link'
import { config } from '@/data/config'
import { t } from '@/lib/i18n'

export default function NotFound() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 1.25rem', textAlign: 'center' }}>
      <p style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(3rem, 8vw, 5rem)', fontWeight: 700, color: 'var(--color-accent)', margin: 0, lineHeight: 1 }}>404</p>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--color-text)' }}>{t('pageNotFound')}</h1>
      <p style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: '2rem', lineHeight: 1.6 }}>
        {t('pageNotFoundBody')}
      </p>
      <Link href="/" style={{ display: 'inline-block', background: 'var(--color-accent)', color: 'var(--color-accent-text)', borderRadius: 8, padding: '0.65rem 1.5rem', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
        {t('backTo')} {config.brand.name}
      </Link>
    </div>
  )
}
`)

  // ── app/cart/page.tsx ─────────────────────────────────────────────────────
  // Doubles as the checkout page — cart contents + shipping + contact details +
  // "Proceed to payment" in one screen. Deterministic/scaffold, not left to the
  // AI, because a working checkout is core-engine behavior, not something that
  // should vary by what a given generation run happened to write.
  // Added 2026-08-21: this route didn't exist at all in code-gen mode.
  // Rewritten 2026-08-22 (market/language work): now fetches the merchant's real
  // configured shipping methods (app/api/shipping) instead of a flat "calculated
  // at checkout" placeholder, collects a real shipping address (field labels
  // adapt per config.brand.country — ZIP/Postcode/Postal code, State field for
  // US/CA/AU/MX/BR/IN), and every fixed string + money amount goes through
  // lib/i18n.ts so the checkout matches the store's actual target market instead
  // of always being English.
  add('app/cart/page.tsx', `'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trash2, Plus, Minus } from 'lucide-react'
import { useCart } from '@/lib/store/cart'
import { config } from '@/data/config'
import { t, formatMoney, postalLabel, usesStateField } from '@/lib/i18n'

interface ShippingMethod { id: string; label: string; price: number }

export default function CartPage() {
  const { items, total, count, updateQty, removeItem } = useCart()
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postal, setPostal] = useState('')
  const [country, setCountry] = useState(config.brand.country || 'US')
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [freeShippingFrom, setFreeShippingFrom] = useState(0)
  const [selectedShipping, setSelectedShipping] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const currency = config.brand.currency
  const showState = usesStateField()

  useEffect(() => {
    fetch('/api/shipping')
      .then((r) => r.json())
      .then((d) => {
        const methods: ShippingMethod[] = d.methods ?? []
        setShippingMethods(methods)
        setFreeShippingFrom(d.freeShippingFrom ?? 0)
        if (methods[0]) setSelectedShipping(methods[0].id)
      })
      .catch(() => setShippingMethods([{ id: 'standard', label: 'Standard shipping', price: 0 }]))
  }, [])

  const selectedMethod = shippingMethods.find((m) => m.id === selectedShipping)
  const qualifiesFreeShipping = freeShippingFrom > 0 && total >= freeShippingFrom
  const shippingCost = qualifiesFreeShipping ? 0 : (selectedMethod?.price ?? 0)
  const orderTotal = total + shippingCost

  async function handleCheckout() {
    if (!customerEmail.trim()) { setError(t('errorEmail')); return }
    if (!street.trim() || !city.trim() || !postal.trim()) { setError(t('errorAddress')); return }
    if (shippingMethods.length > 0 && !selectedShipping) { setError(t('errorShippingMethod')); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(({ product, quantity }) => ({
            id: product.id, name: product.name, price: product.price, currency, quantity,
          })),
          customerEmail: customerEmail.trim(),
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          shippingMethod: selectedMethod?.label,
          shippingCents: Math.round(shippingCost * 100),
          shippingCountry: country || undefined,
          shippingAddress: { ulice: street.trim(), mesto: city.trim(), psc: postal.trim(), zeme: country || undefined },
        }),
      })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
      setError(data.error || t('errorGeneric'))
    } catch {
      setError(t('errorGeneric'))
    }
    setLoading(false)
  }

  const inputStyle = { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 14, background: 'var(--color-bg)', color: 'var(--color-text)', width: '100%', boxSizing: 'border-box' as const }
  const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 4, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }

  if (items.length === 0) {
    return (
      <div style={{ minHeight: '55vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '4rem 1.5rem' }}>
        <p style={{ fontSize: 16, color: 'var(--color-muted)' }}>{t('cartEmpty')}</p>
        <Link href="/collections/all" style={{ color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}>{t('continueShopping')} →</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '3rem 1.5rem 5rem' }}>
      <Link href="/collections/all" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-muted)', textDecoration: 'none', marginBottom: 24 }}>
        <ArrowLeft size={14} /> {t('continueShopping')}
      </Link>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 28, marginBottom: 28 }}>{t('cart')}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 40, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {items.map(({ product, quantity }) => (
              <div key={product.id} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
                {product.images[0] ? (
                  <img src={product.images[0]} alt={product.name} style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 'calc(var(--radius) * 0.6)', flexShrink: 0, border: '1px solid var(--color-border)' }} />
                ) : (
                  <div style={{ width: 88, height: 88, background: 'var(--color-surface)', borderRadius: 'calc(var(--radius) * 0.6)', flexShrink: 0, border: '1px solid var(--color-border)' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 500 }}>{product.name}</p>
                  <p style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 600, marginTop: 4 }}>{formatMoney(product.price)}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <button onClick={() => updateQty(product.id, quantity - 1)} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={12} /></button>
                    <span style={{ fontSize: 14, minWidth: 22, textAlign: 'center' }}>{quantity}</span>
                    <button onClick={() => updateQty(product.id, quantity + 1)} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={12} /></button>
                    <button onClick={() => removeItem(product.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginLeft: 'auto', padding: 4, lineHeight: 0 }}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {shippingMethods.length > 0 && (
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('shippingMethod')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shippingMethods.map((m) => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', border: \`1px solid \${selectedShipping === m.id ? 'var(--color-accent)' : 'var(--color-border)'}\`, borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                      <input type="radio" name="shipping" checked={selectedShipping === m.id} onChange={() => setSelectedShipping(m.id)} style={{ accentColor: 'var(--color-accent)' }} />
                      {m.label}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: (qualifiesFreeShipping || m.price === 0) ? '#059669' : 'var(--color-text)' }}>
                      {qualifiesFreeShipping || m.price === 0 ? t('free') : formatMoney(m.price)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('shippingAddress')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t('fullName')}</label>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t('phone')}</label>
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} type="tel" style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>{t('email')} *</label>
                <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} type="email" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('street')} *</label>
                <input value={street} onChange={(e) => setStreet(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: showState ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t('city')} *</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} />
                </div>
                {showState && (
                  <div>
                    <label style={labelStyle}>{t('state')}</label>
                    <input value={region} onChange={(e) => setRegion(e.target.value)} style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>{postalLabel()} *</label>
                  <input value={postal} onChange={(e) => setPostal(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ maxWidth: 160 }}>
                <label style={labelStyle}>{t('country')}</label>
                <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} style={inputStyle} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.5rem', position: 'sticky', top: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--color-muted)' }}>{t('subtotal')} ({count} {count === 1 ? t('item') : t('items')})</span>
              <span>{formatMoney(total)}</span>
            </div>
            {shippingMethods.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--color-muted)' }}>{t('shipping')}</span>
                <span style={{ color: shippingCost === 0 ? '#059669' : 'var(--color-text)' }}>{shippingCost === 0 ? t('free') : formatMoney(shippingCost)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
              <span>{t('total')}</span>
              <span>{formatMoney(orderTotal)}</span>
            </div>
          </div>
          {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
          <button onClick={handleCheckout} disabled={loading} style={{ width: '100%', padding: '0.85rem', background: 'var(--color-accent)', color: 'var(--color-accent-text)', border: 'none', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
            {loading ? t('redirecting') : t('proceedToPayment')}
          </button>
        </div>
      </div>
    </div>
  )
}
`)

  // ── app/success/page.tsx ──────────────────────────────────────────────────
  add('app/success/page.tsx', `'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/store/cart'
import { t } from '@/lib/i18n'

export default function SuccessPage() {
  const { clearCart } = useCart()

  useEffect(() => {
    clearCart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '4rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 26 }}>{t('thankYou')}</h1>
      <p style={{ fontSize: 14, color: 'var(--color-muted)', maxWidth: 420 }}>{t('confirmationNote')}</p>
      <Link href="/collections/all" style={{ marginTop: 12, color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}>{t('continueShopping')} →</Link>
    </div>
  )
}
`)

  // ── app/api/checkout/route.ts ─────────────────────────────────────────────
  // Hosted mode (default, when deployed via Quante): forwards to the Quante platform,
  // which creates a real Stripe Checkout Session under Quante's own Stripe account and
  // records the order — no Stripe keys needed on the merchant's side. QUANTE_PROJECT_ID
  // / QUANTE_API_URL are injected automatically by the deploy pipeline (see
  // app/api/deploy/route.ts setEnvVars call).
  // Self-hosted mode: if this project was exported and runs outside Quante,
  // QUANTE_PROJECT_ID won't be set, so this falls back to a direct Stripe integration —
  // set STRIPE_SECRET_KEY in .env.local to activate it.
  // Security (2026-09): prices are always taken from data/products.ts, never from
  // the request body, and the project id always comes from env — the body can no
  // longer override QUANTE_PROJECT_ID (it used to be spread after it). Only an
  // allowlist of fields is forwarded, shipping is priced from the merchant's
  // configured methods, and the payment redirect is checked before it is returned.
  add('app/api/checkout/route.ts', `import { NextResponse } from 'next/server'
import { products } from '@/data/products'
import { config } from '@/data/config'
import { platformUrl, storeOriginOf, shopperIpHeader, isAllowedRedirect, cleanString, cleanAddress } from '@/lib/platform'

${STORE_KEY_HEADERS_FN}

interface PricedItem { id: string; name: string; price: number; currency: string; quantity: number }

// Re-prices the cart from the store's own catalog. Returns null when any line is
// unknown, unavailable or has an invalid quantity.
function priceItems(raw: unknown): PricedItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null
  const out: PricedItem[] = []
  for (const line of raw as Array<Record<string, unknown>>) {
    const id = typeof line?.id === 'string' ? line.id : ''
    const quantity = Number(line?.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return null
    const product = products.find((p) => p.id === id)
    if (!product || product.available === false) return null
    const price = Number(product.price)
    if (!Number.isFinite(price) || price < 0) return null
    out.push({ id: product.id, name: product.name, price, currency: config.brand.currency, quantity })
  }
  return out
}

const PAYMENT_METHODS = ['stripe', 'comgate', 'gopay', 'paypal', 'dobirka', 'prevod']

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (!body?.items?.length) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
  const items = priceItems(body.items)
  if (!items) return NextResponse.json({ error: 'Some items in your cart are no longer available. Please review your cart.' }, { status: 400 })
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  const projectId = process.env.QUANTE_PROJECT_ID
  if (projectId) {
    // Fail closed: never fall back to a hard-coded platform host.
    const quanteUrl = platformUrl()
    if (!quanteUrl) return NextResponse.json({ error: 'Checkout is not configured for this store.' }, { status: 503 })
    // The platform builds Stripe success/cancel URLs from the Origin header of this
    // request. A server-to-server fetch() doesn't set one automatically the way a
    // browser request does, so it's forwarded explicitly from the original browser
    // request's own Origin/Host — otherwise Stripe would redirect back to the
    // platform instead of this store's own domain.
    const storeOrigin = storeOriginOf(request)

    // Shipping is priced from the merchant's configured methods, not the client.
    const shippingMethod = cleanString(body.shippingMethod)
    let shippingCents = 0
    try {
      const sr = await fetch(quanteUrl + '/api/store/shipping?projectId=' + encodeURIComponent(projectId), { cache: 'no-store' })
      if (!sr.ok) throw new Error('shipping lookup failed')
      const sd = await sr.json() as { methods?: Array<{ id: string; label: string; price: number }>; freeShippingFrom?: number }
      const methods = sd.methods ?? []
      if (methods.length > 0) {
        const method = methods.find((m) => m.label === shippingMethod || m.id === shippingMethod)
        if (!method) return NextResponse.json({ error: 'Please select a shipping method.' }, { status: 400 })
        const freeFrom = Number(sd.freeShippingFrom ?? 0)
        const free = freeFrom > 0 && subtotal >= freeFrom
        shippingCents = free ? 0 : Math.max(0, Math.round(Number(method.price) * 100) || 0)
      }
    } catch {
      return NextResponse.json({ error: 'Shipping options are unavailable right now. Please try again.' }, { status: 503 })
    }

    const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : undefined
    const res = await fetch(quanteUrl + '/api/store/checkout', {
      method: 'POST',
      headers: storeKeyHeaders({ 'Content-Type': 'application/json', Origin: storeOrigin, ...shopperIpHeader(request) }),
      body: JSON.stringify({
        items,
        paymentMethod,
        shippingMethod,
        shippingCents,
        shippingCountry: cleanString(body.shippingCountry, 2),
        customerEmail: cleanString(body.customerEmail, 254),
        customerName: cleanString(body.customerName),
        customerPhone: cleanString(body.customerPhone, 40),
        shippingAddress: cleanAddress(body.shippingAddress),
        // Last, from env only — never from the request body.
        projectId,
      }),
    })
    const data = await res.json().catch(() => ({ error: 'Checkout failed. Please try again.' }))
    if (data && data.url !== undefined && !isAllowedRedirect(data.url, storeOrigin)) {
      return NextResponse.json({ error: 'Checkout failed. Please try again.' }, { status: 502 })
    }
    return NextResponse.json(data, { status: res.status })
  }

  // ── Self-hosted mode ────────────────────────────────────────────────────────
  const customerEmail = cleanString(body.customerEmail, 254)
  const origin = request.headers.get('origin') || 'http://localhost:3000'
  const currency = (config.brand.currency || 'USD').toLowerCase()

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({
      error: 'This store is not connected to a payment provider yet. Add STRIPE_SECRET_KEY to .env.local and run: npm install stripe',
    }, { status: 503 })
  }
  try {
    // stripe is a real listed dependency (see the dependencies block above) so
    // this import is properly typed — do NOT add @ts-expect-error here, it will
    // fail the build with "Unused '@ts-expect-error' directive" (confirmed live
    // 2026-08-27 on Nordwool right after the stripe-dependency fix shipped).
    const { default: Stripe } = await import('stripe')
    // apiVersion is cast to any (same pattern as lib/stripe.ts) instead of a
    // literal string — the installed stripe package pins its TS types to
    // whatever its OWN latest API version literal is, which drifts every time
    // the dependency is bumped. A hardcoded literal string here breaks the
    // build the moment it stops matching that literal, and Quante's auto-fix
    // loop cannot converge on it (confirmed live 2026-08-27: it oscillated
    // between adding/removing/changing this exact option across 5 attempts
    // without resolving). Casting to any sidesteps the literal-type check.
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-04-30.basil' as any })
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map((i) => ({
        price_data: { currency, product_data: { name: i.name }, unit_amount: Math.round(i.price * 100) },
        quantity: i.quantity,
      })),
      mode: 'payment',
      success_url: \`\${origin}/success\`,
      cancel_url: \`\${origin}/cart\`,
      customer_email: customerEmail,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
`)

  // ── app/api/shipping/route.ts ─────────────────────────────────────────────
  // Added 2026-08-22 alongside the market/language work: proxies to the Quante
  // platform's /api/store/shipping so the cart page can show the merchant's
  // actually-configured shipping methods and prices — same hosted-mode pattern as
  // app/api/checkout/route.ts. Self-hosted mode gets a single free "Standard
  // shipping" fallback (no merchant-side config to read without Quante).
  add('app/api/shipping/route.ts', `import { NextResponse } from 'next/server'
import { platformUrl } from '@/lib/platform'

export async function GET() {
  const projectId = process.env.QUANTE_PROJECT_ID
  const quanteUrl = platformUrl()
  if (projectId && quanteUrl) {
    try {
      const res = await fetch(quanteUrl + '/api/store/shipping?projectId=' + encodeURIComponent(projectId), { cache: 'no-store' })
      if (res.ok) return NextResponse.json(await res.json())
    } catch {
      // fall through to default below
    }
  }
  return NextResponse.json({ methods: [{ id: 'standard', label: 'Standard shipping', price: 0 }], freeShippingFrom: 0 })
}
`)

  // ── components/legal/LegalPageView.tsx + app/{terms,privacy,cookies,contact}/page.tsx
  // (LOCKED) — Added 2026-08-21 alongside app/api/store/legal (platform side): the
  // Publish panel's "Generate legal pages" button used to write into manifest_versions,
  // which the live code-gen storefront never reads — legal pages could never actually
  // appear on a deployed store, so footer links to them 404'd regardless of whether
  // merchant data was filled in. These 4 routes always exist in the scaffold; in hosted
  // mode they fetch live content generated from the merchant's saved business info
  // (same QUANTE_PROJECT_ID pattern as app/api/checkout/route.ts), so the pages update
  // automatically without a redeploy whenever the merchant edits their business data.
  add('components/legal/LegalPageView.tsx', `import { config } from '@/data/config'
import { t } from '@/lib/i18n'
import { platformUrl } from '@/lib/platform'

interface LegalSection { heading?: string; body: string[] }
interface LegalPageData { title: string; sections: LegalSection[] }

async function getLegalContent(page: string): Promise<LegalPageData | null> {
  const projectId = process.env.QUANTE_PROJECT_ID
  const quanteUrl = platformUrl()
  if (!projectId || !quanteUrl) return null
  try {
    const res = await fetch(quanteUrl + '/api/store/legal?projectId=' + encodeURIComponent(projectId) + '&page=' + encodeURIComponent(page), { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const FALLBACK_TITLES: Record<string, StringKeyForTitle> = {
  terms: 'termsOfService', privacy: 'privacyPolicy', cookies: 'cookiePolicy', contact: 'contact',
}
type StringKeyForTitle = 'termsOfService' | 'privacyPolicy' | 'cookiePolicy' | 'contact'

export default async function LegalPageView({ page }: { page: string }) {
  const data = await getLegalContent(page)

  if (!data) {
    const key = FALLBACK_TITLES[page] ?? 'contact'
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.25rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, marginBottom: '1rem' }}>{t(key)}</h1>
        <p style={{ fontSize: 15, color: 'var(--color-muted)', lineHeight: 1.7 }}>
          {t('legalNotConfigured')}
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.25rem' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, marginBottom: '2rem' }}>{data.title}</h1>
      {data.sections.map((s, i) => (
        <section key={i} style={{ marginBottom: '1.75rem' }}>
          {s.heading && (
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 700, marginBottom: '0.6rem', color: 'var(--color-text)' }}>{s.heading}</h2>
          )}
          {s.body.map((para, j) => (
            <p key={j} style={{ fontSize: 15, color: 'var(--color-muted)', lineHeight: 1.7, marginBottom: '0.6rem' }}>{para}</p>
          ))}
        </section>
      ))}
      <p style={{ fontSize: 12, color: 'var(--color-muted)', opacity: 0.6, marginTop: '2.5rem' }}>{config.brand.name}</p>
    </div>
  )
}
`)

  add('app/terms/page.tsx', `import LegalPageView from '@/components/legal/LegalPageView'
export default function Page() { return <LegalPageView page="terms" /> }
`)
  add('app/privacy/page.tsx', `import LegalPageView from '@/components/legal/LegalPageView'
export default function Page() { return <LegalPageView page="privacy" /> }
`)
  add('app/cookies/page.tsx', `import LegalPageView from '@/components/legal/LegalPageView'
export default function Page() { return <LegalPageView page="cookies" /> }
`)
  add('app/contact/page.tsx', `import LegalPageView from '@/components/legal/LegalPageView'
export default function Page() { return <LegalPageView page="contact" /> }
`)

  // ── components/layout/Navbar.tsx ─────────────────────────────────────────
  add('components/layout/Navbar.tsx', `'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ShoppingBag, Menu, X } from 'lucide-react'
import { useCart } from '@/lib/store/cart'
import { config } from '@/data/config'
import { CartDrawer } from './CartDrawer'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const { count } = useCart()

  return (
    <>
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 1.25rem', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <Link href="/" style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, textDecoration: 'none', color: 'var(--color-text)', letterSpacing: '-.02em', flexShrink: 0 }}>
            {config.brand.logoText ?? config.brand.name}
          </Link>

          <nav className="hidden md:flex" style={{ gap: 28, alignItems: 'center' }}>
            {config.nav.map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: 14, color: 'var(--color-text)', textDecoration: 'none', opacity: 0.8 }}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setCartOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', padding: 8, position: 'relative', lineHeight: 0 }}
              aria-label="Open cart"
            >
              <ShoppingBag size={20} />
              {count > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2, background: 'var(--color-accent)', color: 'var(--color-accent-text)',
                  borderRadius: '50%', width: 16, height: 16, fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', padding: 8, lineHeight: 0 }}
              aria-label="Menu"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: '0.75rem 1.25rem 1rem' }}>
            {config.nav.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} style={{ display: 'block', padding: '0.6rem 0', fontSize: 15, color: 'var(--color-text)', textDecoration: 'none', borderBottom: '1px solid var(--color-border)' }}>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </>
  )
}
`)

  // ── components/layout/Footer.tsx ─────────────────────────────────────────
  add('components/layout/Footer.tsx', `import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { config } from '@/data/config'
import { t } from '@/lib/i18n'

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function Footer() {
  return (
    <footer style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', marginTop: 'auto' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3rem 1.25rem 2rem' }}>
        {config.footer.columns.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '2rem', marginBottom: '2.5rem' }}>
            {config.footer.columns.map((col, i) => (
              <div key={i}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>{col.title}</p>
                <ul style={{ listStyle: 'none' }}>
                  {col.links.map((link) => (
                    <li key={link.href} style={{ marginBottom: '0.5rem' }}>
                      <Link href={link.href} style={{ fontSize: 14, color: 'var(--color-text)', textDecoration: 'none', opacity: 0.75 }}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderTop: config.footer.columns.length > 0 ? '1px solid var(--color-border)' : 'none', paddingTop: config.footer.columns.length > 0 ? '1.5rem' : 0, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            © {new Date().getFullYear()} {config.brand.name}
            {config.footer.legal && !config.footer.legal.includes('©') ? ' — ' + config.footer.legal : ''}
          </span>
          {config.footer.socials && config.footer.socials.length > 0 && (
            <div style={{ display: 'flex', gap: 14 }}>
              {config.footer.socials.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={capitalize(s.platform)} title={capitalize(s.platform)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-muted)', textDecoration: 'none' }}>
                  <ExternalLink size={13} />
                </a>
              ))}
            </div>
          )}
        </div>
        {/* Always-present legal links — independent of AI-authored footer columns,
            so these routes (which always exist in the scaffold) are never dead links. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          <Link href="/terms" style={{ fontSize: 12, color: 'var(--color-muted)', textDecoration: 'none', opacity: 0.7 }}>{t('termsOfService')}</Link>
          <Link href="/privacy" style={{ fontSize: 12, color: 'var(--color-muted)', textDecoration: 'none', opacity: 0.7 }}>{t('privacyPolicy')}</Link>
          <Link href="/cookies" style={{ fontSize: 12, color: 'var(--color-muted)', textDecoration: 'none', opacity: 0.7 }}>{t('cookiePolicy')}</Link>
          <Link href="/contact" style={{ fontSize: 12, color: 'var(--color-muted)', textDecoration: 'none', opacity: 0.7 }}>{t('contact')}</Link>
        </div>
      </div>
    </footer>
  )
}
`)

  // ── components/layout/CookieConsent.tsx (LOCKED) ─────────────────────────
  // Added 2026-08-21: lib/store-health.ts's checklist has always checked for a file
  // ending in "CookieConsent.tsx" in code_versions, but buildCodeGenScaffold() never
  // actually emitted one — every code-gen store failed this checklist item forever,
  // and the old detail text ("regenerate the store") wasn't even the right fix. Same
  // gap pattern as the checkout and legal-pages issues: deterministic core behavior
  // that got dropped during the manifest→code-gen pivot and never rebuilt.
  add('components/layout/CookieConsent.tsx', `'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { t } from '@/lib/i18n'

const STORAGE_KEY = 'cookie-consent'

export function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch {
      // localStorage unavailable (e.g. blocked) — skip the banner rather than error
    }
  }, [])

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, 'accepted') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)',
      padding: '1rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between',
    }}>
      <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, maxWidth: 640 }}>
        {t('cookieMessage')}{' '}
        <Link href="/cookies" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>{t('learnMore')}</Link>
      </p>
      <button
        onClick={accept}
        style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)', border: 'none', borderRadius: 6, padding: '0.5rem 1rem', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        {t('accept')}
      </button>
    </div>
  )
}
`)

  // ── app/layout.tsx (LOCKED — scaffold always provides Navbar + Footer) ────
  add('app/layout.tsx', `import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CartProvider } from '@/lib/store/cart'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { CookieConsent } from '@/components/layout/CookieConsent'
import { config } from '@/data/config'
import '../styles/store.css'

export const metadata: Metadata = {
  title: config.seo?.title ?? config.brand.name,
  description: config.seo?.description ?? config.brand.tagline,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={config.brand.language ?? 'en'}>
      <body style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <CartProvider>
          <Navbar />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
          <CookieConsent />
        </CartProvider>
      </body>
    </html>
  )
}
`)

  // ── components/store/AboutPage.tsx (fallback — Claude overrides) ──────────
  add('components/store/AboutPage.tsx', `import { config } from '@/data/config'

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.25rem' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 700, marginBottom: '1rem' }}>{config.brand.name}</h1>
      <p style={{ fontSize: 18, color: 'var(--color-muted)', marginBottom: '2rem', lineHeight: 1.7 }}>{config.brand.tagline}</p>
    </div>
  )
}
`)

  // ── app/about/page.tsx ────────────────────────────────────────────────────
  add('app/about/page.tsx', `import AboutPage from '@/components/store/AboutPage'
export default function Page() { return <AboutPage /> }
`)

  // ── app/page.tsx (home) ───────────────────────────────────────────────────
  add('app/page.tsx', `import HomePage from '@/components/store/HomePage'

export default function Page() {
  return <HomePage />
}
`)

  // ── app/products/[slug]/page.tsx ──────────────────────────────────────────
  add('app/products/[slug]/page.tsx', `import ProductDetailPage from '@/components/store/ProductDetailPage'

interface Props { params: Promise<{ slug: string }> }

export default async function Page({ params }: Props) {
  const { slug } = await params
  return <ProductDetailPage slug={slug} />
}
`)

  // ── app/collections/[slug]/page.tsx ──────────────────────────────────────
  add('app/collections/[slug]/page.tsx', `import CollectionPage from '@/components/store/CollectionPage'

interface Props { params: Promise<{ slug: string }> }

export default async function Page({ params }: Props) {
  const { slug } = await params
  return <CollectionPage slug={slug} />
}
`)

  // ── styles/store.css (fallback — Claude's version overrides this) ─────────
  add('styles/store.css', `@import "tailwindcss";

:root {
  --color-bg: #ffffff;
  --color-text: #111111;
  --color-accent: #111111;
  --color-accent-text: #ffffff;
  --color-muted: #6b7280;
  --color-surface: #f9fafb;
  --color-border: #e5e7eb;
  --font-heading: Inter, sans-serif;
  --font-body: Inter, sans-serif;
  --radius: 8px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-body); background-color: var(--color-bg); color: var(--color-text); -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }
a { color: inherit; }
`)

  return files
}

// ─── Lucide import sanitizer ─────────────────────────────────────────────────
// Replaces icon names that don't exist in the installed lucide-react version.
// Applied to every AI-generated TS/TSX file before deployment.

const LUCIDE_REPLACEMENTS: Record<string, string> = {
  Instagram: 'ExternalLink',
  Twitter: 'ExternalLink',
  Facebook: 'ExternalLink',
  Youtube: 'ExternalLink',
  YouTube: 'ExternalLink',
  TikTok: 'ExternalLink',
  Tiktok: 'ExternalLink',
  Pinterest: 'ExternalLink',
  Snapchat: 'ExternalLink',
  Discord: 'MessageSquare',
  Twitch: 'ExternalLink',
  Reddit: 'ExternalLink',
  Telegram: 'Send',
  WhatsApp: 'MessageCircle',
  Whatsapp: 'MessageCircle',
  Music: 'ExternalLink',
  Music2: 'ExternalLink',
  Music3: 'ExternalLink',
  Music4: 'ExternalLink',
  Spotify: 'ExternalLink',
  Behance: 'ExternalLink',
  Dribbble: 'ExternalLink',
  Vimeo: 'ExternalLink',
  Medium: 'ExternalLink',
}

function sanitizeCss(content: string): string {
  // Strip any HTML <style> / </style> tags Claude may accidentally inject into .css files
  return content.replace(/<\/?style[^>]*>/gi, '').trim()
}

function sanitizeLucideImports(content: string): string {
  let result = content

  for (const [bad, good] of Object.entries(LUCIDE_REPLACEMENTS)) {
    // Replace all usages: in JSX, in type annotations, in object values, in imports
    result = result.replace(new RegExp(`\\b${bad}\\b`, 'g'), good)
  }

  // Deduplicate icon names inside lucide-react imports that may now have duplicates
  result = result.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g,
    (_match, imports: string) => {
      const names = [...new Set(
        imports.split(',').map((s) => s.trim()).filter(Boolean)
      )]
      return `import { ${names.join(', ')} } from 'lucide-react'`
    },
  )

  return result
}

// ─── Code-gen build (new approach) ───────────────────────────────────────────
// Takes AI-generated files and merges them with the scaffold.

export function buildStoreFiles(codeFiles: CodeVersionFiles): GeneratedFile[]

// ─── Legacy manifest build (old approach) ────────────────────────────────────
// Kept for /api/export and backward compatibility.

export function buildStoreFiles(manifest: ShopManifest, customComponents?: CustomComponentRecord[]): GeneratedFile[]

export function buildStoreFiles(
  arg: CodeVersionFiles | ShopManifest,
  customComponents: CustomComponentRecord[] = [],
): GeneratedFile[] {
  // Detect which mode we're in:
  // CodeVersionFiles is a plain Record<string, string> (values are strings)
  // ShopManifest has a `brand` object with string fields
  const isCodeFiles = arg && typeof arg === 'object' && !('brand' in arg)

  if (isCodeFiles) {
    const codeFiles = arg as CodeVersionFiles
    const scaffold = buildCodeGenScaffold()

    // Merge: AI-generated files override scaffold files with the same path.
    // Locked paths are always taken from the scaffold — Claude cannot override them.
    // app/cart/page.tsx, app/success/page.tsx, and app/api/checkout/route.ts joined
    // this list 2026-08-21 — checkout is core-engine behavior (cart, routing, payment
    // wiring), not something an individual generation run should be free to omit or
    // rewrite. Before this, nothing stopped the AI from silently not writing a cart
    // page at all, which is exactly what happened to every store generated up to
    // this point — the "Checkout" button in every deployed store 404'd.
    const LOCKED = new Set([
      'app/layout.tsx', 'components/layout/Navbar.tsx', 'components/layout/Footer.tsx', 'components/layout/CartDrawer.tsx',
      'app/cart/page.tsx', 'app/success/page.tsx', 'app/api/checkout/route.ts', 'app/api/shipping/route.ts',
      // Legal pages (2026-08-21) — always live-fetched from saved business info via
      // app/api/store/legal, same rationale as checkout: correctness over AI freedom.
      'components/legal/LegalPageView.tsx',
      'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx', 'app/contact/page.tsx',
      'components/layout/CookieConsent.tsx',
      // i18n (2026-08-22) — the scaffold's fixed UI strings/locale formatting;
      // must always reflect the actual dictionary, not something a generation
      // run could accidentally omit or overwrite with different keys.
      'lib/i18n.ts',
      // Security (2026-09): build/deploy configuration and the hosted-mode helper
      // always come from the scaffold, even for code_versions rows saved before the
      // AI path allowlist existed.
      'package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js', 'next.config.mjs',
      'postcss.config.mjs', 'postcss.config.js', 'tailwind.config.ts', 'tailwind.config.js',
      'next-env.d.ts', 'vercel.json', 'lib/platform.ts',
    ])

    const scaffoldMap = new Map(scaffold.map((f) => [f.path, f]))
    for (const [filePath, content] of Object.entries(codeFiles)) {
      if (LOCKED.has(filePath)) continue  // scaffold version always wins
      // Defence in depth: drop anything outside the AI allowlist (route handlers,
      // middleware, vercel.json, package.json, dotfiles, server-only code…).
      const rejected = rejectAiStoreFile(filePath, content)
      if (rejected) {
        console.warn(`[buildStoreFiles] dropped AI file "${filePath.slice(0, 200)}": ${rejected}`)
        continue
      }
      const sanitized = filePath.endsWith('.css')
        ? sanitizeCss(content)
        : (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
          ? sanitizeLucideImports(content)
          : content
      scaffoldMap.set(filePath, { path: filePath, content: sanitized, encoding: 'utf-8' })
    }

    return Array.from(scaffoldMap.values())
  }

  // Legacy manifest mode
  const manifest = arg as ShopManifest
  const slug = toStoreSlug(manifest.brand.name) || 'my-store'
  const files: GeneratedFile[] = []
  const cwd = process.cwd()
  const sfBase = path.join(cwd, 'components', 'storefront')

  function add(name: string, content: string) {
    files.push({ path: name, content, encoding: 'utf-8' })
  }

  function addFile(name: string, src: string) {
    files.push({ path: name, content: fs.readFileSync(src, 'utf-8'), encoding: 'utf-8' })
  }

  // ── package.json ──────────────────────────────────────────────────────────
  add('package.json', JSON.stringify({
    name: slug,
    version: '1.0.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: {
      'framer-motion': '^12.40.0',
      'lucide-react': '^1.17.0',
      next: '16.2.7',
      react: '19.2.4',
      'react-dom': '19.2.4',
      // Only actually called from app/api/checkout/route.ts's self-hosted-mode
      // branch (QUANTE_PROJECT_ID unset) — hosted stores never execute it. But
      // Next's bundler still statically resolves the dynamic import('stripe')
      // at build time regardless of which runtime branch is live, so without
      // this listed as a real dependency the build fails outright with
      // "Module not found: Can't resolve 'stripe'" -- confirmed live 2026-08-27
      // on a Quante-hosted store stuck in a failed-build loop over this exact
      // error. Keep in sync with the root package.json's stripe version.
      stripe: '^22.2.0',
      // Bank-transfer QR is rendered locally on the success page (it used to be
      // fetched from a third-party QR service, leaking payment data).
      qrcode: '^1.5.4',
    },
    devDependencies: {
      '@tailwindcss/postcss': '^4',
      '@types/node': '^20',
      '@types/qrcode': '^1.5.5',
      '@types/react': '^19',
      '@types/react-dom': '^19',
      tailwindcss: '^4',
      typescript: '^5',
    },
  }, null, 2))

  // ── tsconfig.json ─────────────────────────────────────────────────────────
  add('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2))

  const hasAdmin = (manifest as unknown as Record<string, unknown>).adminPanel === true

  // ── next.config.ts ────────────────────────────────────────────────────────
  add('next.config.ts', buildNextConfig(hasAdmin))

  // ── lib/platform.ts ───────────────────────────────────────────────────────
  add('lib/platform.ts', PLATFORM_HELPER_TS)

  // ── postcss.config.mjs ────────────────────────────────────────────────────
  add('postcss.config.mjs', `const config = { plugins: { '@tailwindcss/postcss': {} } }\nexport default config\n`)

  // ── next-env.d.ts ─────────────────────────────────────────────────────────
  add('next-env.d.ts', `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`)

  // ── app/globals.css ───────────────────────────────────────────────────────
  add('app/globals.css', `@import "tailwindcss";\n\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { -webkit-font-smoothing: antialiased; }\n`)

  // ── app/layout.tsx ────────────────────────────────────────────────────────
  const lang = manifest.catalog.currency === 'CZK' ? 'cs' : 'en'
  add('app/layout.tsx', `\
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { manifest } from '@/data/manifest'
import { CartProvider } from '@/context/cart'
import { MotionProvider } from '@/components/storefront/motion/context'
import './globals.css'

export const metadata: Metadata = {
  title: manifest.seo.title,
  description: manifest.seo.description,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="${lang}">
      <body>
        <CartProvider>
          <MotionProvider level={manifest.design.motion ?? 'subtle'}>
            {children}
          </MotionProvider>
        </CartProvider>
      </body>
    </html>
  )
}
`)

  // ── app/page.tsx (home) ───────────────────────────────────────────────────
  add('app/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function HomePage() {
  return <ShopRenderer manifest={manifest} page="home" />
}
`)

  // ── app/products/[slug]/page.tsx ──────────────────────────────────────────
  add('app/products/[slug]/page.tsx', `\
import React from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'
import { AddToCartButton } from '@/components/storefront/AddToCartButton'
import { ProductGallery } from '@/components/storefront/ProductGallery'
import { StickyBuyBar } from '@/components/storefront/StickyBuyBar'

interface Props {
  params: Promise<{ slug: string }>
}

// JSON for an inline <script> element: escapes <, >, & and U+2028/U+2029 so product
// text such as "</script><script>…" can never close the tag (stored XSS).
function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\\\u003c')
    .replace(/>/g, '\\\\u003e')
    .replace(/&/g, '\\\\u0026')
    .replace(/\\u2028/g, '\\\\u2028')
    .replace(/\\u2029/g, '\\\\u2029')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) return {}
  return { title: \`\${product.name} – \${manifest.seo.title}\`, description: product.description }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: manifest.catalog.currency,
      availability: product.available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: manifest.brand.name },
    },
  }

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  return (
    <div
      style={
        {
          ...cssVars,
          background: 'var(--s-bg)',
          color: 'var(--s-text)',
          fontFamily: 'var(--s-font-body)',
          minHeight: '100vh',
        } as React.CSSProperties
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />

      <StoreNavbar manifest={manifest} />

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'calc(3rem * var(--s-space))', alignItems: 'start' }}>
          <ProductGallery images={product.images} name={product.name} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(1.5rem * var(--s-space))' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--s-text)', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
                {product.name}
              </h1>
              <p style={{ fontFamily: 'var(--s-font-heading)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--s-accent)' }}>
                {manifest.catalog.currency} {product.price.toFixed(2)}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.25rem 0.625rem', borderRadius: 99, fontSize: '0.8125rem', fontWeight: 600,
                background: product.available ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                color: product.available ? '#059669' : '#dc2626',
                border: \`1px solid \${product.available ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}\`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: product.available ? '#34d399' : '#f87171', display: 'inline-block' }} />
                {product.available ? 'Skladem' : 'Vyprodáno'}
              </span>
              {product.available && (
                <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>Expedice 1–2 pracovní dny</span>
              )}
            </div>
            <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75 }}>{product.description}</p>
            <AddToCartButton
              productId={product.id}
              name={product.name}
              price={product.price}
              currency={manifest.catalog.currency}
              image={product.images[0]}
              available={product.available}
            />
            <StickyBuyBar
              productId={product.id}
              name={product.name}
              price={product.price}
              currency={manifest.catalog.currency}
              image={product.images[0]}
              available={product.available}
            />
          </div>
        </div>

        {manifest.pages.product.length > 0 && (
          <div style={{ marginTop: 'calc(6rem * var(--s-space))' }}>
            {manifest.pages.product.map((section, i) => (
              <SectionRenderer key={i} section={section} manifest={manifest} />
            ))}
          </div>
        )}
      </main>

      <StoreFooter manifest={manifest} />
    </div>
  )
}

export function generateStaticParams() {
  return manifest.catalog.products.map((p) => ({ slug: p.slug }))
}
`)

  // ── app/collections/[slug]/page.tsx ──────────────────────────────────────
  add('app/collections/[slug]/page.tsx', `\
import { notFound } from 'next/navigation'
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

interface Props { params: Promise<{ slug: string }> }

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params
  const collection = manifest.catalog.collections?.find((c) => c.slug === slug)
  if (!collection) notFound()
  return <ShopRenderer manifest={manifest} page="collection" />
}

export function generateStaticParams() {
  return (manifest.catalog.collections ?? []).map((c) => ({ slug: c.slug }))
}
`)

  // ── app/about/page.tsx ────────────────────────────────────────────────────
  add('app/about/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function AboutPage() {
  return <ShopRenderer manifest={manifest} page="about" />
}
`)

  // ── app/contact/page.tsx ──────────────────────────────────────────────────
  add('app/contact/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function ContactPage() {
  return <ShopRenderer manifest={manifest} page="contact" />
}
`)

  // ── app/[slug]/page.tsx — catch-all for custom pages ─────────────────────
  add('app/[slug]/page.tsx', `\
import { notFound } from 'next/navigation'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'

interface Props { params: Promise<{ slug: string }> }

export default async function CustomPage({ params }: Props) {
  const { slug } = await params
  const page = manifest.customPages?.find((p) => p.slug === slug)
  if (!page) notFound()

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        {page.sections.map((section, i) => (
          <SectionRenderer key={i} section={section} manifest={manifest} />
        ))}
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}

export function generateStaticParams() {
  return (manifest.customPages ?? []).map((p) => ({ slug: p.slug }))
}
`)

  // ── types/manifest.ts — verbatim copy ─────────────────────────────────────
  addFile('types/manifest.ts', path.join(cwd, 'types', 'manifest.ts'))

  // ── storefront components — verbatim copies ───────────────────────────────
  addFile('components/storefront/tokens.ts', path.join(sfBase, 'tokens.ts'))

  // ShopRenderer — verbatim copy, but strip the projectId prop since the export never needs it
  addFile('components/storefront/ShopRenderer.tsx', path.join(sfBase, 'ShopRenderer.tsx'))

  // Custom components (AI / marketplace-authored). Security (R11): never compiled into
  // the exported app — each is rendered in a sandboxed srcdoc iframe (see
  // buildSandboxedComponentHtml). Only refs that are plain identifiers are accepted
  // (they become object keys in sources.ts).
  customComponents = customComponents.filter((c) => typeof c?.ref === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.ref) && typeof c.code === 'string')
  if (customComponents.length > 0) {
    add('components/custom/sources.ts', buildCustomSourcesTs(customComponents))
    add('components/custom/SandboxedComponent.tsx', SANDBOXED_COMPONENT_TSX)
  }
  add('components/storefront/SectionRenderer.tsx', buildExportSectionRenderer(customComponents.length > 0))
  // Imported by StoreNavbar and ProductGallery — the export failed to build without it.
  addFile('lib/scroll-lock.ts', path.join(cwd, 'lib', 'scroll-lock.ts'))

  // ── Motion primitives ─────────────────────────────────────────────────────
  addFile('components/storefront/motion/config.ts', path.join(sfBase, 'motion', 'config.ts'))
  addFile('components/storefront/motion/context.tsx', path.join(sfBase, 'motion', 'context.tsx'))
  addFile('components/storefront/motion/hooks.ts', path.join(sfBase, 'motion', 'hooks.ts'))
  addFile('components/storefront/motion/Reveal.tsx', path.join(sfBase, 'motion', 'Reveal.tsx'))
  addFile('components/storefront/motion/Stagger.tsx', path.join(sfBase, 'motion', 'Stagger.tsx'))
  addFile('components/storefront/motion/ParallaxImage.tsx', path.join(sfBase, 'motion', 'ParallaxImage.tsx'))
  addFile('components/storefront/motion/HoverSwap.tsx', path.join(sfBase, 'motion', 'HoverSwap.tsx'))
  addFile('components/storefront/motion/BlurImage.tsx', path.join(sfBase, 'motion', 'BlurImage.tsx'))
  addFile('components/storefront/motion/Marquee.tsx', path.join(sfBase, 'motion', 'Marquee.tsx'))
  addFile('components/storefront/motion/CountUp.tsx', path.join(sfBase, 'motion', 'CountUp.tsx'))
  addFile('components/storefront/layout/StoreNavbar.tsx', path.join(sfBase, 'layout', 'StoreNavbar.tsx'))
  addFile('components/storefront/layout/StoreFooter.tsx', path.join(sfBase, 'layout', 'StoreFooter.tsx'))
  addFile('components/storefront/sections/Hero.tsx', path.join(sfBase, 'sections', 'Hero.tsx'))
  addFile('components/storefront/sections/ProductGrid.tsx', path.join(sfBase, 'sections', 'ProductGrid.tsx'))
  addFile('components/storefront/sections/ProductCard.tsx', path.join(sfBase, 'sections', 'ProductCard.tsx'))
  addFile('components/storefront/sections/FeatureRow.tsx', path.join(sfBase, 'sections', 'FeatureRow.tsx'))
  addFile('components/storefront/sections/Testimonials.tsx', path.join(sfBase, 'sections', 'Testimonials.tsx'))
  addFile('components/storefront/sections/RichText.tsx', path.join(sfBase, 'sections', 'RichText.tsx'))
  addFile('components/storefront/sections/Banner.tsx', path.join(sfBase, 'sections', 'Banner.tsx'))
  addFile('components/storefront/sections/Newsletter.tsx', path.join(sfBase, 'sections', 'Newsletter.tsx'))
  addFile('components/storefront/sections/Gallery.tsx', path.join(sfBase, 'sections', 'Gallery.tsx'))
  addFile('components/storefront/sections/Faq.tsx', path.join(sfBase, 'sections', 'Faq.tsx'))
  addFile('components/storefront/sections/Animations.tsx', path.join(sfBase, 'sections', 'Animations.tsx'))
  addFile('components/storefront/CookieConsent.tsx', path.join(sfBase, 'CookieConsent.tsx'))

  // ── Cart context ──────────────────────────────────────────────────────────
  addFile('context/cart.tsx', path.join(cwd, 'context', 'cart.tsx'))

  // ── CartIcon (navbar) ─────────────────────────────────────────────────────
  addFile('components/storefront/CartIcon.tsx', path.join(sfBase, 'CartIcon.tsx'))

  // ── Storefront interactive components ────────────────────────────────────
  addFile('components/storefront/AddToCartButton.tsx', path.join(sfBase, 'AddToCartButton.tsx'))
  addFile('components/storefront/ProductGallery.tsx', path.join(sfBase, 'ProductGallery.tsx'))
  addFile('components/storefront/StickyBuyBar.tsx', path.join(sfBase, 'StickyBuyBar.tsx'))

  // ── app/cart/page.tsx ──────────────────────────────────────────────────────
  add('app/cart/page.tsx', `'use client'
import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

const SHIPPING_LABELS: Record<string, string> = {
  zasilkovna: 'Zásilkovna',
  packeta_international: 'Packeta International',
  dhl: 'DHL Express — celosvětová doprava',
  ppl: 'PPL — doručení na adresu',
  dpd: 'DPD — doručení na adresu',
  balikovna: 'Balíkovna',
  osobni_odber: 'Osobní odběr',
  custom: 'Doprava',
}

const PAYMENT_LABELS: Record<string, string> = {
  comgate: 'Platba online (karta, Apple Pay, bankovní tlačítka)',
  gopay: 'Platba online (GoPay)',
  stripe: 'Platba kartou',
  dobirka: 'Dobírka',
  prevod: 'Bankovní převod',
}

export default function CartPage() {
  const { items, updateQty, remove, total, clear } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)

  const shippingMethods = manifest.shipping?.methods ?? []
  const paymentProviders = manifest.payments?.providers ?? []
  const hasDobirka = manifest.payments?.dobirka?.enabled ?? false
  const dobirkaSurcharge = manifest.payments?.dobirka?.priplatek_czk ?? 0
  const hasPrevod = manifest.payments?.prevod?.enabled ?? false
  const freeShippingThreshold = manifest.shipping?.doprava_zdarma_od_czk ?? 0

  const allPaymentOptions = [
    ...paymentProviders.map((p) => ({ key: p, label: PAYMENT_LABELS[p] ?? p })),
    ...(hasDobirka ? [{ key: 'dobirka', label: PAYMENT_LABELS.dobirka }] : []),
    ...(hasPrevod ? [{ key: 'prevod', label: PAYMENT_LABELS.prevod }] : []),
    // If merchant hasn't configured any payment methods yet, fall back to bank transfer
    ...(!paymentProviders.length && !hasDobirka && !hasPrevod ? [{ key: 'prevod', label: PAYMENT_LABELS.prevod }] : []),
  ]

  const defaultShipping = shippingMethods[0]?.type ?? ''
  const defaultPayment = allPaymentOptions[0]?.key ?? 'prevod'

  const [selectedShipping, setSelectedShipping] = useState(defaultShipping)
  const [selectedPayment, setSelectedPayment] = useState(defaultPayment)
  const [zasilkovnaId, setZasilkovnaId] = useState('')
  const [zasilkovnaName, setZasilkovnaName] = useState('')
  const [zasilkovnaCountry, setZasilkovnaCountry] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [addrUlice, setAddrUlice] = useState('')
  const [addrMesto, setAddrMesto] = useState('')
  const [addrPsc, setAddrPsc] = useState('')
  const [addrZeme, setAddrZeme] = useState('')

  const shippingObj = shippingMethods.find((m) => m.type === selectedShipping)
  const shippingCost = (freeShippingThreshold > 0 && total >= freeShippingThreshold) ? 0 : (shippingObj?.cena_czk ?? 0)
  const dobirkaFee = selectedPayment === 'dobirka' ? dobirkaSurcharge : 0
  const orderTotal = total + shippingCost + dobirkaFee
  const currency = items[0]?.currency ?? manifest.catalog.currency

  const needsAddress = selectedShipping !== 'zasilkovna' && selectedShipping !== 'packeta_international' && selectedShipping !== 'osobni_odber'
  const needsCountry = selectedShipping === 'dhl'  // DHL requires recipient country
  const needsZasilkovna = selectedShipping === 'zasilkovna' || selectedShipping === 'packeta_international'

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)
  const zasilkovnaApiKey = process.env.NEXT_PUBLIC_ZASILKOVNA_API_KEY ?? ''

  function openZasilkovnaWidget() {
    // @ts-expect-error Packeta loaded via CDN
    if (!window.Packeta?.Widget?.pick) { alert('Widget se načítá, zkuste znovu.'); return }
    // @ts-expect-error Packeta loaded via CDN
    window.Packeta.Widget.pick(zasilkovnaApiKey, (point: { id: string; name: string; country?: string } | null) => {
      if (point) {
        setZasilkovnaId(point.id)
        setZasilkovnaName(point.name)
        setZasilkovnaCountry(point.country ?? '')
      }
    }, {
      // No country filter → shows all Packeta International pickup points
      // Language is always Czech; end-user can change it in the widget
      language: 'cs',
    })
  }

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (!termsAccepted) { setError('Potvrďte prosím souhlas s obchodními podmínkami.'); return }
    if (needsZasilkovna && !zasilkovnaId) { setError('Vyberte výdejní místo Packeta.'); return }
    if (!customerEmail) { setError('Zadejte e-mailovou adresu.'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          paymentMethod: selectedPayment,
          shippingMethod: selectedShipping,
          shippingCents: Math.round(shippingCost * 100),
          dobirkaCents: Math.round(dobirkaFee * 100),
          zasilkovnaBranchId: zasilkovnaId || undefined,
          zasilkovnaBranchName: zasilkovnaName || undefined,
          zasilkovnaBranchCountry: zasilkovnaCountry || undefined,
          customerEmail,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          shippingAddress: needsAddress ? { ulice: addrUlice, mesto: addrMesto, psc: addrPsc, zeme: addrZeme || undefined } : undefined,
          shippingCountry: needsCountry ? (addrZeme || undefined) : undefined,
        }),
      })
      const data = await res.json()
      if (data.url) { window.location.href = data.url }
      else { setError(data.error || 'Chyba při odesílání objednávky.'); setLoading(false) }
    } catch {
      setError('Chyba sítě. Zkuste to prosím znovu.')
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.625rem 0.875rem', fontSize: '0.9375rem',
    background: 'var(--s-surface)', border: '1px solid var(--s-border)',
    borderRadius: 'var(--s-radius)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem', display: 'block', color: 'var(--s-text)' }
  const sectionHead: React.CSSProperties = { fontFamily: 'var(--s-font-heading)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.875rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--s-border)' }

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      {needsZasilkovna && (
        <script src="https://widget.packeta.com/v6/www/js/library.js" async />
      )}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '62rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '2rem' }}>
          Košík
        </h1>

        {items.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            style={{ textAlign: 'center', padding: '5rem 0', color: 'var(--s-muted)' }}
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.1 }}
              style={{ fontSize: '3rem', marginBottom: '1.5rem', lineHeight: 1 }}
            >
              🛒
            </motion.div>
            <p style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Váš košík je prázdný.</p>
            <a href="/" style={{ display: 'inline-block', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9375rem' }}>
              Pokračovat v nákupu
            </a>
          </motion.div>
        ) : (
          <form onSubmit={handleCheckout} style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2.5rem', alignItems: 'start' }}>
            {/* LEFT — items + options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

              {/* Items */}
              <div>
                {/* Free shipping progress bar */}
                {freeShippingThreshold > 0 && total < freeShippingThreshold && (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>Doprava zdarma od {freeShippingThreshold} {currency}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--s-accent)' }}>zbývá {(freeShippingThreshold - total).toFixed(0)} {currency}</span>
                    </div>
                    <div style={{ height: '4px', background: 'var(--s-border)', borderRadius: 99, overflow: 'hidden' }}>
                      <motion.div
                        animate={{ scaleX: Math.min(1, total / freeShippingThreshold) }}
                        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
                        style={{ height: '4px', background: 'var(--s-accent)', borderRadius: 99, width: '100%', transformOrigin: 'left' }}
                      />
                    </div>
                  </div>
                )}
                {freeShippingThreshold > 0 && total >= freeShippingThreshold && (
                  <div style={{ marginBottom: '1rem', padding: '0.625rem 1rem', background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.2)', borderRadius: 'var(--s-radius)', fontSize: '0.8125rem', color: '#059669', fontWeight: 600 }}>
                    ✓ Doprava zdarma
                  </div>
                )}

                <div style={{ border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', overflow: 'hidden' }}>
                  <AnimatePresence initial={false} mode="popLayout">
                  {items.map((item, i) => (
                    <motion.div key={item.id} layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', background: 'var(--s-surface)', borderTop: i === 0 ? 'none' : '1px solid var(--s-border)' }}>
                      {item.image && <img src={item.image} alt={item.name} style={{ width: '3rem', height: '3rem', objectFit: 'cover', borderRadius: 'calc(var(--s-radius) / 2)', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                        <p style={{ color: 'var(--s-muted)', fontSize: '0.8125rem' }}>{item.currency} {item.price.toFixed(2)} ks</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <button type="button" onClick={() => updateQty(item.id, item.quantity - 1)} style={{ width: '1.75rem', height: '1.75rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                        <span style={{ width: '1.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9375rem' }}>{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(item.id, item.quantity + 1)} style={{ width: '1.75rem', height: '1.75rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                      <p style={{ fontWeight: 700, width: '5rem', textAlign: 'right', flexShrink: 0, fontSize: '0.9375rem' }}>{item.currency} {(item.price * item.quantity).toFixed(2)}</p>
                      <button type="button" onClick={() => remove(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s-muted)', padding: '0.25rem', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }} aria-label="Odebrat">\\u00d7</button>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* Shipping */}
              {shippingMethods.length > 0 && (
                <div>
                  <p style={sectionHead}>Způsob doručení</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {shippingMethods.map((method) => {
                      const effectiveCost = freeShippingThreshold > 0 && total >= freeShippingThreshold ? 0 : method.cena_czk
                      return (
                        <label key={method.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', border: \`1px solid \${selectedShipping === method.type ? 'var(--s-accent)' : 'var(--s-border)'}\`, borderRadius: 'var(--s-radius)', cursor: 'pointer', background: 'var(--s-surface)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input type="radio" name="shipping" value={method.type} checked={selectedShipping === method.type} onChange={() => { setSelectedShipping(method.type); setZasilkovnaId(''); setZasilkovnaName(''); setZasilkovnaCountry('') }} style={{ accentColor: 'var(--s-accent)', margin: 0 }} />
                            <span style={{ fontSize: '0.9375rem', fontWeight: selectedShipping === method.type ? 600 : 400 }}>{SHIPPING_LABELS[method.type] ?? method.nazev ?? method.type}</span>
                          </div>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: effectiveCost === 0 ? '#059669' : 'var(--s-text)' }}>
                            {effectiveCost === 0 ? 'Zdarma' : \`\${effectiveCost} \${currency}\`}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {needsZasilkovna && (
                    <div style={{ marginTop: '0.75rem', padding: '0.875rem 1rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
                      {zasilkovnaId ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem' }}>{zasilkovnaName}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>
                              {zasilkovnaCountry && zasilkovnaCountry !== 'cz'
                                ? \`Packeta International · \${zasilkovnaCountry.toUpperCase()}\`
                                : 'Zásilkovna'}
                            </p>
                          </div>
                          <button type="button" onClick={openZasilkovnaWidget} style={{ fontSize: '0.8125rem', color: 'var(--s-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Změnit</button>
                        </div>
                      ) : (
                        <button type="button" onClick={openZasilkovnaWidget} style={{ width: '100%', padding: '0.625rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 600, fontSize: '0.9375rem', fontFamily: 'var(--s-font-body)', cursor: 'pointer' }}>
                          Vybrat výdejní místo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment */}
              {allPaymentOptions.length > 0 && (
                <div>
                  <p style={sectionHead}>Způsob platby</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {allPaymentOptions.map((opt) => (
                      <label key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', border: \`1px solid \${selectedPayment === opt.key ? 'var(--s-accent)' : 'var(--s-border)'}\`, borderRadius: 'var(--s-radius)', cursor: 'pointer', background: 'var(--s-surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <input type="radio" name="payment" value={opt.key} checked={selectedPayment === opt.key} onChange={() => setSelectedPayment(opt.key)} style={{ accentColor: 'var(--s-accent)', margin: 0 }} />
                          <span style={{ fontSize: '0.9375rem', fontWeight: selectedPayment === opt.key ? 600 : 400 }}>{opt.label}</span>
                        </div>
                        {opt.key === 'dobirka' && dobirkaSurcharge > 0 && (
                          <span style={{ fontSize: '0.875rem', color: 'var(--s-muted)' }}>+{dobirkaSurcharge} {currency}</span>
                        )}
                        {opt.key === 'prevod' && <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>bez poplatku</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer info */}
              <div>
                <p style={sectionHead}>Kontaktní a dodací údaje</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                    <div>
                      <label style={labelStyle}>Jméno a příjmení</label>
                      <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jan Novák" />
                    </div>
                    <div>
                      <label style={labelStyle}>Telefon</label>
                      <input style={inputStyle} type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+420 777 123 456" />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>E-mail *</label>
                    <input style={inputStyle} type="email" required value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="jan@example.cz" />
                  </div>
                  {needsAddress && (
                    <>
                      <div>
                        <label style={labelStyle}>Ulice a číslo popisné</label>
                        <input style={inputStyle} value={addrUlice} onChange={(e) => setAddrUlice(e.target.value)} placeholder="Příkladná 1" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: needsCountry ? '1fr 100px 80px' : '1fr 100px', gap: '0.875rem' }}>
                        <div>
                          <label style={labelStyle}>Město / City</label>
                          <input style={inputStyle} value={addrMesto} onChange={(e) => setAddrMesto(e.target.value)} placeholder="Praha" />
                        </div>
                        <div>
                          <label style={labelStyle}>PSČ / ZIP</label>
                          <input style={inputStyle} value={addrPsc} onChange={(e) => setAddrPsc(e.target.value)} placeholder="11000" maxLength={10} />
                        </div>
                        {needsCountry && (
                          <div>
                            <label style={labelStyle}>Stát</label>
                            <input style={inputStyle} value={addrZeme} onChange={(e) => setAddrZeme(e.target.value.toUpperCase())} placeholder="CZ" maxLength={2} />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — order summary */}
            <div style={{ position: 'sticky', top: '5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', padding: '1.5rem' }}>
                <p style={{ fontFamily: 'var(--s-font-heading)', fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>Shrnutí objednávky</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Zboží ({items.reduce((s, i) => s + i.quantity, 0)} ks)</span>
                    <span>{currency} {total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Doprava</span>
                    <span style={{ color: shippingCost === 0 ? '#059669' : 'var(--s-text)' }}>
                      {shippingCost === 0 ? 'Zdarma' : \`\${currency} \${shippingCost.toFixed(2)}\`}
                    </span>
                  </div>
                  {dobirkaFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ color: 'var(--s-muted)' }}>Dobírka</span>
                      <span>{currency} {dobirkaFee.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.875rem', borderTop: '1px solid var(--s-border)', fontSize: '1.125rem', fontWeight: 700 }}>
                  <span>Celkem s DPH</span>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={orderTotal} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                      {currency} {orderTotal.toFixed(2)}
                    </motion.span>
                  </AnimatePresence>
                </div>
                {manifest.merchant?.platce_dph && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--s-border)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>
                      <span>Základ daně (bez DPH)</span>
                      <span>{currency} {(orderTotal / 1.21).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>
                      <span>DPH 21 %</span>
                      <span>{currency} {(orderTotal - orderTotal / 1.21).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--s-accent)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', lineHeight: 1.5 }}>
                  Souhlasím s <a href="/obchodni-podminky" style={{ color: 'var(--s-accent)', textDecoration: 'none' }}>obchodními podmínkami</a> a beru na vědomí <a href="/ochrana-osobnich-udaju" style={{ color: 'var(--s-accent)', textDecoration: 'none' }}>zásady ochrany osobních údajů</a>.
                </span>
              </label>

              {error && <p style={{ fontSize: '0.875rem', color: '#f87171', margin: 0 }}>{error}</p>}

              <button
                type="submit"
                disabled={loading || !termsAccepted}
                style={{ padding: '1rem 2rem', background: termsAccepted ? 'var(--s-accent)' : 'var(--s-border)', color: termsAccepted ? 'var(--s-accent-text)' : 'var(--s-muted)', border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--s-font-body)', cursor: loading || !termsAccepted ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'all 0.2s', lineHeight: 1.3, textAlign: 'center' as const }}
              >
                {loading ? 'Odesílám…' : 'Objednat s povinností platby'}
              </button>

              <p style={{ fontSize: '0.75rem', color: 'var(--s-muted)', textAlign: 'center' as const, lineHeight: 1.5 }}>
                Stisknutím tlačítka odesíláte závaznou objednávku.
              </p>
            </div>
          </form>
        )}
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}
`)

  // ── app/api/checkout/route.ts ─────────────────────────────────────────────
  // Security (2026-09): every price (items, shipping, COD fee) is computed here
  // from the baked manifest — never taken from the request body — and the
  // project id always comes from env (the body used to be able to override it).
  add('app/api/checkout/route.ts', `\
import { NextResponse } from 'next/server'
import { manifest } from '@/data/manifest'
import { platformUrl, storeOriginOf, shopperIpHeader, isAllowedRedirect, cleanString, cleanAddress } from '@/lib/platform'

${STORE_KEY_HEADERS_FN}

interface PricedItem { id: string; productId: string; variantId?: string; name: string; price: number; currency: string; quantity: number }

// Re-prices the cart from the store's own catalog. Returns null when any line is
// unknown, unavailable or has an invalid quantity.
function priceItems(raw: unknown): PricedItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null
  const out: PricedItem[] = []
  for (const line of raw as Array<Record<string, unknown>>) {
    const lineId = typeof line?.id === 'string' ? line.id : ''
    const productId = typeof line?.productId === 'string' ? line.productId : lineId.split(':')[0]
    const variantId = typeof line?.variantId === 'string' && line.variantId ? line.variantId : undefined
    const quantity = Number(line?.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return null
    const product = manifest.catalog.products.find((p) => p.id === productId)
    if (!product || product.available === false) return null
    const variant = variantId ? product.variants?.find((v) => v.id === variantId) : undefined
    if (variantId && !variant) return null
    const price = Number(variant?.price ?? product.price)
    if (!Number.isFinite(price) || price < 0) return null
    out.push({
      id: variant ? product.id + ':' + variant.id : product.id,
      productId: product.id,
      variantId: variant?.id,
      name: variant ? product.name + ' (' + variant.name + ')' : product.name,
      price,
      currency: manifest.catalog.currency,
      quantity,
    })
  }
  return out
}

// Payment methods this store actually offers (mirrors app/cart/page.tsx).
function allowedPaymentMethods(): string[] {
  const providers: string[] = manifest.payments?.providers ?? []
  const dobirka = manifest.payments?.dobirka?.enabled ?? false
  const prevod = manifest.payments?.prevod?.enabled ?? false
  return [
    ...providers,
    ...(dobirka ? ['dobirka'] : []),
    ...(prevod || (!providers.length && !dobirka) ? ['prevod'] : []),
  ]
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (!body?.items?.length) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })

  const items = priceItems(body.items)
  if (!items) return NextResponse.json({ error: 'Některé položky v košíku již nejsou dostupné. Zkontrolujte prosím košík.' }, { status: 400 })

  const allowed = allowedPaymentMethods()
  const paymentMethod: string = typeof body.paymentMethod === 'string' ? body.paymentMethod : (allowed[0] ?? 'prevod')
  if (!allowed.includes(paymentMethod)) return NextResponse.json({ error: 'Zvolený způsob platby není dostupný.' }, { status: 400 })

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const shippingMethods = manifest.shipping?.methods ?? []
  const shippingMethod = cleanString(body.shippingMethod, 50)
  let shippingCents = 0
  if (shippingMethods.length > 0) {
    const method = shippingMethods.find((m) => m.type === shippingMethod)
    if (!method) return NextResponse.json({ error: 'Vyberte prosím způsob doručení.' }, { status: 400 })
    const freeFrom = manifest.shipping?.doprava_zdarma_od_czk ?? 0
    shippingCents = freeFrom > 0 && subtotal >= freeFrom ? 0 : Math.max(0, Math.round(Number(method.cena_czk) * 100) || 0)
  }
  const dobirkaCents = paymentMethod === 'dobirka'
    ? Math.max(0, Math.round(Number(manifest.payments?.dobirka?.priplatek_czk ?? 0) * 100) || 0)
    : 0
  const customerEmail = cleanString(body.customerEmail, 254)

  // ── Hosted mode (Quante manages payments) ─────────────────────────────────
  // QUANTE_PROJECT_ID is injected automatically when deployed via Quante.
  // Money is collected by Quante and shown in your Quante payout dashboard.
  const projectId = process.env.QUANTE_PROJECT_ID
  if (projectId) {
    // Fail closed: never fall back to a hard-coded platform host.
    const quanteUrl = platformUrl()
    if (!quanteUrl) return NextResponse.json({ error: 'Checkout is not configured for this store.' }, { status: 503 })
    // Forward the shopper's origin so payment return URLs point back at this store.
    const storeOrigin = storeOriginOf(request)
    const res = await fetch(quanteUrl + '/api/store/checkout', {
      method: 'POST',
      headers: storeKeyHeaders({ 'Content-Type': 'application/json', Origin: storeOrigin, ...shopperIpHeader(request) }),
      body: JSON.stringify({
        items,
        paymentMethod,
        shippingMethod,
        shippingCents,
        dobirkaCents,
        zasilkovnaBranchId: cleanString(body.zasilkovnaBranchId, 40),
        zasilkovnaBranchName: cleanString(body.zasilkovnaBranchName),
        zasilkovnaBranchCountry: cleanString(body.zasilkovnaBranchCountry, 2),
        shippingCountry: cleanString(body.shippingCountry, 2),
        customerEmail,
        customerName: cleanString(body.customerName),
        customerPhone: cleanString(body.customerPhone, 40),
        shippingAddress: cleanAddress(body.shippingAddress),
        // Last, from env only — never from the request body.
        projectId,
      }),
    })
    const data = await res.json().catch(() => ({ error: 'Chyba při odesílání objednávky.' }))
    if (data && data.url !== undefined && !isAllowedRedirect(data.url, storeOrigin)) {
      return NextResponse.json({ error: 'Chyba při odesílání objednávky.' }, { status: 502 })
    }
    return NextResponse.json(data, { status: res.status })
  }

  // ── Self-hosted mode (your own payment credentials) ────────────────────────
  // Set the relevant env vars in .env.local to activate each provider.
  const origin = request.headers.get('origin') || 'http://localhost:3000'
  const currency = (manifest.catalog.currency || 'CZK').toLowerCase()
  const totalCents = Math.round(subtotal * 100) + shippingCents + dobirkaCents

  // ── Stripe ──────────────────────────────────────────────────────────────────
  if (paymentMethod === 'stripe') {
    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      return NextResponse.json({
        error: 'Self-hosted Stripe: add STRIPE_SECRET_KEY to .env.local and run: npm install stripe'
      }, { status: 503 })
    }
    try {
      // stripe is a real listed dependency (see the dependencies block above) so
      // this import is properly typed — do NOT add @ts-expect-error here, it will
      // fail the build with "Unused '@ts-expect-error' directive" (confirmed live
      // 2026-08-27 on Nordwool right after the stripe-dependency fix shipped).
      const { default: Stripe } = await import('stripe')
      // apiVersion cast to any — see the matching comment in the other
      // checkout/route.ts generator above (buildCodeGenScaffold) for why.
      const stripe = new Stripe(stripeKey, { apiVersion: '2025-04-30.basil' as any })
      const lineItems = [
        ...items.map((i) => ({
          price_data: { currency, product_data: { name: i.name }, unit_amount: Math.round(i.price * 100) },
          quantity: i.quantity,
        })),
        ...(shippingCents > 0 ? [{ price_data: { currency, product_data: { name: 'Doprava' }, unit_amount: shippingCents }, quantity: 1 }] : []),
        ...(dobirkaCents > 0 ? [{ price_data: { currency, product_data: { name: 'Dobírka' }, unit_amount: dobirkaCents }, quantity: 1 }] : []),
      ]
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: \`\${origin}/success\`,
        cancel_url: \`\${origin}/cart\`,
        customer_email: customerEmail,
      })
      return NextResponse.json({ url: session.url })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Stripe error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ── Comgate ─────────────────────────────────────────────────────────────────
  if (paymentMethod === 'comgate') {
    const merchantId = process.env.COMGATE_MERCHANT_ID
    const secret = process.env.COMGATE_SECRET
    if (!merchantId || !secret) {
      return NextResponse.json({
        error: 'Self-hosted Comgate: add COMGATE_MERCHANT_ID and COMGATE_SECRET to .env.local'
      }, { status: 503 })
    }
    try {
      const params = new URLSearchParams({
        merchant: merchantId, secret,
        test: process.env.COMGATE_TEST_MODE === 'true' ? 'true' : 'false',
        country: 'CZ', price: String(totalCents), curr: currency.toUpperCase(),
        label: 'Objednávka', refId: crypto.randomUUID(), method: 'ALL',
        email: customerEmail ?? '', prepareOnly: 'true',
        returnUrl: \`\${origin}/success\`, notifUrl: \`\${origin}/api/payments/comgate/notify\`,
      })
      const res = await fetch('https://payments.comgate.cz/v1.0/create', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      const result = new URLSearchParams(await res.text())
      if (result.get('code') !== '0') {
        return NextResponse.json({ error: \`Comgate: \${result.get('message')}\` }, { status: 500 })
      }
      return NextResponse.json({ url: result.get('redirect') })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Comgate error' }, { status: 500 })
    }
  }

  // ── Dobírka / Převod ─────────────────────────────────────────────────────────
  if (paymentMethod === 'dobirka' || paymentMethod === 'prevod') {
    return NextResponse.json({ url: \`\${origin}/success?method=\${paymentMethod}\` })
  }

  return NextResponse.json({ error: 'Unknown payment method' }, { status: 400 })
}
`)

  // ── app/success/page.tsx ───────────────────────────────────────────────────
  // Security (2026-09): payment instructions (account, amount, variable symbol,
  // QR) are never read from the URL — anyone can mail customers a crafted
  // /success link. They are fetched via app/api/order-status, which asks the
  // platform to verify the per-order token, and the QR is rendered locally.
  add('app/success/page.tsx', `'use client'
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toDataURL } from 'qrcode'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

interface PaymentInfo { orderNumber: string; method: string; amount: number; currency: string; vs: string; account: string }

export default function SuccessPage() {
  const { clear } = useCart()
  const [method, setMethod] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [info, setInfo] = useState<PaymentInfo | null>(null)
  const [qrSrc, setQrSrc] = useState('')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const m = p.get('method') ?? ''
    const order = p.get('order') ?? ''
    const orderId = p.get('orderId') ?? ''
    const token = p.get('t') ?? ''
    setMethod(m)
    setOrderNumber(/^[A-Za-z0-9-]{1,40}$/.test(order) ? order : '')
    clear()
    if (m === 'prevod' && order && token) {
      const q = new URLSearchParams({ order, t: token })
      if (/^[0-9a-fA-F-]{36}$/.test(orderId)) q.set('orderId', orderId)
      fetch('/api/order-status?' + q.toString(), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PaymentInfo | null) => { if (d && typeof d.amount === 'number' && d.amount > 0) setInfo(d) })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The merchant's own account is baked into the store, so it is safe to show
  // even when the order could not be verified; amount/VS/QR need verification.
  const account = info?.account || manifest.merchant?.bankovni_ucet || ''
  const amount = info ? info.amount.toFixed(2) : ''
  const vs = info ? info.vs : ''

  useEffect(() => {
    if (!info || !account) return
    const spd = 'SPD*1.0*ACC:' + account + '*AM:' + info.amount.toFixed(2) + '*CC:' + (info.currency || manifest.catalog.currency) +
      '*MSG:Platba ' + info.orderNumber + (info.vs ? '*X-VS:' + info.vs : '')
    toDataURL(spd, { width: 180, margin: 1 }).then(setQrSrc).catch(() => setQrSrc(''))
  }, [info, account])

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  const isPrevod = method === 'prevod'
  const isDobirka = method === 'dobirka'

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '40rem', margin: '0 auto', padding: 'calc(6rem * var(--s-space)) 2rem', textAlign: 'center' }}>
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          style={{ width: '4rem', height: '4rem', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', fontSize: '1.5rem', color: '#34d399' }}
        >
          \\u2713
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.4 }}
          style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}
        >
          Objednávka přijata!
        </motion.h1>
        {orderNumber && (
          <p style={{ color: 'var(--s-muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            Číslo objednávky: <strong style={{ color: 'var(--s-text)', fontFamily: 'monospace' }}>{orderNumber}</strong>
          </p>
        )}

        {isPrevod ? (
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', textAlign: 'left' }}>
            <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>Platební instrukce</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9375rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--s-muted)' }}>Číslo účtu</span>
                <strong style={{ fontFamily: 'monospace' }}>{account || '—'}</strong>
              </div>
              {info ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Částka</span>
                    <strong>{amount} {info.currency || manifest.catalog.currency}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Variabilní symbol</span>
                    <strong style={{ fontFamily: 'monospace' }}>{vs || '—'}</strong>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: '0.875rem', color: 'var(--s-muted)', margin: 0, lineHeight: 1.5 }}>
                  Částku a variabilní symbol najdete v potvrzovacím e-mailu objednávky.
                </p>
              )}
            </div>
            {qrSrc && (
              <div style={{ textAlign: 'center' }}>
                <img src={qrSrc} alt="QR platba" width={180} height={180} style={{ borderRadius: 8 }} />
                <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', marginTop: '0.5rem' }}>Naskenujte v mobilním bankovnictví</p>
              </div>
            )}
            <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', marginTop: '1rem', lineHeight: 1.5 }}>
              Zboží expedujeme po připsání platby. Potvrzení objednávky vám přišlo e-mailem.
            </p>
          </div>
        ) : isDobirka ? (
          <div style={{ marginTop: '2rem', padding: '1.25rem 1.5rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Platba na dobírku</p>
            <p style={{ color: 'var(--s-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Platbu uhradíte při převzetí zásilky. Potvrzení objednávky vám přišlo e-mailem.
            </p>
          </div>
        ) : (
          <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75, marginTop: '1rem', marginBottom: '2.5rem' }}>
            Platba proběhla úspěšně. Potvrzení objednávky vám přišlo e-mailem.
          </p>
        )}

        <a href="/" style={{ display: 'inline-block', marginTop: '2.5rem', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '1rem' }}>
          Pokračovat v nákupu
        </a>
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}
`)

  // ── app/api/order-status/route.ts ──────────────────────────────────────────
  // Hosted mode only: asks the platform for the verified payment instructions of
  // one order (the platform checks the unguessable per-order token `t` that it put
  // in the /success redirect). Returns only the fields the success page renders.
  add('app/api/order-status/route.ts', `import { NextResponse } from 'next/server'
import { platformUrl } from '@/lib/platform'

${STORE_KEY_HEADERS_FN}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const order = searchParams.get('order') ?? ''
  const orderId = searchParams.get('orderId') ?? ''
  const token = searchParams.get('t') ?? ''
  const projectId = process.env.QUANTE_PROJECT_ID
  const base = platformUrl()
  if (!projectId || !base) return notFound()
  if (!/^[A-Za-z0-9-]{1,40}$/.test(order) || !/^[A-Za-z0-9_-]{16,200}$/.test(token)) return notFound()
  try {
    // The platform checks the token (and this store's key) before answering.
    const qs = new URLSearchParams({ projectId, order, t: token })
    if (/^[0-9a-fA-F-]{36}$/.test(orderId)) qs.set('orderId', orderId)
    const res = await fetch(base + '/api/store/order-status?' + qs.toString(), { headers: storeKeyHeaders(), cache: 'no-store' })
    if (!res.ok) return notFound()
    const d = await res.json() as Record<string, unknown>
    const amount = Number(d.amount)
    if (!Number.isFinite(amount) || amount <= 0) return notFound()
    return NextResponse.json({
      orderNumber: typeof d.orderNumber === 'string' ? d.orderNumber.slice(0, 40) : order,
      method: typeof d.method === 'string' ? d.method.slice(0, 20) : '',
      amount,
      currency: typeof d.currency === 'string' ? d.currency.toUpperCase().slice(0, 3) : '',
      vs: String(d.vs ?? '').replace(/\\D/g, '').slice(0, 10),
      account: typeof d.account === 'string' ? d.account.slice(0, 64) : '',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return notFound()
  }
}
`)

  // ── data/manifest.ts — baked manifest ─────────────────────────────────────
  add('data/manifest.ts', [
    `import type { ShopManifest } from '@/types/manifest'`,
    ``,
    `export const manifest: ShopManifest = ${JSON.stringify(manifest, null, 2)}`,
    ``,
  ].join('\n'))

  // ── .env.example ──────────────────────────────────────────────────────────
  const hasZasilkovna = manifest.shipping?.methods?.some((m) => m.type === 'zasilkovna') ?? false
  const hasComgate = manifest.payments?.providers?.includes('comgate') ?? false
  const hasGopay = manifest.payments?.providers?.includes('gopay') ?? false
  const hasPayPal = manifest.payments?.providers?.includes('paypal') ?? false
  const envLines = [
    '# ════════════════════════════════════════════════════════════════════════════',
    '# HOSTED MODE (deployed via Quante)',
    '# ════════════════════════════════════════════════════════════════════════════',
    '# These three vars are injected automatically when Quante hosts the store —',
    '# leave them commented out for a self-hosted store. Payments then go through',
    '# Quante; earnings appear in your Quante payout dashboard.',
    '#',
    '# QUANTE_API_URL=https://quantecode.com',
    '# QUANTE_PROJECT_ID=',
    '# QUANTE_API_KEY=',
    '',
    '# ════════════════════════════════════════════════════════════════════════════',
    '# SELF-HOSTED MODE (your own server / Vercel account)',
    '# ════════════════════════════════════════════════════════════════════════════',
    '# Keep QUANTE_PROJECT_ID above unset and set your own payment credentials below.',
    '# The checkout route auto-detects which mode to use.',
    '',
    '# ── Stripe (card, Apple Pay, Google Pay) ─────────────────────────────────',
    '# 1. Get keys at https://dashboard.stripe.com/apikeys',
    '# 2. Run: npm install stripe',
    '# STRIPE_SECRET_KEY=sk_live_...',
    '',
    ...(hasComgate ? [
      '# ── Comgate (CZ card, Apple Pay, bank buttons) ───────────────────────────',
      '# Get credentials at https://portal.comgate.cz',
      '# COMGATE_MERCHANT_ID=your-merchant-id',
      '# COMGATE_SECRET=your-secret',
      '# COMGATE_TEST_MODE=false',
      '',
    ] : []),
    ...(hasGopay ? [
      '# ── GoPay (CZ/SK card, Google Pay, bank transfer) ────────────────────────',
      '# Get credentials at https://help.gopay.com/cs/gopay-business-payments',
      '# GOPAY_CLIENT_ID=your-client-id',
      '# GOPAY_CLIENT_SECRET=your-client-secret',
      '# GOPAY_GO_ID=your-go-id',
      '',
    ] : []),
    ...(hasPayPal ? [
      '# ── PayPal ───────────────────────────────────────────────────────────────',
      '# Get credentials at https://developer.paypal.com/dashboard/applications',
      '# PAYPAL_CLIENT_ID=your-client-id',
      '# PAYPAL_CLIENT_SECRET=your-client-secret',
      '# PAYPAL_TEST_MODE=false',
      '',
    ] : []),
    ...(hasZasilkovna ? [
      '# ── Zásilkovna / Packeta widget ──────────────────────────────────────────',
      '# Get your API key at https://client.packeta.com/cs/tools/web-widget',
      'NEXT_PUBLIC_ZASILKOVNA_API_KEY=your-zasilkovna-api-key',
      '',
    ] : []),
    '# Optional: Supabase for a dynamic product catalog',
    '# NEXT_PUBLIC_SUPABASE_URL=',
    '# NEXT_PUBLIC_SUPABASE_ANON_KEY=',
    '',
  ]
  if (hasAdmin) {
    envLines.push('# ── Admin panel ──────────────────────────────────────────────────────────')
    envLines.push('# Required for /admin. At least 12 characters; changing it signs everyone out.')
    envLines.push('ADMIN_PASSWORD=')
    envLines.push('# Optional extra secret mixed into the admin session signature.')
    envLines.push('# ADMIN_SESSION_SECRET=')
    envLines.push('# Optional: public origin(s) of the store when a reverse proxy rewrites the')
    envLines.push('# Host header and does not send X-Forwarded-Host (comma-separated).')
    envLines.push('# ADMIN_ALLOWED_ORIGINS=https://shop.example.com')
    envLines.push('')
  }
  add('.env.example', envLines.join('\n'))

  // ── .gitignore ────────────────────────────────────────────────────────────
  add('.gitignore', [
    'node_modules', '.next', 'out', '.env*.local', '.DS_Store', '*.log', '',
  ].join('\n'))

  // ── Admin panel (optional add-on) ─────────────────────────────────────────
  if (hasAdmin) {
    addAdminFiles(files, manifest)
  }

  // ── README.md ─────────────────────────────────────────────────────────────
  add('README.md', buildReadme(manifest, hasAdmin, slug, customComponents.length))

  return files
}

// ─── Admin panel files ────────────────────────────────────────────────────────

function addAdminFiles(files: GeneratedFile[], manifest: ShopManifest) {
  function add(name: string, content: string) {
    files.push({ path: name, content, encoding: 'utf-8' })
  }

  // Brand name as a JSX string expression — never spliced raw into TSX source.
  const brandNameJsx = `{${JSON.stringify(manifest.brand.name)}}`

  // Security (2026-09): the admin panel used to trust a static `admin_auth=true`
  // cookie that anyone could set by hand, exposing every customer's PII and the
  // ship/Packeta actions. Sessions are now HMAC-signed, short-lived, httpOnly,
  // SameSite=Strict tokens bound to ADMIN_PASSWORD, verified on every admin page
  // and API route; login is rate-limited and compared in constant time.
  add('lib/admin-session.ts', `\
import crypto from 'crypto'
import { cookies } from 'next/headers'

export const ADMIN_COOKIE = 'admin_session'
export const ADMIN_SESSION_MAX_AGE = 12 * 60 * 60 // seconds
export const ADMIN_PASSWORD_MIN_LENGTH = 12

// Signing key bound to ADMIN_PASSWORD (plus the optional ADMIN_SESSION_SECRET), so
// changing the password immediately invalidates every existing session.
function signingKey(): Buffer | null {
  const password = process.env.ADMIN_PASSWORD
  if (!password || password.length < ADMIN_PASSWORD_MIN_LENGTH) return null
  return crypto.createHash('sha256')
    .update('admin-session:' + (process.env.ADMIN_SESSION_SECRET ?? '') + ':' + password)
    .digest()
}

export function adminConfigured(): boolean {
  return signingKey() !== null
}

export function createAdminSession(): string | null {
  const key = signingKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iat: now, exp: now + ADMIN_SESSION_MAX_AGE, n: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url')
  return payload + '.' + sig
}

export function verifyAdminSession(token: string | undefined | null): boolean {
  const key = signingKey()
  if (!key || !token) return false
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  const expected = crypto.createHmac('sha256', key).update(parts[0]).digest()
  const given = Buffer.from(parts[1], 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { iat?: unknown; exp?: unknown }
    const now = Math.floor(Date.now() / 1000)
    return typeof data.iat === 'number' && typeof data.exp === 'number'
      && data.exp > now && data.iat <= now + 60 && data.exp - data.iat <= ADMIN_SESSION_MAX_AGE
  } catch {
    return false
  }
}

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies()
  return verifyAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)
}

// Constant-time password check (hashing first equalises the lengths).
export function checkAdminPassword(input: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected || expected.length < ADMIN_PASSWORD_MIN_LENGTH || typeof input !== 'string') return false
  const a = crypto.createHash('sha256').update(input).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Rejects cross-site state-changing requests (on top of SameSite=Strict).
// The Origin host must match the Host header or, behind a reverse proxy that
// rewrites Host (e.g. nginx proxy_pass to localhost:3000), X-Forwarded-Host.
// A cross-site page cannot set X-Forwarded-Host on a browser request, so
// accepting it does not weaken the CSRF check. Extra public origins can be
// listed in ADMIN_ALLOWED_ORIGINS (comma-separated, e.g. https://shop.example.com).
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site'
  let originUrl: URL
  try { originUrl = new URL(origin) } catch { return false }
  const hosts = [
    request.headers.get('host'),
    (request.headers.get('x-forwarded-host') ?? '').split(',')[0].trim(),
  ].filter((h): h is string => !!h).map((h) => h.toLowerCase())
  if (hosts.includes(originUrl.host.toLowerCase())) return true
  const extra = (process.env.ADMIN_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  return extra.some((o) => { try { return new URL(o).origin === originUrl.origin } catch { return false } })
}

// Best-effort client IP for the login throttle. On Vercel the platform sets
// x-real-ip / x-forwarded-for itself. Self-hosted without a proxy these headers
// are client-controlled, so a global failure cap (below) backs up the per-IP one.
export function clientIp(request: Request): string {
  return request.headers.get('x-real-ip')?.trim()
    || (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || 'unknown'
}

// Login throttle (per server instance): 5 failed attempts per IP per 15 minutes,
// plus 50 failed attempts in total per 15 minutes so spoofed IP headers cannot
// buy unlimited guesses.
const MAX_ATTEMPTS = 5
const MAX_GLOBAL_ATTEMPTS = 50
const WINDOW_MS = 15 * 60 * 1000
const GLOBAL_KEY = '*'
const failures = new Map<string, { count: number; resetAt: number }>()

function over(key: string, limit: number): boolean {
  const entry = failures.get(key)
  if (!entry) return false
  if (entry.resetAt <= Date.now()) { failures.delete(key); return false }
  return entry.count >= limit
}

export function loginBlocked(ip: string): boolean {
  return over(GLOBAL_KEY, MAX_GLOBAL_ATTEMPTS) || over('ip:' + ip, MAX_ATTEMPTS)
}

function bump(key: string, now: number): void {
  const entry = failures.get(key)
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS })
  else entry.count += 1
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now()
  bump('ip:' + ip, now)
  bump(GLOBAL_KEY, now)
  if (failures.size > 10000) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
  }
}

export function clearLoginFailures(ip: string): void {
  failures.delete('ip:' + ip)
}
`)

  // Protected layout — wraps /admin/dashboard, /admin/products, /admin/orders
  // Route group (protected) keeps URLs clean (/admin/dashboard etc.) while
  // separating the auth-gated layout from the public login page.
  add('app/admin/(protected)/layout.tsx', `\
import { redirect } from 'next/navigation'
import React from 'react'
import { isAdmin } from '@/lib/admin-session'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/admin')

  return (
    <div style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh' }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <aside style={{ width: 220, flexShrink: 0, background: '#0f0f1a', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', padding: '1.5rem 0' }}>
          <div style={{ padding: '0 1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#f4f4f6' }}>Admin</span>
            <p style={{ fontSize: 11, color: '#6b6b78', marginTop: 2 }}>${brandNameJsx}</p>
          </div>
          <nav style={{ padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { label: 'Dashboard', href: '/admin/dashboard' },
              { label: 'Products', href: '/admin/products' },
              { label: 'Orders', href: '/admin/orders' },
            ].map(({ label, href }) => (
              <a key={href} href={href} style={{ display: 'block', padding: '0.625rem 1.25rem', fontSize: 13, color: '#a0a0b0', textDecoration: 'none' }}>
                {label}
              </a>
            ))}
          </nav>
          <div style={{ marginTop: 'auto', padding: '1rem 1.25rem' }}>
            <form action="/api/admin/signout" method="POST">
              <button type="submit" style={{ width: '100%', padding: '0.5rem', fontSize: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#6b6b78', cursor: 'pointer' }}>
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main style={{ flex: 1, padding: '2rem', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}
`)

  // Login page — not inside (protected), so not wrapped by auth layout
  add('app/admin/page.tsx', `\
'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/admin/dashboard')
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Invalid password.')
    }
    setLoading(false)
  }

  return (
    <div style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 360, padding: '0 1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Admin</h1>
          <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>${brandNameJsx} — store management</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus placeholder="Password" style={{ width: '100%', padding: '0.75rem 0.875rem', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f4f4f6', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ padding: '0.75rem', background: '#6f78e6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
`)

  add('app/admin/(protected)/dashboard/page.tsx', `\
import { manifest } from '@/data/manifest'
export default function DashboardPage() {
  const cards = [
    { label: 'Total products', value: manifest.catalog.products.length, href: '/admin/products' },
    { label: 'Available', value: manifest.catalog.products.filter((p) => p.available).length, href: '/admin/products' },
    { label: 'Collections', value: manifest.catalog.collections?.length ?? 0, href: '/admin/products' },
    { label: 'Orders', value: '→', href: '/admin/orders' },
  ]
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 1.5rem' }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
        {cards.map(({ label, value, href }) => (
          <a key={label} href={href} style={{ display: 'block', textDecoration: 'none', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
            <p style={{ fontSize: 11, color: '#6b6b78', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>{label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: '#f4f4f6', margin: 0 }}>{value}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
`)

  add('app/admin/(protected)/products/page.tsx', `\
import { manifest } from '@/data/manifest'
export default function ProductsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1.5rem' }}>Products</h1>
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Name', 'Price', 'Status'].map((h) => (
                <th key={h} style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontSize: 11, color: '#6b6b78', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {manifest.catalog.products.map((product) => (
              <tr key={product.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '1rem 1.25rem', fontSize: 14 }}>{product.name}</td>
                <td style={{ padding: '1rem 1.25rem', fontSize: 14 }}>{manifest.catalog.currency} {product.price.toFixed(2)}</td>
                <td style={{ padding: '1rem 1.25rem' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, background: product.available ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)', color: product.available ? '#34d399' : '#f87171' }}>
                    {product.available ? 'Available' : 'Unavailable'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
`)

  add('app/admin/(protected)/orders/page.tsx', `\
'use client'
import { useEffect, useState } from 'react'

interface Order {
  id: string
  orderNumber: string
  customerEmail: string
  customerName: string
  amount: number
  currency: string
  status: string
  paymentStatus: string
  paymentMethod: string
  invoiceUrl: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  paid:      { bg: 'rgba(52,211,153,0.12)', color: '#34d399', label: 'Zaplaceno' },
  pending:   { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', label: 'Čeká' },
  shipped:   { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa', label: 'Odesláno' },
  cancelled: { bg: 'rgba(248,113,113,0.12)', color: '#f87171', label: 'Zrušeno' },
  refunded:  { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa', label: 'Vráceno' },
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Karta', comgate: 'Online', gopay: 'GoPay',
  dobirka: 'Dobírka', prevod: 'Převod',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [revenue, setRevenue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shipping, setShipping] = useState<Record<string, { tracking: string; url: string }>>({})
  const [sending, setSending] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/orders')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setOrders(d.orders ?? [])
        setRevenue(d.revenue ?? 0)
      })
      .catch(() => setError('Failed to load orders.'))
      .finally(() => setLoading(false))
  }, [])

  async function markShipped(orderId: string) {
    const s = shipping[orderId] ?? {}
    setSending(orderId)
    const res = await fetch(\`/api/admin/orders/\${encodeURIComponent(orderId)}/ship\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingCode: s.tracking, trackingUrl: s.url }),
    }).catch(() => null)
    if (res?.ok) setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: 'shipped' } : o))
    setSending(null)
  }

  if (loading) return <div><h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1.5rem' }}>Objednávky</h1><p style={{ fontSize: 13, color: '#8a8a93' }}>Načítám…</p></div>
  if (error) return <div><h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1rem' }}>Objednávky</h1><p style={{ fontSize: 13, color: '#f87171' }}>{error}</p></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Objednávky</h1>
        {orders.length > 0 && (
          <p style={{ fontSize: 13, color: '#6b6b78' }}>
            {orders.length} obj. · {orders[0]?.currency ?? ''} {revenue.toFixed(2)} přijato
          </p>
        )}
      </div>
      {orders.length === 0 ? (
        <p style={{ fontSize: 13, color: '#8a8a93' }}>Zatím žádné objednávky.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {orders.map((order) => {
            const s = STATUS_COLORS[order.status] ?? STATUS_COLORS.pending
            const isPaid = order.paymentStatus === 'paid' && order.status !== 'shipped' && order.status !== 'refunded' && order.status !== 'cancelled'
            const sh = shipping[order.id] ?? { tracking: '', url: '' }
            return (
              <div key={order.id} style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#a0a0b0' }}>{order.orderNumber}</span>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, background: s.bg, color: s.color }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: '#6b6b78' }}>{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{order.customerName}</p>
                    <p style={{ margin: 0, fontSize: 12, color: '#6b6b78' }}>{order.customerEmail} · {new Date(order.createdAt).toLocaleDateString('cs-CZ')}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{order.currency} {order.amount.toFixed(2)}</span>
                    {order.invoiceUrl && (
                      <a href={order.invoiceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#6f78e6', textDecoration: 'none' }}>Faktura ↗</a>
                    )}
                  </div>
                </div>
                {isPaid && (
                  <div style={{ marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      placeholder="Tracking číslo"
                      value={sh.tracking}
                      onChange={(e) => setShipping((prev) => ({ ...prev, [order.id]: { ...sh, tracking: e.target.value } }))}
                      style={{ padding: '0.4rem 0.75rem', fontSize: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f4f6', width: 160 }}
                    />
                    <input
                      placeholder="Tracking URL (volitelné)"
                      value={sh.url}
                      onChange={(e) => setShipping((prev) => ({ ...prev, [order.id]: { ...sh, url: e.target.value } }))}
                      style={{ padding: '0.4rem 0.75rem', fontSize: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f4f6', flex: 1, minWidth: 160 }}
                    />
                    <button
                      onClick={() => markShipped(order.id)}
                      disabled={sending === order.id}
                      style={{ padding: '0.4rem 1rem', background: '#60a5fa', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', opacity: sending === order.id ? 0.6 : 1 }}
                    >
                      {sending === order.id ? 'Odesílám…' : 'Označit jako odesláno'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
`)

  add('app/api/admin/auth/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  ADMIN_COOKIE, ADMIN_SESSION_MAX_AGE, ADMIN_PASSWORD_MIN_LENGTH, adminConfigured, createAdminSession,
  checkAdminPassword, isSameOrigin, clientIp, loginBlocked, recordLoginFailure, clearLoginFailures,
} from '@/lib/admin-session'

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Set ADMIN_PASSWORD (at least ' + ADMIN_PASSWORD_MIN_LENGTH + ' characters) to enable the admin panel.' }, { status: 503 })
  }
  const ip = clientIp(request)
  if (loginBlocked(ip)) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })

  const body = await request.json().catch(() => ({})) as { password?: unknown }
  if (!checkAdminPassword(body.password)) {
    recordLoginFailure(ip)
    await new Promise((resolve) => setTimeout(resolve, 750))
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
  }
  clearLoginFailures(ip)

  const token = createAdminSession()
  if (!token) return NextResponse.json({ error: 'Admin panel is not configured.' }, { status: 503 })
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: ADMIN_SESSION_MAX_AGE, path: '/',
  })
  cookieStore.delete('admin_auth') // pre-2026-09 unsigned cookie
  return NextResponse.json({ ok: true })
}
`)

  add('app/api/admin/signout/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_COOKIE, isSameOrigin } from '@/lib/admin-session'

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_COOKIE)
  cookieStore.delete('admin_auth')
  // 303 so the browser follows with a GET (a 307 would re-POST to /admin).
  return NextResponse.redirect(new URL('/admin', request.url), 303)
}
`)

  add('app/api/admin/orders/route.ts', `\
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-session'
import { platformUrl } from '@/lib/platform'

${STORE_KEY_HEADERS_FN}

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fail closed: the API key is only ever sent to an explicitly configured host.
  const quanteUrl = platformUrl()
  if (!quanteUrl) return NextResponse.json({ error: 'QUANTE_API_URL not configured' }, { status: 400 })
  if (!process.env.QUANTE_API_KEY) return NextResponse.json({ error: 'QUANTE_API_KEY not configured' }, { status: 400 })

  try {
    const res = await fetch(quanteUrl + '/api/store/orders', { headers: storeKeyHeaders(), cache: 'no-store' })
    const data = await res.json().catch(() => ({ error: 'Invalid response' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to load orders.' }, { status: 502 })
  }
}
`)

  add('app/api/admin/orders/[orderId]/ship/route.ts', `\
import { NextResponse } from 'next/server'
import { isAdmin, isSameOrigin } from '@/lib/admin-session'
import { platformUrl } from '@/lib/platform'

${STORE_KEY_HEADERS_FN}

interface Context { params: Promise<{ orderId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  // orderId is spliced into the upstream URL — no slashes/dots (path traversal).
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId)) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })

  const quanteUrl = platformUrl()
  if (!quanteUrl) return NextResponse.json({ error: 'QUANTE_API_URL not configured' }, { status: 400 })
  if (!process.env.QUANTE_API_KEY) return NextResponse.json({ error: 'QUANTE_API_KEY not configured' }, { status: 400 })

  const raw = await request.json().catch(() => ({})) as Record<string, unknown>
  const trackingCode = typeof raw.trackingCode === 'string' && raw.trackingCode.trim() ? raw.trackingCode.trim().slice(0, 100) : undefined
  // Only https tracking links are forwarded (they end up in customer e-mails).
  let trackingUrl: string | undefined
  if (typeof raw.trackingUrl === 'string' && raw.trackingUrl.trim()) {
    try {
      const u = new URL(raw.trackingUrl.trim())
      if (u.protocol === 'https:') trackingUrl = u.toString().slice(0, 500)
    } catch {}
  }
  const weight = Number(raw.weight)
  const validWeight = Number.isFinite(weight) && weight > 0 && weight <= 100 ? weight : undefined
  const headers = storeKeyHeaders({ 'Content-Type': 'application/json' })

  // For Zásilkovna orders without a manual tracking code, try the Packeta API
  if (raw.useZasilkovna === true && !trackingCode) {
    const zRes = await fetch(quanteUrl + '/api/store/orders/' + orderId + '/zasilkovna-shipment', {
      method: 'POST',
      headers,
      body: JSON.stringify({ weight: validWeight }),
    })
    const zData = await zRes.json().catch(() => ({}))
    if (zRes.ok) return NextResponse.json(zData, { status: 200 })
    // Fall through to manual PATCH if Packeta API not configured
  }

  const res = await fetch(quanteUrl + '/api/store/orders/' + orderId, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'shipped', trackingCode, trackingUrl }),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
`)
}

// ─── README ──────────────────────────────────────────────────────────────────

function buildReadme(manifest: ShopManifest, hasAdmin: boolean, slug: string, customSectionCount = 0): string {
  const lines: string[] = [
    `# ${manifest.brand.name}`, '',
    `> ${manifest.brand.tagline}`, '',
    `Generated with **Quante** — AI-native e-commerce builder.`,
    `Tech stack: **Next.js 16 + TypeScript + Tailwind CSS**.`, '',
    '---', '',
    '## Quick start', '',
    '```bash', 'npm install', 'npm run dev', '```', '',
    'Open **http://localhost:3000** in your browser.', '',
    '---', '',
    '## Environment setup', '',
    '```bash', 'cp .env.example .env.local', '```', '',
    '| Variable | Required | Description |',
    '|---|---|---|',
    `| \`QUANTE_API_URL\` | For checkout | Quante platform URL |`,
    `| \`QUANTE_PROJECT_ID\` | For checkout | Your project ID on Quante |`,
    `| \`QUANTE_API_KEY\` | For admin | API key for order access |`,
    ...(hasAdmin ? [
      `| \`ADMIN_PASSWORD\` | **Required for admin** | Password for /admin (min. 12 characters) |`,
      `| \`ADMIN_SESSION_SECRET\` | Optional | Extra secret mixed into admin session signatures |`,
      `| \`ADMIN_ALLOWED_ORIGINS\` | Optional | Public store origin(s) for /admin when a reverse proxy rewrites the Host header |`,
    ] : []),
    '', '> Never commit `.env.local`. It is in `.gitignore`.', '', '---', '',
    '## Customizing', '',
    '`data/manifest.ts` is the single source for all content — products, copy, colors, fonts, sections, nav, footer, SEO.',
    'Edit it and refresh. Type definitions are in `types/manifest.ts`.', '', '---',
  ]

  if (customSectionCount > 0) {
    lines.push(
      '', '## Custom sections', '',
      'Custom sections are rendered in a sandboxed iframe (`components/custom/SandboxedComponent.tsx`,',
      'source in `components/custom/sources.ts`). Their code never runs inside your app itself —',
      'not during the build and not on your domain — and it has no network access. To turn one',
      'into a regular component, review its code first and rewrite it as a normal React section.', '', '---',
    )
  }

  if (hasAdmin) {
    lines.push(
      '', '## Admin panel', '',
      'Your store ships with a professional admin panel at `/admin`.', '',
      '1. Set `ADMIN_PASSWORD` in `.env.local` to a strong password (at least 12 characters)',
      '2. Restart the dev server', '3. Open **http://localhost:3000/admin**',
      '4. Enter your password', '',
      'Features: dashboard, product management, orders view.',
      'Sessions are signed, httpOnly cookies that expire after 12 hours. Changing `ADMIN_PASSWORD`',
      'signs everyone out. Login attempts are rate-limited per IP.', '', '---',
    )
  }

  lines.push(
    '', '## Deploy to Vercel', '',
    '```bash', 'npx vercel', '```', '',
    'Or push to GitHub and import at https://vercel.com/new', '', '---',
    '', '## Project structure', '',
    '```', `${slug}/`,
    '├── app/',
    '│   ├── page.tsx', '│   ├── products/[slug]/', '│   ├── collections/[slug]/',
    '│   ├── about/', '│   ├── contact/',
    ...(hasAdmin ? ['│   └── admin/'] : []),
    '├── components/storefront/', '├── data/manifest.ts',
    '├── types/manifest.ts', '└── README.md', '```', '',
    `*${manifest.brand.name} — built with Quante.*`, '',
  )

  return lines.join('\n')
}
