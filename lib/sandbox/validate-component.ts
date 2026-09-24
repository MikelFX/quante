// Validates AI-generated / marketplace custom React components before injection.
// Enforces: allowlisted imports only, no network calls, no dangerous APIs.
//
// SECURITY MODEL:
//  - Platform preview: the boundary is the renderer. /api/preview/component is only
//    ever executed inside an iframe with sandbox="allow-scripts" (no allow-same-origin)
//    and served with `Content-Security-Policy: sandbox allow-scripts; connect-src 'none'`,
//    so the code runs in an opaque origin with no cookies, no same-origin APIs, no fetch.
//  - Exported / hosted stores: the code is written out as a native component
//    (components/custom/<ref>.tsx) and runs UNSANDBOXED on the store origin. There this
//    validator is the only automated barrier, which is why it fails closed on anything
//    it cannot fully understand. It is still a blocklist over a Turing-complete language
//    (a runtime-computed property key can always reach something), so marketplace
//    listings must additionally go through human review before they are sold.
//
// Two independent passes must both pass:
//  1. AST pass — the TypeScript compiler's TSX parser (already a project dependency;
//     Next.js loads it as an external server package). Any parse diagnostic rejects the
//     component, so input that a parser could read two ways (e.g. `<T,>(x) => ...`
//     generic arrows vs. JSX) never gets through. The tree is walked for forbidden
//     identifiers, global-object access, dynamic computed keys, forbidden JSX tags and
//     string values folded from literal expressions ('con' + 'structor',
//     ['fe','tch'].join(''), 'a'.concat('b')).
//  2. Lexer pass — a hand-written lexer builds a "code view" of the source in which
//     comments, string/template contents, regex bodies and JSX text are blanked out
//     (positions preserved), and regex rules run over it. JSX is lexed strictly (tag
//     grammar, matching closing tags, no `>`/`}` in text); anything the lexer cannot
//     follow falls back to scanning the raw source (stricter, never looser).

import 'server-only'
import ts from 'typescript'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// Imports that are always allowed in generated components
const ALLOWED_IMPORT_SOURCES = new Set([
  'react',
  'react/jsx-runtime',
  'framer-motion',
])

// Checks the component is not excessively large (runaway generation guard)
const MAX_BYTES = 32_000

// ─── Lexer ────────────────────────────────────────────────────────────────────

interface StringToken {
  start: number
  end: number
  value: string
}

interface Lexed {
  /** Source with comments / string contents / regex bodies / JSX text blanked. Same length as the input. */
  code: string
  strings: StringToken[]
  /** Tag names of every JSX element the lexer saw ('' for fragments). */
  jsxTags: string[]
  ok: boolean
}

// Elements that load / execute external resources or change document-level behaviour.
// React 19 actually loads <script async src> / <link rel=stylesheet> rendered anywhere.
const FORBIDDEN_JSX_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta',
  'link', 'portal', 'fencedframe',
])

const JSX_TAG_NAME_RE = /^[A-Za-z_$][\w$.:-]*/
const JSX_ATTR_NAME_RE = /^[A-Za-z_$][\w$-]*(?::[A-Za-z_$][\w$-]*)?/

// Tokens after which `/` starts a regex and `<` starts a JSX element.
const EXPR_START_PUNCT = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const EXPR_START_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'yield', 'await', 'instanceof',
])

function lex(src: string): Lexed {
  const n = src.length
  const out = src.split('')
  const strings: StringToken[] = []
  const jsxTags: string[] = []
  let i = 0
  let prev = '' // last significant token; '' = start of input

  const fail = (msg: string): never => {
    throw new Error(msg)
  }
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  const isIdStart = (c: string | undefined) => !!c && /[A-Za-z_$]/.test(c)
  const isIdChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c)
  const exprStart = () => prev === '' || EXPR_START_PUNCT.has(prev) || EXPR_START_KEYWORDS.has(prev)

  // i at a backslash inside a string/template; returns the decoded text and advances i.
  function readEscape(): string {
    const nx = src[i + 1]
    if (nx === undefined) fail('dangling escape')
    if (nx === 'x') {
      const code = parseInt(src.slice(i + 2, i + 4), 16)
      i += 4
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    }
    if (nx === 'u') {
      if (src[i + 2] === '{') {
        const close = src.indexOf('}', i + 3)
        if (close === -1) fail('bad unicode escape')
        const cp = parseInt(src.slice(i + 3, close), 16)
        i = close + 1
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
      }
      const code = parseInt(src.slice(i + 2, i + 6), 16)
      i += 6
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    }
    i += 2
    if (nx === '\n' || nx === '\r') return ''
    return nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === 'r' ? '\r' : nx
  }

  function readQuoted(q: string, jsxAttr: boolean): void {
    const start = i
    i++
    let value = ''
    while (i < n && src[i] !== q) {
      if (!jsxAttr && src[i] === '\\') {
        value += readEscape()
        continue
      }
      if (!jsxAttr && src[i] === '\n') fail('unterminated string')
      value += src[i]
      i++
    }
    if (i >= n) fail('unterminated string')
    i++
    blank(start + 1, i - 1)
    strings.push({ start, end: i, value })
  }

  function readTemplate(): void {
    const start = i
    i++
    let value = ''
    let segStart = i
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') {
        value += readEscape()
        continue
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(segStart, i)
        i += 2
        prev = '{'
        scanCode(true)
        segStart = i
        continue
      }
      value += src[i]
      i++
    }
    if (i >= n) fail('unterminated template')
    blank(segStart, i)
    i++
    strings.push({ start, end: i, value })
  }

  function readRegex(): void {
    const start = i
    i++
    let inClass = false
    while (i < n) {
      const c = src[i]
      if (c === '\n') fail('unterminated regex')
      if (c === '\\') { i += 2; continue }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) break
      i++
    }
    if (i >= n) fail('unterminated regex')
    blank(start + 1, i)
    i++
    while (i < n && isIdChar(src[i])) i++
  }

  const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
  const skipWs = () => { while (i < n && isWs(src[i])) i++ }

  // Strict JSX: anything that is not well-formed JSX (e.g. a TSX generic arrow
  // `<T,>(x: T) => ...` or `<T extends U>(...)`, or a type-position `<T>(x: T) => R`)
  // makes the lexer fail, so the whole source is then checked as raw code instead of
  // being blanked out as JSX text.
  function readJsxElement(): void {
    i++ // '<'
    let name = ''
    if (src[i] !== '>') {
      const m = JSX_TAG_NAME_RE.exec(src.slice(i, i + 200))
      if (!m) fail('bad JSX tag name')
      name = m![0]
      i += name.length
      const after = src[i]
      if (!(after === '>' || after === '/' || after === '{' || isWs(after))) fail('not a JSX tag')
    }
    jsxTags.push(name)
    // attributes
    for (;;) {
      skipWs()
      if (i >= n) fail('unterminated JSX tag')
      const c = src[i]
      if (c === '/') {
        if (src[i + 1] !== '>' || name === '') fail('bad JSX tag end')
        i += 2
        return
      }
      if (c === '>') { i++; break }
      if (name === '') fail('attributes on a JSX fragment')
      if (c === '{') {
        // Spread attribute {...props}
        i++
        skipWs()
        if (src.slice(i, i + 3) !== '...') fail('bad JSX spread attribute')
        prev = '{'
        scanCode(true)
        continue
      }
      const a = JSX_ATTR_NAME_RE.exec(src.slice(i, i + 200))
      if (!a) fail('bad JSX attribute')
      // `<T extends U>` is a TSX type parameter list, not an element.
      if (a![0] === 'extends') fail('TSX type parameters')
      i += a![0].length
      let j = i
      while (j < n && isWs(src[j])) j++
      if (src[j] === '=') {
        i = j + 1
        skipWs()
        const v = src[i]
        if (v === '"' || v === "'") { readQuoted(v, true); continue }
        if (v === '{') { i++; prev = '{'; scanCode(true); continue }
        fail('bad JSX attribute value')
      }
      const nx = src[i]
      if (!(nx === '>' || nx === '/' || nx === '{' || isWs(nx))) fail('bad JSX attribute')
    }
    // children
    for (;;) {
      if (i >= n) fail('unterminated JSX element')
      const c = src[i]
      if (c === '{') { i++; prev = '{'; scanCode(true); continue }
      // Unescaped > and } are syntax errors in real JSX text (Babel, TS and SWC agree);
      // seeing one means this was never JSX (e.g. an arrow `=>` in a generic).
      if (c === '>' || c === '}') fail('invalid character in JSX text')
      if (c === '<') {
        if (src[i + 1] === '/') {
          i += 2
          skipWs()
          const m = /^[\w$.:-]*/.exec(src.slice(i, i + 200))
          const closing = m ? m[0] : ''
          i += closing.length
          skipWs()
          if (src[i] !== '>' || closing !== name) fail('mismatched JSX closing tag')
          i++
          return
        }
        readJsxElement()
        continue
      }
      if (c !== '\n' && c !== '\r') out[i] = ' ' // JSX text
      i++
    }
  }

  // Scans code; when `nested`, returns after consuming the `}` that closes the
  // enclosing `${` / JSX `{`.
  function scanCode(nested: boolean): void {
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
      if (c === '/' && src[i + 1] === '/') {
        const e = src.indexOf('\n', i)
        const end = e === -1 ? n : e
        blank(i, end)
        i = end
        continue
      }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2)
        if (e === -1) fail('unterminated comment')
        blank(i, e + 2)
        i = e + 2
        continue
      }
      if (c === '"' || c === "'") { readQuoted(c, false); prev = 'str'; continue }
      if (c === '`') { readTemplate(); prev = 'str'; continue }
      if (c === '/' && exprStart()) { readRegex(); prev = 'regex'; continue }
      if (c === '<' && exprStart() && (isIdStart(src[i + 1]) || src[i + 1] === '>')) {
        readJsxElement()
        prev = ')'
        continue
      }
      if (isIdStart(c) || c === '\\') {
        const s = i
        i++
        while (i < n && (isIdChar(src[i]) || src[i] === '\\')) i++
        prev = src.slice(s, i)
        continue
      }
      if (/[0-9]/.test(c)) {
        while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++
        prev = '0'
        continue
      }
      if (c === '{') { depth++; i++; prev = '{'; continue }
      if (c === '}') {
        if (depth === 0) {
          if (!nested) fail('unbalanced }')
          i++
          prev = ')'
          return
        }
        depth--
        i++
        prev = '}'
        continue
      }
      prev = c
      i++
    }
    if (nested) fail('unterminated expression')
  }

  try {
    scanCode(false)
    return { code: out.join(''), strings, jsxTags, ok: true }
  } catch {
    // Could not follow the source: scan the raw text instead (stricter, never looser).
    return { code: src, strings, jsxTags, ok: false }
  }
}

// ─── Rules ────────────────────────────────────────────────────────────────────

// Identifiers forbidden anywhere in code, including as a property (`x.fetch`).
const FORBIDDEN_IDENTIFIERS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection',
  'sendBeacon', 'eval', 'execScript', 'Function', 'globalThis', 'postMessage', 'importScripts',
  'Worker', 'SharedWorker', 'serviceWorker', 'indexedDB', 'caches', 'localStorage',
  'sessionStorage', 'cookie', 'cookieStore', 'navigator', 'opener', 'defaultView',
  'contentWindow', 'contentDocument', '__proto__', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'srcdoc', 'dangerouslySetInnerHTML', 'execCommand', 'fromCharCode', 'fromCodePoint', 'atob',
  'unescape', 'BroadcastChannel', 'requestFileSystem', 'webkitRequestFileSystem', 'child_process',
  // Reflection: reaching Function / globals without naming them.
  'Reflect', 'Proxy', 'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'defineProperty', 'defineProperties',
  'caller', 'callee', 'WebAssembly', 'ShadowRealm',
  // Script-executing / document-reaching DOM APIs not covered above.
  'createContextualFragment', 'setHTMLUnsafe', 'parseHTMLUnsafe', 'ownerDocument', 'getRootNode',
  'srcDoc', 'formAction',
]
const FORBIDDEN_IDENTIFIER_RE = new RegExp(`(?<![\\w$])(${FORBIDDEN_IDENTIFIERS.join('|')})(?![\\w$])`, 'g')

// Globals whose names are also common property / variable names (rect.top, { parent }),
// so they are only flagged as a bare identifier that is dereferenced.
const AMBIGUOUS_GLOBAL_DEREF_RE = /(?<![\w$.]|\?\.|\.\s)(self|top|parent|frames|location)\s*(\?\.|\.|\[)/g
const AMBIGUOUS_GLOBAL_ALIAS_RE = /(?:(?<![=!<>])=(?![=>])|:)\s*(self|top|parent|frames)\s*(?=[;,)\n}]|$)/g
const LOCATION_ASSIGN_RE = /(?<![\w$.])location\s*=(?!=)/g

// window / document may only be used as `typeof window` or `window.<static prop>`.
const WINDOW_DOCUMENT_RE = /(?<![\w$.])(window|document)(?![\w$])/g
const WINDOW_FORBIDDEN_PROPS = new Set([
  'location', 'open', 'top', 'parent', 'self', 'frames', 'opener', 'window', 'name',
])
const DOCUMENT_FORBIDDEN_PROPS = new Set([
  'cookie', 'write', 'writeln', 'domain', 'location', 'defaultView', 'open', 'createElement',
  'createElementNS', 'execCommand', 'scripts', 'currentScript', 'forms', 'implementation',
])

const PATTERN_RULES: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?<![\w$.])import\s*\(/g,                  description: 'Dynamic import()' },
  { pattern: /(?<![\w$.])import\s*\.\s*meta\b/g,         description: 'import.meta' },
  { pattern: /(?<![\w$.])require\s*\(/g,                 description: 'require() call' },
  { pattern: /\bprocess\s*\.\s*env\b/g,                  description: 'process.env access' },
  { pattern: /\bnew\s+Image\b/g,                         description: 'Image beacon (new Image())' },
  { pattern: /(?<![\w$])(setTimeout|setInterval)\s*\(\s*['"`]/g, description: 'String-evaluated timer' },
  { pattern: /(\.|\?\.)\s*(constructor|prototype)(?![\w$])/g, description: 'constructor / prototype access' },
  { pattern: /\\[ux]/g,                                  description: 'Escape sequence outside a string literal' },
  { pattern: /\bcrypto\s*\.\s*subtle\b/g,                description: 'Crypto subtle API' },
  { pattern: /\bfs\s*\.\s*(read|write|unlink|rm)\b/g,    description: 'Node fs write operations' },
  // obj['fe' + 'tch'] / obj[`${a}b`] — computed keys assembled from strings.
  { pattern: /(?:[\w$)\]]|\?\.)\s*\[[^\[\]\n]*(?:['"][^\[\]\n]*\+|\+[^\[\]\n]*['"]|`)[^\[\]\n]*\]/g,
    description: 'Computed property access built from strings' },
]

// Exact (trimmed) string values that indicate a computed-access / reflection trick.
const SENSITIVE_STRING_VALUES = new Set([
  ...FORBIDDEN_IDENTIFIERS,
  'constructor', 'prototype', 'window', 'document', 'globalThis', 'script', 'iframe', 'embed',
])
const SENSITIVE_STRING_CONTENT_RE = /javascript:|vbscript:|data:text\/html|<\s*\/?\s*script|<\s*iframe|srcdoc/i

function uniquePush(list: string[], msg: string) {
  if (!list.includes(msg)) list.push(msg)
}

function checkIdentifiers(code: string, errors: string[]) {
  for (const m of code.matchAll(FORBIDDEN_IDENTIFIER_RE)) {
    uniquePush(errors, `Forbidden: ${m[1]}`)
  }
  for (const m of code.matchAll(AMBIGUOUS_GLOBAL_DEREF_RE)) {
    uniquePush(errors, `Forbidden: access through global "${m[1]}"`)
  }
  for (const m of code.matchAll(AMBIGUOUS_GLOBAL_ALIAS_RE)) {
    uniquePush(errors, `Forbidden: aliasing global "${m[1]}"`)
  }
  if (LOCATION_ASSIGN_RE.test(code)) uniquePush(errors, 'Forbidden: location assignment')
  LOCATION_ASSIGN_RE.lastIndex = 0

  // `constructor` is only allowed as a class/object method declaration
  // (`constructor(props) {`), never as a key: `const { constructor: F } = () => 0`
  // hands out the Function constructor. Member access is caught by PATTERN_RULES.
  for (const m of code.matchAll(/(?<![\w$.])constructor(?![\w$])/g)) {
    const idx = m.index ?? 0
    const before = code.slice(Math.max(0, idx - 40), idx)
    const after = code.slice(idx + 'constructor'.length, idx + 'constructor'.length + 40)
    const isMethodDecl = /(?:^|[{};])\s*$/.test(before) && /^\s*\(/.test(after)
    if (!isMethodDecl) uniquePush(errors, 'Forbidden: constructor key (Function constructor access)')
  }

  for (const m of code.matchAll(WINDOW_DOCUMENT_RE)) {
    const name = m[1]
    const idx = m.index ?? 0
    if (/typeof\s*$/.test(code.slice(Math.max(0, idx - 20), idx))) continue
    const after = /^\s*(\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(code.slice(idx + name.length, idx + name.length + 80))
    if (!after) {
      uniquePush(errors, `Forbidden: ${name} may only be used for direct property access (no computed access or aliasing)`)
      continue
    }
    const prop = after[2]
    const blocked = name === 'window' ? WINDOW_FORBIDDEN_PROPS : DOCUMENT_FORBIDDEN_PROPS
    if (blocked.has(prop)) uniquePush(errors, `Forbidden: ${name}.${prop}`)
  }
}

function checkPatterns(code: string, errors: string[]) {
  for (const { pattern, description } of PATTERN_RULES) {
    pattern.lastIndex = 0
    if (pattern.test(code)) uniquePush(errors, `Forbidden: ${description}`)
    pattern.lastIndex = 0
  }
}

function checkStringValue(value: string, errors: string[]) {
  const trimmed = value.trim()
  if (SENSITIVE_STRING_VALUES.has(trimmed)) {
    uniquePush(errors, `Forbidden: string literal "${trimmed}" (computed access to a restricted API)`)
  }
  // Strip whitespace/control chars first: 'java\tscript:' is still a javascript: URL.
  if (SENSITIVE_STRING_CONTENT_RE.test(value.replace(/[\s\u0000-\u001f]+/g, ''))) {
    uniquePush(errors, 'Forbidden: string literal contains a script URL or markup')
  }
}

function checkStrings(lexed: Lexed, errors: string[]) {
  const { strings, code } = lexed
  let chain = ''
  for (let k = 0; k < strings.length; k++) {
    const tok = strings[k]
    checkStringValue(tok.value, errors)
    // Join literal-only concatenations: 'fe' + 'tch'.
    const prevTok = strings[k - 1]
    if (prevTok && /^\s*\+\s*$/.test(code.slice(prevTok.end, tok.start))) {
      chain += tok.value
    } else {
      chain = tok.value
    }
    if (chain !== tok.value) checkStringValue(chain, errors)
  }
}

// Checks that all static imports / re-exports are from the allowlist.
function checkImports(src: string, code: string, errors: string[]) {
  const stmt = /^(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]*)\1/
  for (const m of code.matchAll(/(?<![\w$.])(import|export)(?![\w$])/g)) {
    const idx = m.index ?? 0
    const found = stmt.exec(src.slice(idx, idx + 2000))
    if (!found) continue
    const source = found[2]
    if (!ALLOWED_IMPORT_SOURCES.has(source)) uniquePush(errors, `Disallowed import: "${source}"`)
  }
}

// ─── AST pass (TypeScript TSX parser) ────────────────────────────────────────

const AST_FORBIDDEN_NAMES = new Set([...FORBIDDEN_IDENTIFIERS, 'constructor', 'prototype', 'require'])
// Globals that are only ever flagged as a free value reference (their names are also
// common locals / props: `const [open, setOpen]`, `rect.top`, `{ parent }`).
const AMBIGUOUS_GLOBALS = new Set(['self', 'top', 'parent', 'frames', 'location'])
// Objects whose members must never be looked up with a computed key.
const NO_COMPUTED_ACCESS_OBJECTS = new Set([
  'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'Reflect', 'Object',
  'Function', 'Proxy', 'navigator', 'location',
])
const FORBIDDEN_CONSTRUCTORS = new Set(['Image', 'Audio', 'Worker', 'SharedWorker', 'Function'])
// Calls that are known to return numbers and are therefore fine as a computed key.
const NUMERIC_KEY_CALLEES = new Set(['Number', 'parseInt', 'parseFloat'])

function unwrapExpr(node: ts.Expression): ts.Expression {
  let e = node
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
        ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression
      continue
    }
    return e
  }
}

function isStringish(node: ts.Expression): boolean {
  const e = unwrapExpr(node)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return true
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringish(e.left) || isStringish(e.right)
  }
  return false
}

/** A computed key that cannot be assembled at runtime from strings. */
function isStaticComputedKey(node: ts.Expression): boolean {
  const e = unwrapExpr(node)
  if (ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return true
  if (e.kind === ts.SyntaxKind.ThisKeyword) return true
  if (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) return isStaticComputedKey(e.operand)
  if (ts.isConditionalExpression(e)) return isStaticComputedKey(e.whenTrue) && isStaticComputedKey(e.whenFalse)
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind
    if (op === ts.SyntaxKind.CommaToken || (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment)) {
      return false
    }
    if (op === ts.SyntaxKind.PlusToken && (isStringish(e.left) || isStringish(e.right))) return false
    return isStaticComputedKey(e.left) && isStaticComputedKey(e.right)
  }
  if (ts.isCallExpression(e)) {
    const callee = unwrapExpr(e.expression)
    if (ts.isIdentifier(callee) && NUMERIC_KEY_CALLEES.has(callee.text)) return true
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math') {
      return true
    }
  }
  return false
}

/** True when the identifier is a declaration name / property name rather than a value reference. */
function isNonReferenceName(id: ts.Identifier): boolean {
  const p = id.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p)) return p.name === id
  if (ts.isQualifiedName(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true
  if (ts.isJsxAttribute(p)) return true
  if (ts.isBindingElement(p)) return p.propertyName === id || p.name === id
  if (
    ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isVariableDeclaration(p) ||
    ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) || ts.isTypeParameterDeclaration(p) || ts.isEnumDeclaration(p) ||
    ts.isImportClause(p) || ts.isNamespaceImport(p)
  ) {
    return (p as { name?: ts.Node }).name === id
  }
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true
  return false
}

function collectDeclaredNames(sf: ts.SourceFile): Set<string> {
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

type Folded = string | string[] | null

/**
 * Best-effort constant folding of string-building expressions, so that
 * 'con' + 'structor', `${'fe'}tch`, ['fe','tch'].join(''), 'a'.concat('b') and
 * 'rotcurtsnoc'.split('').reverse().join('') are checked by their resulting value.
 */
function foldString(node: ts.Expression, consts: Map<string, string>, depth = 0): Folded {
  // Fail closed (caught in checkAst) rather than silently skipping a long chain.
  if (depth > 400) throw new Error('string expression nested too deeply')
  const e = unwrapExpr(node)
  const str = (x: ts.Expression): string | null => {
    const v = foldString(x, consts, depth + 1)
    return typeof v === 'string' ? v : null
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isNumericLiteral(e)) return e.text
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
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = str(e.left)
    const r = l === null ? null : str(e.right)
    return l === null || r === null ? null : l + r
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
    const target = foldString(e.expression.expression, consts, depth + 1)
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
      return null
    }
    if (method === 'join') return target.join(args.length ? args[0] : ',')
    if (method === 'reverse') return [...target].reverse()
    if (method === 'concat') return [...target, ...args]
    return null
  }
  return null
}

function collectConstStrings(sf: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>()
  const ambiguous = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text
      const v = foldString(node.initializer, consts)
      if (typeof v === 'string' && !ambiguous.has(name) && !consts.has(name)) consts.set(name, v)
      else { consts.delete(name); ambiguous.add(name) }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return consts
}

function checkAst(code: string, errors: string[]) {
  try {
    runAstChecks(code, errors)
  } catch (err) {
    // Anything unexpected (deep nesting, parser edge case) rejects the component.
    uniquePush(errors, `Component could not be fully analysed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function runAstChecks(code: string, errors: string[]) {
  let sf: ts.SourceFile
  try {
    sf = ts.createSourceFile('component.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  } catch {
    uniquePush(errors, 'Component source could not be parsed')
    return
  }
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    const where = first.start !== undefined ? sf.getLineAndCharacterOfPosition(first.start) : null
    uniquePush(
      errors,
      `Syntax error${where ? ` at line ${where.line + 1}` : ''}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`
    )
    return
  }

  const declared = collectDeclaredNames(sf)
  const consts = collectConstStrings(sf)

  const checkModuleSpecifier = (spec: ts.Expression | undefined) => {
    if (!spec) return
    if (!ts.isStringLiteral(spec) || !ALLOWED_IMPORT_SOURCES.has(spec.text)) {
      uniquePush(errors, `Disallowed import: "${ts.isStringLiteral(spec) ? spec.text : spec.getText(sf)}"`)
    }
  }

  const checkGlobalReference = (id: ts.Identifier) => {
    const name = id.text
    const p = id.parent
    if (name === 'window' || name === 'document') {
      if (ts.isTypeOfExpression(p)) return
      if (ts.isPropertyAccessExpression(p) && p.expression === id) {
        const blocked = name === 'window' ? WINDOW_FORBIDDEN_PROPS : DOCUMENT_FORBIDDEN_PROPS
        if (blocked.has(p.name.text)) uniquePush(errors, `Forbidden: ${name}.${p.name.text}`)
        return
      }
      uniquePush(errors, `Forbidden: ${name} may only be used for direct property access (no computed access or aliasing)`)
      return
    }
    if (AMBIGUOUS_GLOBALS.has(name) && !declared.has(name)) {
      if (ts.isTypeOfExpression(p)) return
      uniquePush(errors, `Forbidden: access through global "${name}"`)
    }
  }

  const visit = (node: ts.Node): void => {
    // Types carry no runtime behaviour — except a class `extends <expression>`.
    if (ts.isTypeNode(node) && !(ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) &&
        node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent))) {
      return
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return

    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const name = node.text
      if (AST_FORBIDDEN_NAMES.has(name)) uniquePush(errors, `Forbidden: ${name}`)
      if (ts.isIdentifier(node) && !isNonReferenceName(node)) checkGlobalReference(node)
      return
    }

    if (ts.isImportDeclaration(node)) checkModuleSpecifier(node.moduleSpecifier)
    else if (ts.isExportDeclaration(node)) checkModuleSpecifier(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node)) uniquePush(errors, 'Forbidden: import = require()')
    else if (ts.isMetaProperty(node)) uniquePush(errors, 'Forbidden: import.meta / new.target')
    else if (ts.isWithStatement(node)) uniquePush(errors, 'Forbidden: with statement')
    else if (ts.isDebuggerStatement(node)) uniquePush(errors, 'Forbidden: debugger statement')
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      uniquePush(errors, 'Forbidden: Dynamic import()')
    } else if (ts.isNewExpression(node)) {
      const callee = unwrapExpr(node.expression)
      if (ts.isIdentifier(callee) && FORBIDDEN_CONSTRUCTORS.has(callee.text)) {
        uniquePush(errors, `Forbidden: new ${callee.text}()`)
      }
    } else if (ts.isElementAccessExpression(node)) {
      const obj = unwrapExpr(node.expression)
      if (ts.isIdentifier(obj) && NO_COMPUTED_ACCESS_OBJECTS.has(obj.text)) {
        uniquePush(errors, `Forbidden: computed member access on ${obj.text}`)
      }
      if (!isStaticComputedKey(node.argumentExpression)) {
        uniquePush(errors, 'Forbidden: computed property key built at runtime')
      }
    } else if (ts.isBindingElement(node) && node.propertyName && ts.isComputedPropertyName(node.propertyName)) {
      uniquePush(errors, 'Forbidden: computed key in destructuring')
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf)
      if (FORBIDDEN_JSX_TAGS.has(tag.toLowerCase())) uniquePush(errors, `Forbidden: <${tag}> element`)
    }

    // String values, including ones assembled from literals.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkStringValue(node.text, errors)
    } else if (ts.isTemplateExpression(node)) {
      checkStringValue(node.head.text, errors)
      for (const span of node.templateSpans) checkStringValue(span.literal.text, errors)
    }
    if (ts.isBinaryExpression(node) || ts.isTemplateExpression(node) || ts.isCallExpression(node)) {
      const folded = foldString(node, consts)
      if (typeof folded === 'string') checkStringValue(folded, errors)
      else if (Array.isArray(folded)) checkStringValue(folded.join(''), errors)
    }

    ts.forEachChild(node, visit)
  }
  visit(sf)
}

export function validateCustomComponent(code: string): ValidationResult {
  if (typeof code !== 'string') {
    return { valid: false, errors: ['Component source must be a string'], warnings: [] }
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_BYTES) {
    return { valid: false, errors: [`Component exceeds maximum size (${MAX_BYTES} bytes)`], warnings: [] }
  }

  const lexed = lex(code)
  const view = lexed.code
  const errors: string[] = []
  const warnings: string[] = []
  if (!lexed.ok) warnings.push('Source could not be fully tokenized; validated against raw text')

  checkAst(code, errors)

  checkImports(code, view, errors)
  checkIdentifiers(view, errors)
  checkPatterns(view, errors)
  checkStrings(lexed, errors)
  for (const tag of lexed.jsxTags) {
    if (FORBIDDEN_JSX_TAGS.has(tag.toLowerCase())) uniquePush(errors, `Forbidden: <${tag}> element`)
  }

  // Checks for a default export (required for the section registry)
  if (!/(?<![\w$])export\s+default(?![\w$])/.test(view)) {
    errors.push('Component must have a default export')
  }

  if (/\bwindow\b/.test(view)) warnings.push('Uses window — ensure SSR compatibility with typeof window checks')
  if (/\bdocument\b/.test(view)) warnings.push('Uses document — ensure SSR compatibility')
  if (/\buseEffect\b/.test(view) && !/\[\s*\]/.test(view)) {
    warnings.push('useEffect with no empty-deps array detected — verify it does not cause infinite re-renders')
  }

  return { valid: errors.length === 0, errors, warnings }
}
