// Visual editor — Framer-style design panel (2026-09-28). Pure className logic: the panel's
// controls (font size, colors, padding, layout …) become Tailwind classes on the selected
// element, per device, with Framer's breakpoint cascade:
//   - a Desktop edit flows down to Tablet / Phone unless they have their own value,
//   - a Tablet edit flows down to Phone unless it has its own value,
//   - a Phone edit changes only Phone.
// Encoded mobile-first: base = Phone, `md:` = Tablet (≥768 px), `lg:` = Desktop (≥1024 px).
// Only the edited group's classes are rewritten; everything else (other utilities, hover:,
// focus:, group-hover: … variants) is left untouched. When a larger device must keep the
// "nothing set" look while a smaller one gets a value, a reset class is written (md:p-0,
// lg:[font-size:inherit] …). No '@/…' imports: tests load this through type stripping.

export type Device = 'desktop' | 'tablet' | 'phone'

/**
 * Preview widths (px) for the device switch. Desktop uses the available width, kept
 * between 1024 (so `lg:` applies) and 1279 (so `xl:` doesn't); 1200 when it has to scale.
 */
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1200, tablet: 820, phone: 390 }

export type StyleGroup =
  | 'fontSize' | 'fontWeight' | 'fontFamily' | 'lineHeight' | 'letterSpacing' | 'textAlign'
  | 'textColor' | 'fontStyle' | 'textTransform' | 'textDecoration'
  | 'bgColor' | 'opacity'
  | 'padding' | 'margin' | 'gap'
  | 'display' | 'flexDirection' | 'flexWrap' | 'justify' | 'align' | 'gridCols'
  | 'width' | 'maxWidth' | 'height' | 'objectFit'
  | 'radius' | 'borderWidth' | 'borderColor' | 'shadow'

type Level = '' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
const RESPONSIVE = new Set(['sm', 'md', 'lg', 'xl', '2xl'])
const DEVICE_LEVELS: Record<Device, Level[]> = {
  phone: [''],
  tablet: ['', 'sm', 'md'],
  desktop: ['', 'sm', 'md', 'lg'],
}

/** Splits `md:hover:bg-[#fff]` into ['md', 'hover', 'bg-[#fff]'] (colons inside [] / () kept). */
function splitVariants(cls: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of cls) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ':' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  return parts
}

/** level null = has a non-responsive variant (hover:, focus:, dark: …) — never touched. */
function parseClass(cls: string): { level: Level | null; core: string } {
  const parts = splitVariants(cls)
  const core = parts.pop() ?? ''
  if (parts.length === 0) return { level: '', core }
  if (parts.length === 1 && RESPONSIVE.has(parts[0])) return { level: parts[0] as Level, core }
  return { level: null, core }
}

const ARBITRARY_PROPS: Record<string, StyleGroup> = {
  'font-size': 'fontSize', 'font-weight': 'fontWeight', 'font-family': 'fontFamily',
  'line-height': 'lineHeight', 'letter-spacing': 'letterSpacing', 'text-align': 'textAlign',
  color: 'textColor', 'background-color': 'bgColor', 'border-color': 'borderColor', display: 'display',
}

/** Which panel group a utility (without variants) belongs to, or null (left alone). */
export function classifyUtility(core: string): StyleGroup | null {
  let c = core.replace(/^!/, '').replace(/!$/, '')
  const arb = c.match(/^\[([a-z-]+):/)
  if (arb) return ARBITRARY_PROPS[arb[1]] ?? null
  const neg = c.startsWith('-')
  if (neg) c = c.slice(1)
  if (/^m[xytrblse]?-/.test(c)) return 'margin'
  if (neg) return null
  if (/^p[xytrblse]?-/.test(c)) return 'padding'
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)(\/\S+)?$/.test(c)) return 'fontSize'
  if (/^text-\[(length:|clamp\(|calc\(|min\(|max\(|-?[\d.]+(px|rem|em|vw|vh|svw|%)\])/.test(c)) return 'fontSize'
  if (/^text-(left|center|right|justify|start|end)$/.test(c)) return 'textAlign'
  if (/^text-(ellipsis|clip|wrap|nowrap|balance|pretty)$/.test(c) || c.startsWith('text-shadow')) return null
  if (c.startsWith('text-')) return 'textColor'
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c) || /^font-\[\d+\]$/.test(c)) return 'fontWeight'
  if (/^font-(stretch|features)/.test(c)) return null
  if (c.startsWith('font-')) return 'fontFamily'
  if (c.startsWith('leading-')) return 'lineHeight'
  if (c.startsWith('tracking-')) return 'letterSpacing'
  if (c === 'italic' || c === 'not-italic') return 'fontStyle'
  if (/^(uppercase|lowercase|capitalize|normal-case)$/.test(c)) return 'textTransform'
  if (/^(underline|overline|line-through|no-underline)$/.test(c)) return 'textDecoration'
  if (/^bg-(fixed|local|scroll|auto|cover|contain|none|repeat|no-repeat|center|top|bottom|left|right)(-|$)/.test(c)) return null
  if (/^bg-(clip|origin|blend|linear|radial|conic|gradient)-/.test(c) || /^bg-\[(url|image|position|size|length|linear-gradient|radial-gradient|conic-gradient)[(:]/.test(c)) return null
  if (c.startsWith('bg-')) return 'bgColor'
  if (c.startsWith('opacity-')) return 'opacity'
  if (c.startsWith('gap-')) return 'gap'
  if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|flow-root|table)$/.test(c)) return 'display'
  if (/^flex-(row|col)(-reverse)?$/.test(c)) return 'flexDirection'
  if (/^flex-(wrap|nowrap|wrap-reverse)$/.test(c)) return 'flexWrap'
  if (/^justify-(start|end|center|between|around|evenly|normal|stretch|baseline)$/.test(c)) return 'justify'
  if (/^items-(start|end|center|baseline|stretch)$/.test(c)) return 'align'
  if (c.startsWith('grid-cols-')) return 'gridCols'
  if (c.startsWith('max-w-')) return 'maxWidth'
  if (c.startsWith('w-')) return 'width'
  if (c.startsWith('h-')) return 'height'
  if (/^object-(cover|contain|fill|none|scale-down)$/.test(c)) return 'objectFit'
  if (/^rounded(-|$)/.test(c)) return 'radius'
  if (/^border(-[xytrblse])?(-(\d+|\[[\d.]+px\]))?$/.test(c)) return 'borderWidth'
  if (/^border-(solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)/.test(c)) return null
  if (c.startsWith('border-')) return 'borderColor'
  if (/^shadow(-|$)/.test(c)) return 'shadow'
  return null
}

const INLINE_TAGS = new Set(['a', 'span', 'strong', 'em', 'small', 'label', 'img'])

/** Class that restores the "nothing set" look of a group at a larger breakpoint. */
function resetClasses(group: StyleGroup, tag: string): string[] {
  switch (group) {
    case 'fontSize': return ['[font-size:inherit]']
    case 'fontWeight': return ['[font-weight:inherit]']
    case 'fontFamily': return ['[font-family:inherit]']
    case 'lineHeight': return ['[line-height:inherit]']
    case 'letterSpacing': return ['[letter-spacing:inherit]']
    case 'textAlign': return ['[text-align:inherit]']
    case 'textColor': return ['text-inherit']
    case 'fontStyle': return ['not-italic']
    case 'textTransform': return ['normal-case']
    case 'textDecoration': return ['no-underline']
    case 'bgColor': return ['bg-transparent']
    case 'opacity': return ['opacity-100']
    case 'padding': return ['p-0']
    case 'margin': return ['m-0']
    case 'gap': return ['gap-0']
    case 'display': return [tag === 'li' ? '[display:list-item]' : tag === 'button' ? 'inline-block' : INLINE_TAGS.has(tag) ? 'inline' : 'block']
    case 'flexDirection': return ['flex-row']
    case 'flexWrap': return ['flex-nowrap']
    case 'justify': return ['justify-normal']
    case 'align': return ['items-stretch']
    case 'gridCols': return ['grid-cols-none']
    case 'width': return ['w-auto']
    case 'maxWidth': return ['max-w-none']
    case 'height': return ['h-auto']
    case 'objectFit': return ['object-fill']
    case 'radius': return ['rounded-none']
    case 'borderWidth': return ['border-0']
    case 'borderColor': return ['[border-color:currentColor]']
    case 'shadow': return ['shadow-none']
  }
}

interface GroupScan {
  keep: string[]
  insertAt: number
  byLevel: Map<Level, string[]>
}

function scan(className: string, group: StyleGroup): GroupScan {
  const keep: string[] = []
  const byLevel = new Map<Level, string[]>()
  let insertAt = -1
  for (const t of className.split(/\s+/).filter(Boolean)) {
    const p = parseClass(t)
    if (p.level !== null && classifyUtility(p.core) === group) {
      if (insertAt < 0) insertAt = keep.length
      const list = byLevel.get(p.level) ?? []
      list.push(p.core)
      byLevel.set(p.level, list)
    } else {
      keep.push(t)
    }
  }
  return { keep, insertAt, byLevel }
}

function effective(byLevel: Map<Level, string[]>, device: Device): string[] | null {
  const levels = DEVICE_LEVELS[device]
  for (let i = levels.length - 1; i >= 0; i--) {
    const v = byLevel.get(levels[i])
    if (v) return v
  }
  return null
}

const key = (v: string[] | null) => (v === null ? null : [...v].sort().join(' '))

/** The group's classes as each device sees them (null = nothing set). */
export function groupValues(className: string | null, group: StyleGroup): Record<Device, string[] | null> {
  const { byLevel } = scan(className ?? '', group)
  return { desktop: effective(byLevel, 'desktop'), tablet: effective(byLevel, 'tablet'), phone: effective(byLevel, 'phone') }
}

export interface StyleEdit {
  group: StyleGroup
  /** New classes for the device (unprefixed), or null / [] to clear it there. */
  value: string[] | null
}

function applyOne(className: string, edit: StyleEdit, device: Device, tag: string): string {
  const { keep, insertAt, byLevel } = scan(className, edit.group)
  const P = effective(byLevel, 'phone')
  const T = effective(byLevel, 'tablet')
  const D = effective(byLevel, 'desktop')
  const nv = edit.value && edit.value.length > 0 ? edit.value : null
  let P2 = P
  let T2 = T
  let D2 = D
  if (device === 'desktop') {
    D2 = nv
    if (key(T) === key(D)) T2 = nv
    if (key(T2) !== key(T) && key(P) === key(T)) P2 = T2
  } else if (device === 'tablet') {
    T2 = nv
    if (key(P) === key(T)) P2 = nv
  } else {
    P2 = nv
  }

  const reset = resetClasses(edit.group, tag)
  const out: string[] = []
  const put = (prefix: string, v: string[] | null) => { for (const c of v ?? reset) out.push(prefix + c) }
  if (P2) put('', P2)
  if (key(T2) !== key(P2)) put('md:', T2)
  if (key(D2) !== key(T2)) put('lg:', D2)
  // xl / 2xl only look beyond Desktop: a Desktop edit replaces them, Tablet / Phone edits keep them.
  if (device !== 'desktop') {
    for (const lv of ['xl', '2xl'] as const) for (const c of byLevel.get(lv) ?? []) out.push(`${lv}:${c}`)
  }
  const at = insertAt < 0 ? keep.length : insertAt
  return [...keep.slice(0, at), ...out, ...keep.slice(at)].join(' ')
}

/** Applies panel edits for one device; returns the new className (normalized spacing). */
export function applyStyleEdits(className: string | null, edits: StyleEdit[], device: Device, tag: string): string {
  let cls = (className ?? '').split(/\s+/).filter(Boolean).join(' ')
  for (const e of edits) cls = applyOne(cls, e, device, tag)
  return cls
}

// ─── Value → class helpers used by the panel ────────────────────────────────

export const THEME_COLOR_TOKENS = ['bg', 'surface', 'text', 'muted', 'accent', 'accent-text', 'border'] as const
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number]

const num = (n: number) => String(Math.round(n * 100) / 100)

/** `text-accent` / `bg-[#ff0000]` — token or 6-digit hex. null for anything else. */
export function colorClass(prefix: 'text' | 'bg' | 'border', color: string): string | null {
  if ((THEME_COLOR_TOKENS as readonly string[]).includes(color)) return `${prefix}-${color}`
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${prefix}-[${color.toLowerCase()}]`
  return null
}

/** Theme token of a color class (`text-accent` → 'accent'), hex of `bg-[#abc123]`, else null. */
export function colorOfClass(prefix: 'text' | 'bg' | 'border', classes: string[] | null): string | null {
  const c = classes?.[classes.length - 1]
  if (!c) return null
  const m = c.match(new RegExp(`^${prefix}-(.+)$`))
  if (!m) return null
  if ((THEME_COLOR_TOKENS as readonly string[]).includes(m[1])) return m[1]
  const hex = m[1].match(/^\[(#[0-9a-fA-F]{6})\]$/)
  return hex ? hex[1].toLowerCase() : null
}

export const FONT_WEIGHTS: Array<[number, string]> = [
  [100, 'thin'], [200, 'extralight'], [300, 'light'], [400, 'normal'], [500, 'medium'],
  [600, 'semibold'], [700, 'bold'], [800, 'extrabold'], [900, 'black'],
]
export function fontWeightClass(weight: number): string {
  const best = FONT_WEIGHTS.reduce((a, b) => (Math.abs(b[0] - weight) < Math.abs(a[0] - weight) ? b : a))
  return `font-${best[1]}`
}

/** `text-[18px]`, `gap-[24px]`, `rounded-[12px]` …; 0 → `-0` where Tailwind has it. */
export function pxClass(prefix: string, n: number): string {
  if (n === 0 && ['gap', 'p', 'm', 'rounded', 'border'].includes(prefix)) return prefix === 'rounded' ? 'rounded-none' : prefix === 'border' ? 'border-0' : `${prefix}-0`
  return `${prefix}-[${num(n)}px]`
}

export interface Box { t: number | 'auto'; r: number | 'auto'; b: number | 'auto'; l: number | 'auto' }

/** Padding / margin classes, compressed: p-[8px] · px-[16px] py-[8px] · pt-… pr-… pb-… pl-…. */
export function boxClasses(prefix: 'p' | 'm', box: Box): string[] {
  const one = (side: string, v: number | 'auto') => {
    if (v === 'auto') return `${prefix}${side}-auto`
    if (v === 0) return `${prefix}${side}-0`
    if (v < 0) return prefix === 'm' ? `-${prefix}${side}-[${num(-v)}px]` : `${prefix}${side}-0`
    return `${prefix}${side}-[${num(v)}px]`
  }
  const { t, r, b, l } = box
  if (t === r && r === b && b === l) return [one('', t)]
  if (t === b && l === r) return [one('x', l), one('y', t)]
  return [one('t', t), one('r', r), one('b', b), one('l', l)]
}
