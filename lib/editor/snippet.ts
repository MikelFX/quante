// Visual editor v2 — snippets the merchant (or the AI on their behalf) adds to a page
// (2026-09-27). A snippet is plain, static JSX: allowlisted HTML tags, next/link, a set
// of lucide icons, attributes whose values are string literals (numbers only for icon
// size / strokeWidth), text, and nothing else — no expressions, no event handlers, no
// spreads, no components beyond those. That keeps every inserted element safe (it also
// has to pass the AI store-file filter afterwards) and fully editable by the visual
// editor (text + className strings). No '@/…' imports: tests load this through Node's
// type stripping.

import ts from 'typescript'

export const SNIPPET_TAGS: ReadonlySet<string> = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'small', 'blockquote',
  'ul', 'ol', 'li', 'a', 'button', 'img', 'hr', 'br', 'figure', 'figcaption', 'label',
])
const VOID_TAGS = new Set(['img', 'hr', 'br'])

export const SNIPPET_ICONS: ReadonlySet<string> = new Set([
  'ArrowRight', 'ArrowLeft', 'ArrowUpRight', 'ChevronRight', 'ChevronDown', 'Check', 'CheckCircle',
  'Star', 'Heart', 'ShoppingBag', 'ShoppingCart', 'Truck', 'Package', 'Shield', 'Lock', 'Gift',
  'Sparkles', 'Zap', 'Leaf', 'Clock', 'Mail', 'Phone', 'MapPin', 'Globe', 'Tag', 'Award', 'Plus',
])

const ATTRS: ReadonlySet<string> = new Set(['className', 'href', 'src', 'alt', 'title', 'type', 'target', 'rel', 'id', 'aria-label', 'aria-hidden'])
const ICON_NUMERIC_ATTRS = new Set(['size', 'strokeWidth'])
const MAX_SNIPPET_CHARS = 6000

export function isVoidTag(tag: string): boolean {
  return VOID_TAGS.has(tag)
}

function urlOk(attr: string, value: string): boolean {
  const v = value.trim()
  if (attr === 'href') return /^(\/(?!\/)|#|https:\/\/|mailto:|tel:)/.test(v)
  if (attr === 'src') return /^(\/(?!\/)|https:\/\/)/.test(v)
  return true
}

export type SnippetResult = { ok: true; code: string; icons: string[]; usesLink: boolean } | { ok: false; error: string }

/** Validates a snippet; returns it trimmed plus the imports it needs. */
export function validateSnippet(raw: string): SnippetResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Empty snippet.' }
  // Models sometimes wrap the answer in a code fence despite instructions.
  const code = raw.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
  if (!code) return { ok: false, error: 'Empty snippet.' }
  if (code.length > MAX_SNIPPET_CHARS) return { ok: false, error: 'The element is too large.' }

  const wrapped = `const __snippet = (<>\n${code}\n</>)`
  const sf = ts.createSourceFile('snippet.tsx', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (((sf as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0) {
    return { ok: false, error: 'The element is not valid JSX.' }
  }
  const stmt = sf.statements[0]
  const decl = stmt && ts.isVariableStatement(stmt) ? stmt.declarationList.declarations[0] : undefined
  let frag: ts.Expression | undefined = decl?.initializer
  while (frag && ts.isParenthesizedExpression(frag)) frag = frag.expression
  if (sf.statements.length !== 1 || !frag || !ts.isJsxFragment(frag)) return { ok: false, error: 'Only JSX elements are allowed.' }
  const roots = frag.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
  if (roots.length === 0 || !roots.every((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))) {
    return { ok: false, error: 'The snippet must consist of JSX elements.' }
  }

  const icons = new Set<string>()
  let usesLink = false
  let error: string | null = null
  const fail = (e: string) => { if (!error) error = e }

  const checkOpening = (o: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    if (!ts.isIdentifier(o.tagName)) { fail('Only plain tags are allowed.'); return }
    const tag = o.tagName.text
    const isIcon = SNIPPET_ICONS.has(tag)
    if (tag === 'Link') usesLink = true
    else if (isIcon) icons.add(tag)
    else if (!SNIPPET_TAGS.has(tag)) { fail(`<${tag}> is not allowed here.`); return }
    if (o.typeArguments) fail('Type arguments are not allowed.')
    for (const a of o.attributes.properties) {
      if (!ts.isJsxAttribute(a)) { fail('Spread attributes are not allowed.'); continue }
      const name = a.name.getText(sf)
      const init = a.initializer
      if (isIcon && ICON_NUMERIC_ATTRS.has(name)) {
        if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isNumericLiteral(init.expression)) fail(`${name} must be a number.`)
        continue
      }
      if (isIcon && name === 'className') { /* string checked below */ }
      else if (!ATTRS.has(name)) { fail(`The attribute ${name} is not allowed.`); continue }
      const value = init && ts.isStringLiteral(init) ? init.text
        : init && ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression.text
          : null
      if (value === null) { fail(`${name} must be a plain string.`); continue }
      if (!urlOk(name, value)) fail(`${name} must be a relative or https URL.`)
      if (name === 'className' && !/^[A-Za-z0-9_\-:/.[\]#%(),!@+*= ]{0,1000}$/.test(value)) fail('Classes may not contain quotes, braces or backslashes.')
    }
  }

  const visit = (n: ts.Node) => {
    if (error) return
    if (ts.isJsxElement(n)) {
      checkOpening(n.openingElement)
      n.children.forEach(visit)
      return
    }
    if (ts.isJsxSelfClosingElement(n)) { checkOpening(n); return }
    if (ts.isJsxText(n)) return
    if (ts.isJsxExpression(n)) {
      if (n.expression && !(ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression))) {
        fail('Only static text is allowed (no code expressions).')
      }
      return
    }
    fail('Only JSX elements and text are allowed.')
  }
  roots.forEach(visit)
  if (error) return { ok: false, error }
  return { ok: true, code, icons: [...icons].sort(), usesLink }
}

/** Adds missing `import { … } from 'lucide-react'` names and `import Link from 'next/link'`. */
export function ensureSnippetImports(source: string, icons: string[], usesLink: boolean): string {
  const sf = ts.createSourceFile('f.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = sf.statements.filter(ts.isImportDeclaration)
  const edits: Array<{ at: number; end: number; text: string }> = []
  const lastImportEnd = imports.length > 0 ? imports[imports.length - 1].getEnd() : 0
  const newLines: string[] = []

  if (icons.length > 0) {
    const lucide = imports.find((i) => ts.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text === 'lucide-react')
    const named = lucide?.importClause?.namedBindings
    if (lucide && named && ts.isNamedImports(named)) {
      const have = new Set(named.elements.map((e) => e.name.text))
      const missing = icons.filter((i) => !have.has(i))
      if (missing.length > 0) {
        const last = named.elements[named.elements.length - 1]
        const at = last ? last.getEnd() : named.getStart(sf) + 1
        edits.push({ at, end: at, text: (last ? ', ' : ' ') + missing.join(', ') + (last ? '' : ' ') })
      }
    } else {
      newLines.push(`import { ${icons.join(', ')} } from 'lucide-react'`)
    }
  }
  if (usesLink) {
    const link = imports.find((i) => ts.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text === 'next/link')
    if (!link) newLines.push(`import Link from 'next/link'`)
  }
  if (newLines.length > 0) {
    const text = (lastImportEnd > 0 ? '\n' : '') + newLines.join('\n') + (lastImportEnd > 0 ? '' : '\n')
    edits.push({ at: lastImportEnd, end: lastImportEnd, text })
  }
  let out = source
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end)
  return out
}

/** Re-indents a (possibly multi-line) snippet so its continuation lines sit at `indent`. */
export function indentSnippet(code: string, indent: string): string {
  const lines = code.split('\n')
  const common = Math.min(...lines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^\s*/)?.[0].length ?? 0), Infinity)
  const strip = Number.isFinite(common) ? common : 0
  return lines.map((l, i) => (i === 0 ? l.trim() : l.trim() ? indent + l.slice(strip) : '')).join('\n')
}
