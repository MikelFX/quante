// Visual editor v1 — source instrumentation + source edits (2026-09-26).
//
// The store's code stays the single source of truth. For the editing sandbox (and ONLY
// there — never in code_versions, deploys or exports) every editable JSX element gets a
// `data-oid="<fileKey>.<index>"` attribute, where index is the element's position in a
// pre-order walk of the file. A click in the preview maps back to that element; the edit
// is applied to the CLEAN source as a text-range replacement (no TypeScript printer, so
// formatting is kept), then the file is re-instrumented and a fresh map is returned.
//
// v1 operations: change an element's text, change its class list, move it up/down among
// its sibling elements. Cart / checkout / success / legal / layout files get no oids.
// No '@/…' imports: tests load this file through Node's type stripping.

import ts from 'typescript'

/** Files the visual editor never instruments (engine-critical or platform-managed). */
export const EDITOR_EXCLUDED_PATHS: ReadonlySet<string> = new Set([
  'app/layout.tsx',
  'app/cart/page.tsx',
  'app/success/page.tsx',
  'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx', 'app/contact/page.tsx',
  'components/layout/CartDrawer.tsx',
  'components/layout/CookieConsent.tsx',
  'components/layout/ThemeStyle.tsx',
  'components/layout/ThemeBridge.tsx',
  'components/legal/LegalPageView.tsx',
])

export function isEditorEditablePath(path: string): boolean {
  if (!path.endsWith('.tsx') || EDITOR_EXCLUDED_PATHS.has(path)) return false
  if (path.startsWith('app/api/')) return false
  return path.startsWith('components/store/')
    || /^app\/(?:[^/]+\/)*page\.tsx$/.test(path)
    || path === 'components/layout/Navbar.tsx'
    || path === 'components/layout/Footer.tsx'
}

export interface EditorNode {
  oid: string
  file: string
  index: number
  tag: string
  /** Current text when the element's content is a single text node (editable), else null. */
  text: string | null
  /** Current class list when className is a plain string (or absent), else null (not editable). */
  className: string | null
  canMoveUp: boolean
  canMoveDown: boolean
  /** Rendered inside a .map() callback — an edit changes every item. */
  repeated: boolean
}

type JsxEl = ts.JsxElement | ts.JsxSelfClosingElement

interface Found {
  element: JsxEl
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement
  tag: string
}

const INSTRUMENTED_COMPONENTS = new Set(['Link', 'Image'])

function isInstrumentableTag(tag: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(tag) || /^motion\.[a-z][a-z0-9]*$/.test(tag) || INSTRUMENTED_COMPONENTS.has(tag)
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function hasParseErrors(sf: ts.SourceFile): boolean {
  return ((sf as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0
}

/** Instrumentable JSX elements of a file in pre-order (the order that defines their index). */
function collect(sf: ts.SourceFile): Found[] {
  const out: Found[] = []
  const visit = (node: ts.Node, insideSvg: boolean) => {
    let inSvg = insideSvg
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const tag = opening.tagName.getText(sf)
      if (!insideSvg && isInstrumentableTag(tag)) out.push({ element: node, opening, tag })
      if (tag === 'svg') inSvg = true
    }
    ts.forEachChild(node, (c) => visit(c, inSvg))
  }
  visit(sf, false)
  return out
}

function meaningfulChildren(el: ts.JsxElement): ts.JsxChild[] {
  return el.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
}

function textOf(found: Found): string | null {
  if (!ts.isJsxElement(found.element)) return null
  const kids = meaningfulChildren(found.element)
  if (kids.length === 0) return ''
  if (kids.length !== 1) return null
  const k = kids[0]
  if (ts.isJsxText(k)) return k.text.replace(/\s+/g, ' ').trim()
  if (ts.isJsxExpression(k) && k.expression && (ts.isStringLiteral(k.expression) || ts.isNoSubstitutionTemplateLiteral(k.expression))) {
    return k.expression.text
  }
  return null
}

function classAttr(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): ts.JsxAttribute | null {
  for (const a of opening.attributes.properties) {
    if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'className') return a
  }
  return null
}

function classOf(found: Found): string | null {
  const attr = classAttr(found.opening)
  if (!attr) return ''
  const init = attr.initializer
  if (!init) return null
  if (ts.isStringLiteral(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) {
    return init.expression.text
  }
  return null
}

/** Direct non-whitespace children of the element's parent, when it is a JSX element/fragment. */
function siblingsOf(found: Found): ts.JsxChild[] | null {
  const parent = found.element.parent
  if (!parent || !(ts.isJsxElement(parent) || ts.isJsxFragment(parent))) return null
  return parent.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
}

function isMovable(c: ts.JsxChild | undefined): c is JsxEl {
  return !!c && (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))
}

function isRepeated(found: Found): boolean {
  let n: ts.Node | undefined = found.element.parent
  while (n) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isCallExpression(n.parent)) {
      const callee = n.parent.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'map') return true
    }
    n = n.parent
  }
  return false
}

function describe(found: Found, file: string, key: string, index: number): EditorNode {
  const sibs = siblingsOf(found)
  const at = sibs ? sibs.indexOf(found.element as ts.JsxChild) : -1
  return {
    oid: `${key}.${index.toString(36)}`,
    file,
    index,
    tag: found.tag,
    text: textOf(found),
    className: classOf(found),
    canMoveUp: at > 0 && isMovable(sibs?.[at - 1]),
    canMoveDown: at >= 0 && !!sibs && at < sibs.length - 1 && isMovable(sibs[at + 1]),
    repeated: isRepeated(found),
  }
}

/** Adds data-oid attributes to one file. Unparsable files are returned unchanged with no nodes. */
export function instrumentSource(path: string, source: string, key: string): { code: string; nodes: EditorNode[] } {
  const sf = parse(path, source)
  if (hasParseErrors(sf)) return { code: source, nodes: [] }
  const found = collect(sf)
  const nodes = found.map((f, i) => describe(f, path, key, i))
  const inserts = found.map((f, i) => ({ at: f.opening.tagName.getEnd(), text: ` data-oid="${nodes[i].oid}"` }))
  let code = source
  for (const ins of inserts.sort((a, b) => b.at - a.at)) code = code.slice(0, ins.at) + ins.text + code.slice(ins.at)
  return { code, nodes }
}

/** Stable per-file keys: base-36 index of the file among the sorted editable paths. */
export function editorFileKeys(paths: string[]): Map<string, string> {
  const editable = paths.filter(isEditorEditablePath).sort()
  return new Map(editable.map((p, i) => [p, i.toString(36)]))
}

/** Instruments every editable file; returns the instrumented copies and the oid map. */
export function instrumentFiles(files: Record<string, string>): { files: Record<string, string>; nodes: Record<string, EditorNode> } {
  const keys = editorFileKeys(Object.keys(files))
  const out: Record<string, string> = {}
  const nodes: Record<string, EditorNode> = {}
  for (const [path, key] of keys) {
    const r = instrumentSource(path, files[path], key)
    out[path] = r.code
    for (const n of r.nodes) nodes[n.oid] = n
  }
  return { files: out, nodes }
}

export type EditorOp =
  | { kind: 'text'; value: string }
  | { kind: 'classes'; value: string }
  | { kind: 'move'; direction: 'up' | 'down' }

/** Class lists the editor accepts: Tailwind utilities incl. arbitrary values, no quotes/braces/backslashes. */
export const EDITOR_CLASS_RE = /^[A-Za-z0-9_\-:/.[\]#%(),!@+*= ]{0,1000}$/

export type EditorEditResult = { ok: true; code: string; index: number } | { ok: false; error: string }

/**
 * Applies one op to the element with the given pre-order index (and tag, as a guard
 * against a stale map) in the clean source. Returns the new source and the element's
 * index in it (moves change it).
 */
export function applyEditorOp(path: string, source: string, index: number, tag: string, op: EditorOp): EditorEditResult {
  const sf = parse(path, source)
  if (hasParseErrors(sf)) return { ok: false, error: 'This file could not be parsed.' }
  const found = collect(sf)
  const target = found[index]
  if (!target || target.tag !== tag) return { ok: false, error: 'The page changed meanwhile — reload the editor.' }

  let edits: Array<{ start: number; end: number; text: string }> = []
  let newStart = target.element.getStart(sf)

  if (op.kind === 'text') {
    if (typeof op.value !== 'string' || op.value.length > 5000 || op.value.includes('\u0000')) return { ok: false, error: 'Text is too long.' }
    if (textOf(target) === null || !ts.isJsxElement(target.element)) return { ok: false, error: 'This element has mixed content — edit it in Chat.' }
    const el = target.element
    const safeRaw = /^[^{}<>&\n\r]*$/.test(op.value) && op.value === op.value.trim()
    const replacement = safeRaw ? op.value : `{${JSON.stringify(op.value)}}`
    const kids = meaningfulChildren(el)
    if (kids.length === 0) {
      const at = el.openingElement.getEnd()
      edits = [{ start: at, end: at, text: replacement }]
    } else {
      const k = kids[0]
      if (ts.isJsxText(k)) {
        const raw = k.text
        const lead = raw.match(/^\s*/)?.[0] ?? ''
        const trail = raw.match(/\s*$/)?.[0] ?? ''
        // JsxText has no leading trivia: pos is where its raw text (incl. whitespace) starts.
        edits = [{ start: k.pos + lead.length, end: k.end - trail.length, text: replacement }]
      } else {
        edits = [{ start: k.getStart(sf), end: k.getEnd(), text: replacement }]
      }
    }
  } else if (op.kind === 'classes') {
    const value = typeof op.value === 'string' ? op.value.replace(/\s+/g, ' ').trim() : ''
    if (!EDITOR_CLASS_RE.test(value)) return { ok: false, error: 'Classes may not contain quotes, braces or backslashes.' }
    if (classOf(target) === null) return { ok: false, error: 'This element builds its classes in code — edit it in Chat.' }
    const attr = classAttr(target.opening)
    if (attr && attr.initializer) {
      if (value === '') {
        let s = attr.getStart(sf)
        while (s > 0 && /[ \t]/.test(source[s - 1])) s--
        edits = [{ start: s, end: attr.getEnd(), text: '' }]
      } else {
        edits = [{ start: attr.initializer.getStart(sf), end: attr.initializer.getEnd(), text: JSON.stringify(value) }]
      }
    } else if (value !== '') {
      const at = target.opening.tagName.getEnd()
      edits = [{ start: at, end: at, text: ` className=${JSON.stringify(value)}` }]
    }
  } else if (op.kind === 'move') {
    const sibs = siblingsOf(target)
    const at = sibs ? sibs.indexOf(target.element as ts.JsxChild) : -1
    const other = sibs && at >= 0 ? sibs[op.direction === 'up' ? at - 1 : at + 1] : undefined
    if (!isMovable(other)) return { ok: false, error: `This element can't move ${op.direction}.` }
    const t0 = target.element.getStart(sf), t1 = target.element.getEnd()
    const n0 = other.getStart(sf), n1 = other.getEnd()
    const tText = source.slice(t0, t1), nText = source.slice(n0, n1)
    edits = [{ start: t0, end: t1, text: nText }, { start: n0, end: n1, text: tText }]
    newStart = op.direction === 'up' ? n0 : t0 + (n1 - n0) + (n0 - t1)
  } else {
    return { ok: false, error: 'Unknown operation.' }
  }

  if (edits.length === 0) return { ok: true, code: source, index }
  let code = source
  for (const e of [...edits].sort((a, b) => b.start - a.start)) code = code.slice(0, e.start) + e.text + code.slice(e.end)

  const after = parse(path, code)
  if (hasParseErrors(after)) return { ok: false, error: 'The edit would break this file.' }
  const newIndex = collect(after).findIndex((f) => f.element.getStart(after) === newStart)
  return { ok: true, code, index: newIndex >= 0 ? newIndex : index }
}
