// Deterministic codemod: inline theme styles → Tailwind token classes (2026-09-26).
//
// Generated store pages used to style theme colors inline:
//   <p style={{ color: 'var(--color-muted)', borderRadius: 'var(--radius)' }}>
// With the store theme registered as Tailwind tokens (THEME_TOKENS_CSS in build.ts) the
// same thing is a class list — the only styling system a visual editor then has to
// understand:
//   <p className="text-muted rounded-store">
//
// Only exact token values are converted (a literal 'var(--color-accent)', '1px solid
// var(--color-border)', 'var(--radius)', 'var(--font-heading)' …); every other style
// property stays inline. Edits are text-range replacements on the original source (no
// TypeScript printer), so formatting and everything else in the file stay as they were.
// No '@/…' imports: tests load this file through Node's type stripping.

import ts from 'typescript'

/** Theme color tokens (Tailwind --color-* namespace → bg-X / text-X / border-X …). */
export const COLOR_TOKENS: ReadonlySet<string> = new Set(['bg', 'surface', 'text', 'muted', 'accent', 'accent-text', 'border'])

function colorToken(value: string): string | null {
  const m = value.trim().match(/^var\(--color-([a-z-]+)\)$/)
  return m && COLOR_TOKENS.has(m[1]) ? m[1] : null
}

function sideBorder(prefix: string) {
  return (v: string): string[] | null => {
    const m = v.trim().match(/^1px solid var\(--color-([a-z-]+)\)$/)
    return m && COLOR_TOKENS.has(m[1]) ? [prefix, `${prefix}-${m[1]}`] : null
  }
}

const PROPERTY_RULES: Record<string, (value: string) => string[] | null> = {
  color: (v) => { const t = colorToken(v); return t ? [`text-${t}`] : null },
  background: (v) => { const t = colorToken(v); return t ? [`bg-${t}`] : null },
  backgroundColor: (v) => { const t = colorToken(v); return t ? [`bg-${t}`] : null },
  borderColor: (v) => { const t = colorToken(v); return t ? [`border-${t}`] : null },
  fill: (v) => { const t = colorToken(v); return t ? [`fill-${t}`] : null },
  stroke: (v) => { const t = colorToken(v); return t ? [`stroke-${t}`] : null },
  border: sideBorder('border'),
  borderTop: sideBorder('border-t'),
  borderBottom: sideBorder('border-b'),
  borderLeft: sideBorder('border-l'),
  borderRight: sideBorder('border-r'),
  borderRadius: (v) => {
    const t = v.trim()
    if (t === 'var(--radius)') return ['rounded-store']
    if (t === '50%' || t === '100%' || t === '9999px' || t === '999px') return ['rounded-full']
    if (t === '0' || t === '0px') return ['rounded-none']
    return null
  },
  fontFamily: (v) => {
    const t = v.trim()
    return t === 'var(--font-heading)' ? ['font-heading'] : t === 'var(--font-body)' ? ['font-body'] : null
  },
}

export interface CodemodResult {
  code: string
  /** Style properties turned into classes. */
  converted: number
  /** style={…} attributes left in the file (partly converted or not convertible). */
  remainingStyleAttrs: number
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(p)) return null
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
  return null
}

function literalText(e: ts.Expression): string | null {
  return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null
}

function joinClasses(existing: string, add: string[]): string {
  const have = existing.split(/\s+/).filter(Boolean)
  const merged = [...have, ...add.filter((c) => !have.includes(c))]
  return merged.join(' ')
}

/** Converts token-valued inline styles in one .tsx source. Non-.tsx or unparsable input is returned unchanged. */
export function convertInlineStyles(source: string, fileName = 'file.tsx'): CodemodResult {
  if (!fileName.endsWith('.tsx')) return { code: source, converted: 0, remainingStyleAttrs: 0 }
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: Array<{ start: number; end: number; text: string }> = []
  let converted = 0
  let styleAttrs = 0
  let removedAttrs = 0

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) handleElement(node.attributes)
    ts.forEachChild(node, visit)
  }

  const handleElement = (attrs: ts.JsxAttributes) => {
    let style: ts.JsxAttribute | null = null
    let className: ts.JsxAttribute | null = null
    for (const a of attrs.properties) {
      if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name)) continue
      if (a.name.text === 'style') style = a
      else if (a.name.text === 'className') className = a
    }
    if (!style) return
    styleAttrs++
    const init = style.initializer
    if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isObjectLiteralExpression(init.expression)) return
    const obj = init.expression

    const classes: string[] = []
    const keep: ts.ObjectLiteralElementLike[] = []
    let convertedHere = 0
    for (const p of obj.properties) {
      const name = propName(p)
      const value = name && ts.isPropertyAssignment(p) ? literalText(p.initializer) : null
      const rule = name && value !== null ? PROPERTY_RULES[name] : undefined
      const out = rule ? rule(value as string) : null
      if (out) { classes.push(...out); convertedHere++ } else keep.push(p)
    }
    if (classes.length === 0) return

    // Where the classes go. A className we can't safely extend → leave this element alone.
    let classEdit: { start: number; end: number; text: string } | null = null
    if (!className) {
      classEdit = null // added in place of / next to style below
    } else {
      const ci = className.initializer
      if (ci && ts.isStringLiteral(ci)) {
        classEdit = { start: ci.getStart(sf), end: ci.getEnd(), text: JSON.stringify(joinClasses(ci.text, classes)) }
      } else if (ci && ts.isJsxExpression(ci) && ci.expression && (ts.isStringLiteral(ci.expression) || ts.isNoSubstitutionTemplateLiteral(ci.expression))) {
        classEdit = { start: ci.getStart(sf), end: ci.getEnd(), text: JSON.stringify(joinClasses(ci.expression.text, classes)) }
      } else if (ci && ts.isJsxExpression(ci) && ci.expression && ts.isTemplateExpression(ci.expression)) {
        const tail = ci.expression.templateSpans[ci.expression.templateSpans.length - 1].literal
        // Insert before the closing backtick of the last template part.
        classEdit = { start: tail.getEnd() - 1, end: tail.getEnd() - 1, text: ' ' + classes.join(' ') }
      } else {
        return
      }
    }

    converted += convertedHere
    const styleStart = style.getStart(sf)
    const styleEnd = style.getEnd()
    const keptStyle = keep.length > 0 ? `style={{ ${keep.map((p) => p.getText(sf)).join(', ')} }}` : ''
    if (!className) {
      const cls = `className=${JSON.stringify(classes.join(' '))}`
      edits.push({ start: styleStart, end: styleEnd, text: keptStyle ? `${cls} ${keptStyle}` : cls })
    } else {
      edits.push(classEdit as { start: number; end: number; text: string })
      if (keptStyle) {
        edits.push({ start: styleStart, end: styleEnd, text: keptStyle })
      } else {
        // Drop the attribute together with the whitespace in front of it.
        let s = styleStart
        while (s > 0 && /[ \t]/.test(source[s - 1])) s--
        if (s > 0 && source[s - 1] === '\n') {
          // Attribute on its own line: remove the whole line.
          edits.push({ start: s - 1, end: styleEnd, text: '' })
        } else {
          edits.push({ start: s, end: styleEnd, text: '' })
        }
      }
    }
    if (keep.length === 0) removedAttrs++
  }

  visit(sf)
  if (edits.length === 0) return { code: source, converted: 0, remainingStyleAttrs: styleAttrs }

  edits.sort((a, b) => b.start - a.start)
  let code = source
  let lastStart = Infinity
  for (const e of edits) {
    if (e.end > lastStart) return { code: source, converted: 0, remainingStyleAttrs: styleAttrs } // overlap — refuse
    code = code.slice(0, e.start) + e.text + code.slice(e.end)
    lastStart = e.start
  }
  // The result must still parse (a JSX/TS syntax error here would only surface as a
  // failed Vercel build).
  const check = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  if ((check.parseDiagnostics?.length ?? 0) > 0) return { code: source, converted: 0, remainingStyleAttrs: styleAttrs }
  return { code, converted, remainingStyleAttrs: styleAttrs - removedAttrs }
}

/** Applies convertInlineStyles to every .tsx file; returns the changed files only. */
export function convertStoreFiles(files: Record<string, string>): {
  changed: Record<string, string>
  converted: number
  remainingStyleAttrs: number
} {
  const changed: Record<string, string> = {}
  let converted = 0
  let remainingStyleAttrs = 0
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.tsx') || typeof content !== 'string') continue
    const r = convertInlineStyles(content, path)
    converted += r.converted
    remainingStyleAttrs += r.remainingStyleAttrs
    if (r.code !== content) changed[path] = r.code
  }
  return { changed, converted, remainingStyleAttrs }
}

/**
 * The self-repair step every new AI output goes through before it is filtered and saved
 * (generate / iterate / fix): theme styles the model still wrote inline become token
 * classes. Deterministic and free — no extra model call. Inline styles that no class can
 * express (conditionals, gradients, transforms, runtime values) are left alone.
 */
export function withTokenClasses<T extends Record<string, string>>(files: T): T {
  const { changed } = convertStoreFiles(files)
  return Object.keys(changed).length > 0 ? { ...files, ...changed } : files
}
