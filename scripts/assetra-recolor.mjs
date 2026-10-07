// One-off codemod (applied 2026-10-07): moves the Quante app from hard-coded colours to the
// AssetraDigital app tokens (--q-*, packages/ui/styles/app-tokens.css), so the app follows the
// AssetraDigital design in both themes. Re-running it is a no-op.
//
//   node scripts/assetra-recolor.mjs [--dry]
//
// - hex and rgb(a) literals are mapped by colour family; a colour used as `color:` (text) gets
//   the family's -text variant, because text needs more contrast than a fill in the light theme
// - rgba(255,255,255,a) → rgb(var(--q-ink-rgb) / a) etc., so overlays and hairlines flip with
//   the theme; rgba(0,0,0,a) shadows and brand colours (PayPal) are left alone
// - var(--font-geist-mono) → var(--q-mono) (JetBrains Mono)
// - NOT touched: #fff / #000 / #000000 / #888888 (white text on red buttons, <input type=color>
//   fallbacks — reviewed by hand), JSX colour attributes (color= / stroke= / fill= on icons and
//   SVG: CSS variables do not work there), and storefront / preview / store-template code.

import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')

const ROOTS = [
  'app/(app)', 'app/qads', 'app/login', 'app/signup', 'app/error.tsx', 'app/not-found.tsx',
  'app/(marketing)', 'components/shell', 'components/admin', 'components/public',
  'components/SiteFooter.tsx', 'components/AnnouncementBanner.tsx',
]

const HEX = {
  // surfaces
  '#08080a': 'bg', '#070709': 'bg', '#09090c': 'bg', '#0a0a0a': 'bg', '#0a0a0e': 'bg',
  '#0d0d11': 's1', '#0c0c10': 's1', '#0c0c12': 's1', '#101014': 's1', '#101016': 's1', '#111114': 's1',
  '#121218': 's2', '#141418': 's2', '#16161c': 's2',
  '#1a1a22': 's3', '#222': 's3',
  '#363640': 'dim', '#3a3a44': 'dim', '#4a4a55': 'dim', '#444': 'dim',
  // text
  '#f4f4f6': 'fg', '#e0e0e8': 'fg',
  '#d0d0da': 'fg2', '#c8c8d0': 'fg2', '#c9c9d1': 'fg2', '#b9b9c0': 'fg2', '#c7c4d6': 'fg2', '#a8a8b3': 'fg2',
  '#8a8a93': 'fg3', '#888': 'fg3',
  '#5b5b64': 'fg4',
  // accent and status families
  '#d4ff3f': 'acc', '#e8ff6f': 'acc', '#e8ff9e': 'acc-hi', '#5d66d4': 'acc-hover',
  '#a8afff': 'acc2', '#7a82e8': 'acc2', '#22d3ee': 'acc2',
  '#3ecf8e': 'ok', '#34d399': 'ok', '#34c759': 'ok',
  '#e0a04f': 'warn', '#fbbf24': 'warn', '#fbbf3b': 'warn', '#f59e0b': 'warn',
  '#f87171': 'danger', '#e0564f': 'danger', '#d6534a': 'danger', '#ff5c5c': 'danger', '#ff8080': 'danger',
}
const TEXT_VARIANT = new Set(['acc', 'acc2', 'ok', 'warn', 'danger'])
const DARK_ON_LIGHT = new Set(['bg']) // a near-black used as text = text on a light / accent fill

const RGB = {
  '255,255,255': 'ink', '8,8,10': 'bg',
  '212,255,63': 'acc', '165,171,240': 'acc2', '99,102,241': 'acc2', '34,211,238': 'acc2',
  '62,207,142': 'ok', '52,211,153': 'ok', '52,199,89': 'ok',
  '224,160,79': 'warn', '255,193,7': 'warn', '245,158,11': 'warn', '251,189,59': 'warn', '251,191,36': 'warn',
  '224,86,79': 'danger', '248,113,113': 'danger', '220,60,60': 'danger',
}

// The CSS property a literal belongs to: the last `key:` / `key =` before it on the same line.
function propertyAt(line, col) {
  const prefix = line.slice(0, col)
  let key = ''
  for (const m of prefix.matchAll(/([A-Za-z][A-Za-z0-9-]*)\s*(?::(?!:)|=(?![=>]))/g)) key = m[1]
  return key
}
const isTextProp = (k) => /^(color|caretColor|caret-color|textDecorationColor)$/.test(k)

// JSX colour attributes (icons, SVG) must keep real colours.
const inJsxColorAttr = (line, col) => /\b(?:color|stroke|fill|stopColor|floodColor)=\s*\{?[^{}]*$/.test(line.slice(0, col))

function recolorLine(line, stats) {
  let out = ''
  let last = 0
  const re = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/g
  for (const m of line.matchAll(re)) {
    const col = m.index
    let rep = null
    if (!inJsxColorAttr(line, col)) {
      if (m[0][0] === '#') {
        const fam = HEX[m[0].toLowerCase()]
        if (fam) {
          const text = isTextProp(propertyAt(line, col))
          rep = text && DARK_ON_LIGHT.has(fam) ? 'var(--q-acc-ink)'
            : text && TEXT_VARIANT.has(fam) ? `var(--q-${fam}-text)`
              : `var(--q-${fam})`
        }
      } else {
        const fam = RGB[`${m[1]},${m[2]},${m[3]}`]
        if (fam) rep = m[4] !== undefined ? `rgb(var(--q-${fam}-rgb) / ${m[4]})` : `rgb(var(--q-${fam}-rgb))`
      }
    }
    if (rep) {
      out += line.slice(last, col) + rep
      last = col + m[0].length
      stats.n++
    }
  }
  return out + line.slice(last)
}

const files = []
const walk = (p) => {
  if (!fs.existsSync(p)) return
  const st = fs.statSync(p)
  if (st.isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)))
  else if (/\.(tsx?|css)$/.test(p)) files.push(p)
}
ROOTS.forEach(walk)

let total = 0
const leftovers = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const stats = { n: 0 }
  let next = src.split('\n').map((l) => recolorLine(l, stats)).join('\n')
  const fonts = (next.match(/var\(--font-geist-mono\)/g) ?? []).length
  next = next.replace(/var\(--font-geist-mono\)/g, 'var(--q-mono)')
  if (stats.n || fonts) {
    total += stats.n
    console.log(`${f}: ${stats.n} colours, ${fonts} mono`)
    if (!DRY) fs.writeFileSync(f, next)
  }
  for (const m of next.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) {
    ;(leftovers[f] ??= []).push(m[0])
  }
}
console.log(`\n${total} colours replaced${DRY ? ' (dry run)' : ''}`)
console.log('\nLeft for manual review:')
for (const [f, list] of Object.entries(leftovers)) console.log(' ', f, [...new Set(list)].join(' '))
