// Server-only. Reads / writes the theme (config.design: colors, fonts, radius) of a
// code-gen store's data/config.ts for the Studio theme panel.
//
// data/config.ts is the single source of the store's theme: the scaffold's ThemeStyle
// turns config.design into CSS variables (lib/store-template/build.ts, THEME_*). Writing
// replaces only the initializers of design.colors / design.fonts / design.radius in the
// source text (TypeScript AST ranges), so the rest of the file — formatting, comments,
// everything the AI or the merchant wrote — stays byte-for-byte the same. Never executes
// the file.

import ts from 'typescript'
import { CONFIG_FILE } from '@/lib/store-config'
import { THEME_COLOR_KEYS, sanitizeTheme, type StoreTheme, type ThemeColorKey } from '@/lib/store-theme-shared'

export { CONFIG_FILE }
export { sanitizeTheme, themePreviewPayload, type StoreTheme } from '@/lib/store-theme-shared'

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isTypeAssertionExpression(e)) {
    e = e.expression
  }
  return e
}

function propertyName(p: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(p)) return null
  const n = p.name
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text
  return null
}

function findProperty(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | null {
  for (const p of obj.properties) {
    if (propertyName(p) === name) return p as ts.PropertyAssignment
  }
  return null
}

const q = (s: string) => JSON.stringify(s)

interface DesignNodes {
  sf: ts.SourceFile
  colors: ts.PropertyAssignment
  fonts: ts.PropertyAssignment
  radius: ts.PropertyAssignment
}

/** Locates config.design.{colors,fonts,radius} in the source (only the design object has to be a plain literal). */
function findDesign(configSource: string): DesignNodes | null {
  const sf = ts.createSourceFile('config.ts', configSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let configObject: ts.ObjectLiteralExpression | null = null
  const visit = (node: ts.Node) => {
    if (configObject) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'config' && node.initializer) {
      const init = unwrap(node.initializer)
      if (ts.isObjectLiteralExpression(init)) configObject = init
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!configObject) return null
  const design = findProperty(configObject, 'design')
  if (!design) return null
  const designObj = unwrap(design.initializer)
  if (!ts.isObjectLiteralExpression(designObj)) return null
  const colors = findProperty(designObj, 'colors')
  const fonts = findProperty(designObj, 'fonts')
  const radius = findProperty(designObj, 'radius')
  if (!colors || !fonts || !radius) return null
  return { sf, colors, fonts, radius }
}

function stringValue(expr: ts.Expression): string | null {
  const e = unwrap(expr)
  return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null
}

function stringRecord(expr: ts.Expression): Record<string, string> | null {
  const e = unwrap(expr)
  if (!ts.isObjectLiteralExpression(e)) return null
  const out: Record<string, string> = {}
  for (const p of e.properties) {
    const name = propertyName(p)
    if (!name) continue
    const v = stringValue((p as ts.PropertyAssignment).initializer)
    if (v !== null) out[name] = v
  }
  return out
}

/** The theme stored in data/config.ts, or null when design isn't a plain literal with valid values. */
export function readTheme(configSource: string): StoreTheme | null {
  const d = findDesign(configSource)
  if (!d) return null
  return sanitizeTheme({
    colors: stringRecord(d.colors.initializer) ?? undefined,
    fonts: stringRecord(d.fonts.initializer) ?? undefined,
    radius: stringValue(d.radius.initializer) ?? undefined,
  })
}

/** Multi-line object literal matching the indentation of the property it replaces. */
function objectLiteral(sf: ts.SourceFile, prop: ts.PropertyAssignment, entries: Array<[string, string]>): string {
  const { character } = sf.getLineAndCharacterOfPosition(prop.getStart(sf))
  const pad = ' '.repeat(character)
  return '{\n' + entries.map(([k, v]) => `${pad}  ${k}: ${q(v)},\n`).join('') + pad + '}'
}

/**
 * Returns data/config.ts with design.colors / design.fonts / design.radius replaced by
 * `theme`, or null when the file doesn't have that shape (the caller then tells the
 * merchant to change the theme through the chat instead).
 */
export function writeTheme(configSource: string, theme: StoreTheme): string | null {
  const d = findDesign(configSource)
  if (!d) return null
  const { sf, colors, fonts, radius } = d
  // Keep the file's own key order (smallest diff); keys it lacked go last.
  const existingOrder = Object.keys(stringRecord(colors.initializer) ?? {})
  const colorOrder = [
    ...existingOrder.filter((k): k is ThemeColorKey => (THEME_COLOR_KEYS as string[]).includes(k)),
    ...THEME_COLOR_KEYS.filter((k) => !existingOrder.includes(k)),
  ]

  const edits: Array<{ start: number; end: number; text: string }> = [
    {
      start: colors.initializer.getStart(sf),
      end: colors.initializer.getEnd(),
      text: objectLiteral(sf, colors, colorOrder.map((k) => [k, theme.colors[k]])),
    },
    {
      start: fonts.initializer.getStart(sf),
      end: fonts.initializer.getEnd(),
      text: objectLiteral(sf, fonts, [['heading', theme.fonts.heading], ['body', theme.fonts.body]]),
    },
    { start: radius.initializer.getStart(sf), end: radius.initializer.getEnd(), text: q(theme.radius) },
  ].sort((a, b) => b.start - a.start)

  let out = configSource
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)

  // The result must still parse to the same theme — anything else means the file had a
  // shape this editor doesn't understand.
  const check = readTheme(out)
  if (!check || JSON.stringify(check) !== JSON.stringify(theme)) return null
  return out
}
