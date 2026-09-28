'use client'

// Visual editor — Framer-style design panel (2026-09-28). Every control writes Tailwind
// classes on the selected element through lib/editor/styles.ts (per device, Framer's
// breakpoint cascade) and previews instantly in the store (bridge inline styles) until the
// saved classes arrive by hot reload. Numbers come from the element's computed styles, so
// the panel always shows what the shopper sees on the chosen device.

import { useEffect, useRef, useState } from 'react'
import {
  TextAlignStart, TextAlignCenter, TextAlignEnd, TextAlignJustify, Italic, CaseUpper, Underline,
  ChevronDown, ChevronRight, Rows3, Columns3, LayoutGrid, Square, Eye, EyeOff, Link2, Unlink,
} from 'lucide-react'
import type { EditorNode } from '@/lib/editor/oid'
import {
  groupValues, colorClass, colorOfClass, fontWeightClass, pxClass, boxClasses, FONT_WEIGHTS, THEME_COLOR_TOKENS,
  type Box, type Device, type StyleEdit, type StyleGroup,
} from '@/lib/editor/styles'

export type Styles = Record<string, string>
type Css = Record<string, string>

interface Props {
  node: EditorNode
  styles: Styles | null
  theme: Styles
  /** Changes with every styles report — resets the controls' live (dragged) values. */
  stamp: number
  device: Device
  onPreview: (css: Css) => void
  onCommit: (edits: StyleEdit[], css?: Css) => void
}

const DEVICE_LABEL: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' }
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'Link', 'button', 'li', 'label', 'strong', 'em', 'small', 'blockquote', 'figcaption'])
const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'ul', 'ol', 'li', 'figure', 'form', 'a', 'Link', 'button'])
const SHADOWS: Record<string, string> = {
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
}

const ui = {
  text: '#f4f4f6', muted: '#8a8a93', faint: '#5b5b64', accent: '#D4FF3F',
  field: '#08080a', border: 'rgba(255,255,255,.1)', hover: 'rgba(255,255,255,.06)',
}
const fieldBox: React.CSSProperties = { display: 'flex', alignItems: 'center', height: 26, background: ui.field, border: `1px solid ${ui.border}`, borderRadius: 6, minWidth: 0 }
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, width: '100%', background: 'transparent', border: 'none', outline: 'none', color: ui.text, fontSize: 11, fontFamily: 'var(--font-geist-mono)', padding: '0 6px 0 0' }

const px = (s?: string) => { const n = parseFloat(s ?? ''); return Number.isFinite(n) ? n : null }
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const key = (v: string[] | null) => (v === null ? null : [...v].sort().join(' '))

function normHex(c?: string): string | null {
  if (!c) return null
  const v = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((x) => x + x).join('')
  const m = v.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\)$/)
  if (!m) return null
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return 'transparent'
  return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('')
}

const firstFont = (f?: string) => (f ?? '').split(',')[0].replace(/["']/g, '').trim().toLowerCase()

// ─── Primitives ──────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '10px 0 4px' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: ui.text, fontSize: 11, fontWeight: 600, marginBottom: open ? 8 : 6 }}>
        {open ? <ChevronDown size={11} color={ui.muted} /> : <ChevronRight size={11} color={ui.muted} />} {title}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>}
    </div>
  )
}

function Row({ label, children, override, device }: { label: string; children: React.ReactNode; override?: () => void; device: Device }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '62px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: override ? ui.accent : ui.muted, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        {label}
        {override && (
          <button onClick={override} title={`Own value on ${DEVICE_LABEL[device]} — click to use the larger screen's value`} style={{ width: 7, height: 7, borderRadius: 4, background: ui.accent, border: 'none', padding: 0, cursor: 'pointer' }} />
        )}
      </span>
      <div style={{ minWidth: 0, display: 'flex', gap: 5, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label?: string; icon?: React.ElementType; title?: string }>
  value: T | null
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', flex: 1, height: 26, background: ui.field, border: `1px solid ${ui.border}`, borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} title={o.title ?? o.label} onClick={() => onChange(o.value)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, color: on ? ui.text : ui.muted, background: on ? 'rgba(255,255,255,.12)' : 'transparent', padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {o.icon ? <o.icon size={12} /> : o.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ on, onClick, icon: Icon, title }: { on: boolean; onClick: () => void; icon: React.ElementType; title: string }) {
  return (
    <button title={title} onClick={onClick} style={{ width: 28, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? 'rgba(212,255,63,.45)' : ui.border}`, background: on ? 'rgba(212,255,63,.12)' : ui.field, color: on ? ui.accent : ui.muted }}>
      <Icon size={12} />
    </button>
  )
}

/**
 * Number input with Framer-style scrubbing: drag the label left / right (Shift = ×10),
 * type a value (Enter / blur commits) or use ↑ ↓. Dragging previews live, release commits.
 */
function NumberField({ label, value, unit, step = 1, min, max, stamp, placeholder, allowEmpty, onPreview, onCommit }: {
  label?: string
  value: number | null
  unit?: string
  step?: number
  min?: number
  max?: number
  stamp: number
  placeholder?: string
  allowEmpty?: boolean
  onPreview: (v: number) => void
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // A dragged / typed value, valid until the next styles report (stamp) shows the saved result.
  const [liveAt, setLiveAt] = useState<{ v: number; stamp: number } | null>(null)
  const live = liveAt && liveAt.stamp === stamp ? liveAt.v : null
  const setLive = (v: number) => setLiveAt({ v, stamp })
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const decimals = step < 1 ? (step < 0.1 ? 3 : 2) : 0
  const clamp = (v: number) => round(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)), decimals)
  const shown = live ?? value
  const fmt = (v: number | null) => (v === null ? '' : String(round(v, decimals)))

  const commitDraft = () => {
    if (draft === null) return
    const n = parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(n)) { const v = clamp(n); setLive(v); onPreview(v); onCommit(v) }
    else if (draft.trim() === '' && allowEmpty) onCommit(null)
  }
  const nudge = (dir: number, big: boolean) => {
    const base = draft !== null && Number.isFinite(parseFloat(draft)) ? parseFloat(draft) : (shown ?? 0)
    const v = clamp(base + dir * step * (big ? 10 : 1))
    setDraft(null)
    setLive(v)
    onPreview(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onCommit(v), 450)
  }

  return (
    <div style={{ ...fieldBox, flex: 1 }}>
      <span
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, start: shown ?? 0, moved: false } }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (Math.abs(dx) < 2 && !d.moved) return
          d.moved = true
          const v = clamp(d.start + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1))
          setLive(v)
          onPreview(v)
        }}
        onPointerUp={() => { const d = drag.current; drag.current = null; if (d?.moved && live !== null) onCommit(live) }}
        title="Drag to change"
        style={{ cursor: 'ew-resize', userSelect: 'none', padding: '0 6px', fontSize: 10, color: ui.faint, fontFamily: 'var(--font-geist-mono)', minWidth: label ? 18 : 8, textAlign: 'center' }}
      >
        {label ?? '↔'}
      </span>
      <input
        value={draft ?? fmt(shown)}
        placeholder={placeholder ?? '–'}
        onFocus={(e) => { setDraft(fmt(shown)); e.currentTarget.select() }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitDraft(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey) }
        }}
        style={inputStyle}
      />
      {unit && <span style={{ fontSize: 10, color: ui.faint, paddingRight: 6 }}>{unit}</span>}
    </div>
  )
}

/** Theme swatches + custom color (+ none). Theme tokens keep the store on-brand. */
function ColorField({ prefix, classColor, computed, theme, allowNone, onPreview, onPick }: {
  prefix: 'text' | 'bg' | 'border'
  classColor: string | null
  computed?: string
  theme: Styles
  allowNone?: boolean
  onPreview: (css: Css) => void
  onPick: (color: string | null, css?: Css) => void
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<string | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const prop = prefix === 'text' ? 'color' : prefix === 'bg' ? 'background-color' : 'border-color'
  const hex = normHex(computed)
  const tokenHex = (t: string) => normHex(theme[`--color-${t}`])
  const token = classColor && (THEME_COLOR_TOKENS as readonly string[]).includes(classColor)
    ? classColor
    : THEME_COLOR_TOKENS.find((t) => hex && hex !== 'transparent' && tokenHex(t) === hex) ?? null
  const name = token ?? (hex === 'transparent' || !computed ? 'None' : hex ?? 'Custom')

  const flush = () => {
    window.clearTimeout(timer.current)
    if (pending.current) { const c = pending.current; pending.current = null; onPick(c, { [prop]: c }) }
  }
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...fieldBox, width: '100%', cursor: 'pointer', gap: 6, padding: '0 6px' }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: '1px solid rgba(255,255,255,.2)', background: hex === 'transparent' ? 'repeating-conic-gradient(#444 0 25%, #222 0 50%) 0 0 / 8px 8px' : computed || 'transparent' }} />
        <span style={{ fontSize: 11, color: ui.text, fontFamily: token ? 'inherit' : 'var(--font-geist-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, padding: 8, background: '#101014', border: `1px solid ${ui.border}`, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
            {THEME_COLOR_TOKENS.map((t) => (
              <button key={t} title={t} onClick={() => onPick(t, { [prop]: `var(--color-${t})` })} style={{ aspectRatio: '1', borderRadius: 5, cursor: 'pointer', background: theme[`--color-${t}`] || '#888', border: token === t ? `2px solid ${ui.accent}` : '1px solid rgba(255,255,255,.2)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={hex && hex !== 'transparent' ? hex : '#000000'}
              onChange={(e) => {
                const c = e.target.value
                onPreview({ [prop]: c })
                pending.current = c
                window.clearTimeout(timer.current)
                timer.current = window.setTimeout(flush, 500)
              }}
              onBlur={flush}
              style={{ width: 30, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 10, color: ui.faint, flex: 1 }}>Custom color</span>
            {allowNone && (
              <button onClick={() => onPick(null, prefix === 'bg' ? { [prop]: 'transparent' } : undefined)} style={{ fontSize: 10, color: ui.muted, background: 'none', border: `1px solid ${ui.border}`, borderRadius: 5, padding: '2px 6px', cursor: 'pointer' }}>None</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Padding / margin: one linked value or four sides (T R B L). */
function BoxField({ values, stamp, allowNegative, autoX, onPreview, onCommit }: {
  values: { t: number | null; r: number | null; b: number | null; l: number | null }
  stamp: number
  allowNegative?: boolean
  /** Left / right are `auto` (centered) — shown and kept as auto. */
  autoX?: boolean
  onPreview: (box: Box) => void
  onCommit: (box: Box) => void
}) {
  const same = values.t === values.r && values.r === values.b && values.b === values.l
  const [linked, setLinked] = useState(same && !autoX)
  const cur: Box = { t: values.t ?? 0, r: autoX ? 'auto' : values.r ?? 0, b: values.b ?? 0, l: autoX ? 'auto' : values.l ?? 0 }
  const min = allowNegative ? -500 : 0
  if (linked) {
    return (
      <div style={{ display: 'flex', gap: 5, flex: 1 }}>
        <NumberField value={values.t} unit="px" min={min} max={500} stamp={stamp}
          onPreview={(v) => onPreview({ t: v, r: v, b: v, l: v })} onCommit={(v) => onCommit({ t: v ?? 0, r: v ?? 0, b: v ?? 0, l: v ?? 0 })} />
        <Toggle on={false} icon={Unlink} title="Set each side" onClick={() => setLinked(false)} />
      </div>
    )
  }
  const side = (k: keyof Box, label: string) => (
    cur[k] === 'auto'
      ? <div style={{ ...fieldBox, flex: 1, padding: '0 6px', fontSize: 10, color: ui.faint }}>{label} auto</div>
      : <NumberField label={label} value={values[k]} min={min} max={500} stamp={stamp}
          onPreview={(v) => onPreview({ ...cur, [k]: v })} onCommit={(v) => onCommit({ ...cur, [k]: v ?? 0 })} />
  )
  return (
    <div style={{ display: 'flex', gap: 5, flex: 1, alignItems: 'flex-start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1 }}>
        {side('t', 'T')}{side('r', 'R')}{side('b', 'B')}{side('l', 'L')}
      </div>
      {!autoX && <Toggle on icon={Link2} title="Same on all sides" onClick={() => setLinked(true)} />}
    </div>
  )
}

const boxCss = (prop: 'padding' | 'margin', b: Box): Css => ({
  [`${prop}-top`]: b.t === 'auto' ? 'auto' : `${b.t}px`,
  [`${prop}-right`]: b.r === 'auto' ? 'auto' : `${b.r}px`,
  [`${prop}-bottom`]: b.b === 'auto' ? 'auto' : `${b.b}px`,
  [`${prop}-left`]: b.l === 'auto' ? 'auto' : `${b.l}px`,
})

// ─── Panel ───────────────────────────────────────────────────────────────────

export function DesignPanel({ node, styles, theme, stamp, device, onPreview, onCommit }: Props) {
  if (node.className === null) {
    return <p style={{ fontSize: 11, color: ui.faint, margin: 0, lineHeight: 1.5 }}>This element builds its classes in code — change its look in Chat.</p>
  }
  const s: Styles = styles ?? {}
  const className = node.className
  const gv = (g: StyleGroup) => groupValues(className, g)
  const cur = (g: StyleGroup) => gv(g)[device]
  const set = (group: StyleGroup, value: string[] | null, css?: Css) => onCommit([{ group, value }], css)
  const override = (g: StyleGroup): (() => void) | undefined => {
    if (device === 'desktop') return undefined
    const v = gv(g)
    const larger = device === 'phone' ? v.tablet : v.desktop
    if (v[device] === null || key(v[device]) === key(larger)) return undefined
    return () => onCommit([{ group: g, value: larger }])
  }
  const R = (label: string, group: StyleGroup | null, children: React.ReactNode) => (
    <Row label={label} device={device} override={group ? override(group) : undefined}>{children}</Row>
  )

  const isImg = node.tag === 'img' || node.tag === 'Image'
  const isText = !isImg && (node.text !== null || TEXT_TAGS.has(node.tag))
  const display = s.display ?? ''
  const isFlex = display.includes('flex')
  const isGrid = display.includes('grid')
  const isContainer = !isImg && (CONTAINER_TAGS.has(node.tag) || isFlex || isGrid)

  // Visibility per device
  const dispV = gv('display')
  const hiddenHere = (dispV[device] ?? []).includes('hidden') || display === 'none'
  const toggleHidden = () => {
    if (!hiddenHere) { set('display', ['hidden'], { display: 'none' }); return }
    const visible = (v: string[] | null) => (v && !v.includes('hidden') ? v : null)
    const restore = device === 'phone' ? visible(dispV.tablet) ?? visible(dispV.desktop) : device === 'tablet' ? visible(dispV.desktop) : null
    set('display', restore)
  }

  // Typography
  const fs = px(s.fontSize)
  const lh = s.lineHeight === 'normal' ? null : px(s.lineHeight) !== null && fs ? round(px(s.lineHeight)! / fs) : null
  const ls = s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing) !== null && fs ? round(px(s.letterSpacing)! / fs, 3) : null
  const famCls = cur('fontFamily')?.[0]
  const fam = famCls === 'font-heading' ? 'heading' : famCls === 'font-body' ? 'body'
    : firstFont(s.fontFamily) && firstFont(s.fontFamily) === firstFont(theme['--font-heading']) ? 'heading'
      : firstFont(s.fontFamily) && firstFont(s.fontFamily) === firstFont(theme['--font-body']) ? 'body' : null
  const weight = parseInt(s.fontWeight ?? '400', 10) || 400
  const align = ({ start: 'left', left: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' } as Record<string, string>)[s.textAlign ?? ''] ?? null
  const italic = s.fontStyle === 'italic'
  const upper = s.textTransform === 'uppercase'
  const underline = (s.textDecorationLine ?? '').includes('underline')
  const flip = (group: StyleGroup, on: boolean, onClass: string, offClass: string, css: Css) => {
    const own = (cur(group) ?? []).includes(onClass)
    set(group, on ? (own ? null : [offClass]) : [onClass], css)
  }

  // Layout
  const dir = (s.flexDirection ?? '').startsWith('column') ? 'col' : 'row'
  const layout = isGrid ? 'grid' : isFlex ? dir : 'block'
  const inline = display.startsWith('inline')
  const alignItems = ({ normal: 'stretch', stretch: 'stretch', 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', baseline: 'start' } as Record<string, string>)[s.alignItems ?? ''] ?? null
  const justify = ({ normal: 'start', 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly' } as Record<string, string>)[s.justifyContent ?? ''] ?? 'start'
  const gap = s.rowGap === 'normal' ? 0 : px(s.rowGap)
  const cols = s.gridTemplateColumns && s.gridTemplateColumns !== 'none' ? s.gridTemplateColumns.trim().split(/\s+/).length : 1

  // Size
  const wCls = cur('width')?.[0]
  const wMode = wCls === 'w-full' ? 'fill' : wCls === 'w-fit' ? 'fit' : wCls && wCls !== 'w-auto' ? 'fixed' : 'auto'
  const hCls = cur('height')?.[0]
  const hMode = hCls === 'h-full' ? 'fill' : hCls && hCls !== 'h-auto' ? 'fixed' : 'auto'

  // Spacing
  const mCls = cur('margin') ?? []
  const centered = mCls.includes('mx-auto') || (mCls.includes('ml-auto') && mCls.includes('mr-auto'))

  // Border & radius
  const rCls = cur('radius')?.[0]
  const radiusMode = rCls === 'rounded-store' ? 'theme' : rCls === 'rounded-full' ? 'full' : rCls === 'rounded-none' || (!rCls && !px(s.borderTopLeftRadius)) ? 'none' : null
  const shCls = cur('shadow')?.[0]
  const shadow = !shCls || shCls === 'shadow-none' || s.boxShadow === 'none' ? 'none' : (shCls.replace(/^shadow-?/, '') || 'sm')

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 }}>
        <span style={{ fontSize: 10, color: ui.faint }}>Editing <b style={{ color: ui.muted }}>{DEVICE_LABEL[device]}</b>{device !== 'desktop' ? ' — overrides larger screens' : ' — flows to Tablet & Phone'}</span>
        <Toggle on={hiddenHere} icon={hiddenHere ? EyeOff : Eye} title={hiddenHere ? `Hidden on ${DEVICE_LABEL[device]} — click to show` : `Hide on ${DEVICE_LABEL[device]}`} onClick={toggleHidden} />
      </div>

      {isText && (
        <Section title="Typography">
          {R('Font', 'fontFamily', (
            <Segmented value={fam} onChange={(v) => set('fontFamily', [`font-${v}`], { 'font-family': `var(--font-${v})` })}
              options={[{ value: 'heading', label: 'Heading' }, { value: 'body', label: 'Body' }]} />
          ))}
          {R('Weight', 'fontWeight', (
            <select value={FONT_WEIGHTS.reduce((a, b) => (Math.abs(b[0] - weight) < Math.abs(a[0] - weight) ? b : a))[0]}
              onChange={(e) => { const w = Number(e.target.value); set('fontWeight', [fontWeightClass(w)], { 'font-weight': String(w) }) }}
              style={{ ...fieldBox, flex: 1, color: ui.text, fontSize: 11, padding: '0 6px', cursor: 'pointer' }}>
              {FONT_WEIGHTS.map(([w, n]) => <option key={w} value={w}>{w} · {n}</option>)}
            </select>
          ))}
          {R('Size', 'fontSize', (
            <NumberField value={fs} unit="px" min={6} max={400} stamp={stamp}
              onPreview={(v) => onPreview({ 'font-size': `${v}px` })}
              onCommit={(v) => v !== null && set('fontSize', [pxClass('text', v)], { 'font-size': `${v}px` })} />
          ))}
          {R('Line', 'lineHeight', (
            <>
              <NumberField value={lh} step={0.05} min={0.5} max={4} stamp={stamp} placeholder="auto"
                onPreview={(v) => onPreview({ 'line-height': String(v) })}
                onCommit={(v) => v !== null && set('lineHeight', [`leading-[${v}]`], { 'line-height': String(v) })} />
              <NumberField label="ls" value={ls} unit="em" step={0.01} min={-0.2} max={1} stamp={stamp}
                onPreview={(v) => onPreview({ 'letter-spacing': `${v}em` })}
                onCommit={(v) => v !== null && set('letterSpacing', [`tracking-[${v}em]`], { 'letter-spacing': `${v}em` })} />
            </>
          ))}
          {R('Align', 'textAlign', (
            <Segmented value={align} onChange={(v) => set('textAlign', [`text-${v}`], { 'text-align': v })} options={[
              { value: 'left', icon: TextAlignStart, title: 'Left' }, { value: 'center', icon: TextAlignCenter, title: 'Center' },
              { value: 'right', icon: TextAlignEnd, title: 'Right' }, { value: 'justify', icon: TextAlignJustify, title: 'Justify' },
            ]} />
          ))}
          {R('Color', 'textColor', (
            <ColorField prefix="text" classColor={colorOfClass('text', cur('textColor'))} computed={s.color} theme={theme}
              onPreview={onPreview} onPick={(c, css) => set('textColor', c ? [colorClass('text', c)!] : null, css)} />
          ))}
          <Row label="Style" device={device}>
            <Toggle on={italic} icon={Italic} title="Italic" onClick={() => flip('fontStyle', italic, 'italic', 'not-italic', { 'font-style': italic ? 'normal' : 'italic' })} />
            <Toggle on={upper} icon={CaseUpper} title="Uppercase" onClick={() => flip('textTransform', upper, 'uppercase', 'normal-case', { 'text-transform': upper ? 'none' : 'uppercase' })} />
            <Toggle on={underline} icon={Underline} title="Underline" onClick={() => flip('textDecoration', underline, 'underline', 'no-underline', { 'text-decoration-line': underline ? 'none' : 'underline' })} />
          </Row>
        </Section>
      )}

      <Section title="Fill">
        {R('Background', 'bgColor', (
          <ColorField prefix="bg" allowNone classColor={colorOfClass('bg', cur('bgColor'))} computed={s.backgroundColor} theme={theme}
            onPreview={onPreview} onPick={(c, css) => set('bgColor', c ? [colorClass('bg', c)!] : null, css)} />
        ))}
        {R('Opacity', 'opacity', (
          <NumberField value={s.opacity ? Math.round(parseFloat(s.opacity) * 100) : 100} unit="%" min={0} max={100} stamp={stamp}
            onPreview={(v) => onPreview({ opacity: String(v / 100) })}
            onCommit={(v) => v !== null && set('opacity', v === 100 ? null : [`opacity-${Math.round(v)}`], { opacity: String(v / 100) })} />
        ))}
      </Section>

      {isContainer && (
        <Section title="Layout">
          {R('Type', 'display', (
            <Segmented value={layout} onChange={(v) => {
              if (v === 'block') onCommit([{ group: 'display', value: null }], { display: inline ? 'inline-block' : 'block' })
              else if (v === 'grid') onCommit([{ group: 'display', value: [inline ? 'inline-grid' : 'grid'] }, { group: 'gridCols', value: cur('gridCols') ?? ['grid-cols-2'] }], { display: 'grid', 'grid-template-columns': cur('gridCols') ? '' : 'repeat(2, minmax(0, 1fr))' })
              else onCommit([{ group: 'display', value: [inline ? 'inline-flex' : 'flex'] }, { group: 'flexDirection', value: v === 'col' ? ['flex-col'] : null }], { display: 'flex', 'flex-direction': v === 'col' ? 'column' : 'row' })
            }} options={[
              { value: 'block', icon: Square, title: 'Block (stacked by the page flow)' },
              { value: 'row', icon: Columns3, title: 'Stack — horizontal' },
              { value: 'col', icon: Rows3, title: 'Stack — vertical' },
              { value: 'grid', icon: LayoutGrid, title: 'Grid' },
            ]} />
          ))}
          {isFlex && (
            <>
              {R('Align', 'align', (
                <Segmented value={alignItems} onChange={(v) => set('align', [`items-${v}`], { 'align-items': v === 'stretch' ? 'stretch' : v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : 'center' })} options={
                  dir === 'row'
                    ? [{ value: 'start', label: 'Top' }, { value: 'center', label: 'Mid' }, { value: 'end', label: 'Bottom' }, { value: 'stretch', label: 'Fill' }]
                    : [{ value: 'start', label: 'Left' }, { value: 'center', label: 'Mid' }, { value: 'end', label: 'Right' }, { value: 'stretch', label: 'Fill' }]
                } />
              ))}
              {R('Distribute', 'justify', (
                <select value={justify} onChange={(e) => {
                  const v = e.target.value
                  const css = ({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' } as Record<string, string>)[v]
                  set('justify', [`justify-${v}`], { 'justify-content': css })
                }} style={{ ...fieldBox, flex: 1, color: ui.text, fontSize: 11, padding: '0 6px', cursor: 'pointer' }}>
                  <option value="start">Start</option><option value="center">Center</option><option value="end">End</option>
                  <option value="between">Space between</option><option value="around">Space around</option><option value="evenly">Space evenly</option>
                </select>
              ))}
              {R('Wrap', 'flexWrap', (
                <Segmented value={s.flexWrap === 'wrap' ? 'wrap' : 'nowrap'} onChange={(v) => set('flexWrap', v === 'wrap' ? ['flex-wrap'] : null, { 'flex-wrap': v })}
                  options={[{ value: 'nowrap', label: 'No' }, { value: 'wrap', label: 'Yes' }]} />
              ))}
            </>
          )}
          {isGrid && R('Columns', 'gridCols', (
            <NumberField value={cols} min={1} max={12} stamp={stamp}
              onPreview={(v) => onPreview({ 'grid-template-columns': `repeat(${v}, minmax(0, 1fr))` })}
              onCommit={(v) => v !== null && set('gridCols', [`grid-cols-${Math.round(v)}`], { 'grid-template-columns': `repeat(${Math.round(v)}, minmax(0, 1fr))` })} />
          ))}
          {(isFlex || isGrid) && R('Gap', 'gap', (
            <NumberField value={gap} unit="px" min={0} max={400} stamp={stamp}
              onPreview={(v) => onPreview({ gap: `${v}px` })}
              onCommit={(v) => v !== null && set('gap', [pxClass('gap', v)], { gap: `${v}px` })} />
          ))}
        </Section>
      )}

      <Section title="Size">
        {R('Width', 'width', (
          <Segmented value={wMode} onChange={(v) => {
            if (v === 'auto') set('width', null)
            else if (v === 'fill') set('width', ['w-full'], { width: '100%' })
            else if (v === 'fit') set('width', ['w-fit'], { width: 'fit-content' })
            else set('width', [pxClass('w', Math.round(px(s.width) ?? 200))])
          }} options={[{ value: 'auto', label: 'Auto' }, { value: 'fill', label: 'Fill' }, { value: 'fit', label: 'Fit' }, { value: 'fixed', label: 'Fixed' }]} />
        ))}
        <Row label="" device={device}>
          <NumberField label="W" value={px(s.width) !== null ? Math.round(px(s.width)!) : null} unit="px" min={0} max={4000} stamp={stamp}
            onPreview={(v) => onPreview({ width: `${v}px` })}
            onCommit={(v) => v !== null && set('width', [pxClass('w', v)], { width: `${v}px` })} />
          <NumberField label="Max" value={s.maxWidth && s.maxWidth !== 'none' ? px(s.maxWidth) : null} unit="px" min={0} max={4000} stamp={stamp} placeholder="none" allowEmpty
            onPreview={(v) => onPreview({ 'max-width': `${v}px` })}
            onCommit={(v) => set('maxWidth', v === null ? null : [pxClass('max-w', v)], v === null ? undefined : { 'max-width': `${v}px` })} />
        </Row>
        {R('Height', 'height', (
          <>
            <Segmented value={hMode} onChange={(v) => {
              if (v === 'auto') set('height', null, { height: 'auto' })
              else if (v === 'fill') set('height', ['h-full'], { height: '100%' })
              else set('height', [pxClass('h', Math.round(px(s.height) ?? 100))])
            }} options={[{ value: 'auto', label: 'Auto' }, { value: 'fill', label: 'Fill' }, { value: 'fixed', label: 'Fixed' }]} />
            <NumberField label="H" value={px(s.height) !== null ? Math.round(px(s.height)!) : null} min={0} max={4000} stamp={stamp}
              onPreview={(v) => onPreview({ height: `${v}px` })}
              onCommit={(v) => v !== null && set('height', [pxClass('h', v)], { height: `${v}px` })} />
          </>
        ))}
        {isImg && R('Fit', 'objectFit', (
          <Segmented value={s.objectFit === 'contain' ? 'contain' : s.objectFit === 'cover' ? 'cover' : 'fill'} onChange={(v) => set('objectFit', v === 'fill' ? null : [`object-${v}`], { 'object-fit': v })}
            options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Stretch' }]} />
        ))}
      </Section>

      <Section title="Spacing">
        {R('Padding', 'padding', (
          <BoxField key={`p|${node.oid}`} stamp={stamp}
            values={{ t: px(s.paddingTop), r: px(s.paddingRight), b: px(s.paddingBottom), l: px(s.paddingLeft) }}
            onPreview={(b) => onPreview(boxCss('padding', b))}
            onCommit={(b) => set('padding', boxClasses('p', b), boxCss('padding', b))} />
        ))}
        {R('Margin', 'margin', (
          <BoxField key={`m|${node.oid}|${centered}`} stamp={stamp} allowNegative autoX={centered}
            values={{ t: px(s.marginTop), r: px(s.marginRight), b: px(s.marginBottom), l: px(s.marginLeft) }}
            onPreview={(b) => onPreview(boxCss('margin', b))}
            onCommit={(b) => set('margin', boxClasses('m', b), boxCss('margin', b))} />
        ))}
        {!isText || isContainer ? (
          <Row label="" device={device}>
            <Segmented value={centered ? 'center' : 'start'} onChange={(v) => {
              const b: Box = { t: px(s.marginTop) ?? 0, b: px(s.marginBottom) ?? 0, l: v === 'center' ? 'auto' : 0, r: v === 'center' ? 'auto' : 0 }
              set('margin', boxClasses('m', b), boxCss('margin', b))
            }} options={[{ value: 'start', label: 'Align left' }, { value: 'center', label: 'Center' }]} />
          </Row>
        ) : null}
      </Section>

      <Section title="Border & radius" defaultOpen={false}>
        {R('Radius', 'radius', (
          <>
            <Segmented value={radiusMode} onChange={(v) => {
              if (v === 'none') set('radius', ['rounded-none'], { 'border-radius': '0' })
              else if (v === 'theme') set('radius', ['rounded-store'], { 'border-radius': 'var(--radius, 8px)' })
              else set('radius', ['rounded-full'], { 'border-radius': '9999px' })
            }} options={[{ value: 'none', label: 'None' }, { value: 'theme', label: 'Theme' }, { value: 'full', label: 'Full' }]} />
            <NumberField value={px(s.borderTopLeftRadius)} min={0} max={999} stamp={stamp}
              onPreview={(v) => onPreview({ 'border-radius': `${v}px` })}
              onCommit={(v) => v !== null && set('radius', [pxClass('rounded', v)], { 'border-radius': `${v}px` })} />
          </>
        ))}
        {R('Border', 'borderWidth', (
          <NumberField value={px(s.borderTopWidth)} unit="px" min={0} max={20} stamp={stamp}
            onPreview={(v) => onPreview({ 'border-width': `${v}px`, 'border-style': 'solid' })}
            onCommit={(v) => v !== null && set('borderWidth', v === 0 ? null : [v === 1 ? 'border' : pxClass('border', v)], { 'border-width': `${v}px`, 'border-style': 'solid' })} />
        ))}
        {(px(s.borderTopWidth) ?? 0) > 0 && R('Color', 'borderColor', (
          <ColorField prefix="border" classColor={colorOfClass('border', cur('borderColor'))} computed={s.borderTopColor} theme={theme}
            onPreview={onPreview} onPick={(c, css) => set('borderColor', c ? [colorClass('border', c)!] : null, css)} />
        ))}
        {R('Shadow', 'shadow', (
          <Segmented value={shadow} onChange={(v) => set('shadow', v === 'none' ? null : [`shadow-${v}`], { 'box-shadow': v === 'none' ? 'none' : SHADOWS[v] })}
            options={[{ value: 'none', label: 'None' }, { value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }, { value: 'xl', label: 'XL' }]} />
        ))}
      </Section>
    </div>
  )
}
