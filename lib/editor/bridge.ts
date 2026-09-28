// Visual editor — the in-preview bridge (v1 2026-09-26, design panel 2026-09-28). Written
// ONLY into the editing sandbox (never code_versions, deploys or exports): a client
// component mounted by the sandbox copy of app/layout.tsx. It outlines [data-oid] elements
// under the cursor, reports clicks to the Studio (postMessage) together with the element's
// computed styles and the theme values, draws the selection the Studio asks for, shows
// live style previews (inline styles, removed once the saved classes arrive through hot
// reload) and lets the merchant edit text in place (double-click).
// Messages are accepted only from, and sent only to, the platform origins baked in when
// the session starts. No '@/…' imports: tests load this file through type stripping.

export const EDITOR_BRIDGE_PATH = 'components/__editor/EditorBridge.tsx'
export const EDITOR_MESSAGE_SOURCE = 'store-visual-editor'

/** Computed style properties the bridge reports for the selected element (camelCase). */
export const EDITOR_STYLE_PROPS = [
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'color',
  'fontStyle', 'textTransform', 'textDecorationLine', 'backgroundColor', 'opacity',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'rowGap', 'columnGap', 'display', 'flexDirection', 'justifyContent', 'alignItems', 'flexWrap',
  'gridTemplateColumns', 'width', 'height', 'maxWidth', 'objectFit',
  'borderTopLeftRadius', 'borderTopWidth', 'borderTopColor', 'boxShadow',
] as const

/** Theme CSS variables reported with every selection (resolved values). */
export const EDITOR_THEME_VARS = [
  '--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-accent',
  '--color-accent-text', '--color-border', '--font-heading', '--font-body', '--radius',
] as const

/** Origins the bridge talks to: https only (http only for localhost). */
export function sanitizeEditorOrigins(origins: string[]): string[] {
  const out = new Set<string>()
  for (const raw of origins) {
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')) out.add(u.origin)
    } catch { /* ignore */ }
  }
  return [...out]
}

export function editorBridgeSource(parentOrigins: string[]): string {
  const origins = sanitizeEditorOrigins(parentOrigins)
  return `'use client'
import { useEffect } from 'react'

const ORIGINS: string[] = ${JSON.stringify(origins)}
const SOURCE = ${JSON.stringify(EDITOR_MESSAGE_SOURCE)}
const STYLE_PROPS: string[] = ${JSON.stringify(EDITOR_STYLE_PROPS)}
const THEME_VARS: string[] = ${JSON.stringify(EDITOR_THEME_VARS)}

function box(color: string, dashed: boolean): HTMLDivElement {
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;display:none;box-sizing:border-box;border-radius:3px;' +
    'border:' + (dashed ? '1px dashed ' : '2px solid ') + color + ';background:' + (dashed ? 'transparent' : 'rgba(212,255,63,.06)')
  document.body.appendChild(d)
  return d
}

function tagLabel(): HTMLDivElement {
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;padding:1px 6px;border-radius:4px;' +
    'background:#D4FF3F;color:#0a0a0a;font:600 10px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em'
  document.body.appendChild(d)
  return d
}

function place(d: HTMLDivElement, el: Element | null) {
  if (!el) { d.style.display = 'none'; return }
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) { d.style.display = 'none'; return }
  d.style.display = 'block'
  d.style.left = r.left - 2 + 'px'
  d.style.top = r.top - 2 + 'px'
  d.style.width = r.width + 4 + 'px'
  d.style.height = r.height + 4 + 'px'
}

function placeLabel(d: HTMLDivElement, el: Element | null, text: string) {
  if (!el) { d.style.display = 'none'; return }
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) { d.style.display = 'none'; return }
  d.textContent = text
  d.style.display = 'block'
  d.style.left = Math.max(0, r.left - 2) + 'px'
  d.style.top = (r.top > 20 ? r.top - 20 : r.bottom + 4) + 'px'
}

function readStyles(el: Element): Record<string, string> {
  const cs = getComputedStyle(el) as unknown as Record<string, string>
  const out: Record<string, string> = {}
  for (const p of STYLE_PROPS) out[p] = String(cs[p] ?? '')
  return out
}

function readTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) out[v] = cs.getPropertyValue(v).trim()
  return out
}

export function EditorBridge() {
  useEffect(() => {
    if (window.parent === window || ORIGINS.length === 0) return
    let editMode = true
    let selected: string | null = null
    let editing: HTMLElement | null = null
    let editingOid: string | null = null
    let editingOriginal = ''
    const hover = box('rgba(212,255,63,.9)', true)
    const sel = box('#D4FF3F', false)
    const label = tagLabel()
    const previewed = new Map<HTMLElement, string | null>()
    let commitObserver: MutationObserver | null = null
    let commitTimer = 0
    const post = (msg: Record<string, unknown>) => {
      for (const o of ORIGINS) window.parent.postMessage({ source: SOURCE, ...msg }, o)
    }
    const target = (t: EventTarget | null): Element | null =>
      t instanceof Element ? t.closest('[data-oid]') : null
    const all = (oid: string | null): HTMLElement[] =>
      oid ? Array.from(document.querySelectorAll<HTMLElement>('[data-oid="' + CSS.escape(oid) + '"]')) : []
    const find = (oid: string | null): Element | null => all(oid)[0] ?? null
    const report = (type: string, oid: string | null) => {
      const el = find(oid)
      if (!el || !oid) return
      post({ type, oid, count: all(oid).length, styles: readStyles(el), theme: readTheme() })
    }

    const restorePreview = () => {
      if (commitObserver) { commitObserver.disconnect(); commitObserver = null }
      window.clearTimeout(commitTimer)
      previewed.forEach((orig, el) => {
        if (orig === null) el.removeAttribute('style')
        else el.setAttribute('style', orig)
      })
      previewed.clear()
    }
    const preview = (oid: string, style: Record<string, string>) => {
      for (const el of all(oid)) {
        if (!previewed.has(el)) previewed.set(el, el.getAttribute('style'))
        for (const [prop, value] of Object.entries(style)) {
          if (/^[a-z-]+$/.test(prop)) el.style.setProperty(prop, String(value), 'important')
        }
      }
    }
    // The saved classes arrive through hot reload: drop the inline preview once the
    // element's class attribute changes (plus a moment for the new CSS), or after 5 s.
    const commitPreview = (oid: string) => {
      if (previewed.size === 0) { report('styles', oid); return }
      const done = () => { restorePreview(); report('styles', oid) }
      commitObserver = new MutationObserver(() => {
        if (commitObserver) { commitObserver.disconnect(); commitObserver = null }
        window.clearTimeout(commitTimer)
        commitTimer = window.setTimeout(done, 450)
      })
      previewed.forEach((_orig, el) => commitObserver?.observe(el, { attributes: true, attributeFilter: ['class'] }))
      commitTimer = window.setTimeout(done, 5000)
    }

    const stopEditing = (commit: boolean) => {
      const el = editing
      if (!el) return
      editing = null
      el.removeAttribute('contenteditable')
      el.style.outline = ''
      const value = el.textContent ?? ''
      if (!commit) { el.textContent = editingOriginal; return }
      if (value !== editingOriginal) post({ type: 'text', oid: editingOid, value })
    }
    const startEditing = (el: HTMLElement) => {
      if (el.children.length > 0 || !(el.textContent ?? '').trim()) return
      editing = el
      editingOid = el.getAttribute('data-oid')
      editingOriginal = el.textContent ?? ''
      el.setAttribute('contenteditable', 'plaintext-only')
      if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true')
      el.style.outline = 'none'
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(range)
      place(hover, null)
    }

    const onMove = (e: MouseEvent) => { if (editMode && !editing) place(hover, target(e.target)) }
    const onLeave = () => place(hover, null)
    const onClick = (e: MouseEvent) => {
      if (!editMode) return
      if (editing && e.target instanceof Node && editing.contains(e.target)) return
      if (editing) stopEditing(true)
      const el = target(e.target)
      e.preventDefault()
      e.stopPropagation()
      if (!el) return
      selected = el.getAttribute('data-oid')
      place(sel, el)
      report('select', selected)
    }
    const onDblClick = (e: MouseEvent) => {
      if (!editMode || editing) return
      const el = target(e.target)
      if (!(el instanceof HTMLElement)) return
      e.preventDefault()
      e.stopPropagation()
      startEditing(el)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!editing) return
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopEditing(true) }
      else if (e.key === 'Escape') { e.preventDefault(); stopEditing(false) }
    }
    const onFocusOut = (e: FocusEvent) => { if (editing && e.target === editing) stopEditing(true) }
    const block = (e: Event) => { if (editMode) { e.preventDefault(); e.stopPropagation() } }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !ORIGINS.includes(e.origin)) return
      const d = e.data as { source?: unknown; type?: unknown; oid?: unknown; edit?: unknown; style?: unknown; value?: unknown } | null
      if (!d || d.source !== SOURCE) return
      const oid = typeof d.oid === 'string' ? d.oid : null
      if (d.type === 'mode') {
        editMode = d.edit === true
        if (!editMode) { place(hover, null); if (editing) stopEditing(true) }
      } else if (d.type === 'select') { selected = oid; place(sel, find(selected)) }
      else if (d.type === 'inspect') report('styles', oid)
      else if (d.type === 'preview-style' && oid && d.style && typeof d.style === 'object') preview(oid, d.style as Record<string, string>)
      else if (d.type === 'commit-preview' && oid) commitPreview(oid)
      else if (d.type === 'clear-preview') { restorePreview(); if (oid) report('styles', oid) }
      else if (d.type === 'text-rejected' && oid && typeof d.value === 'string') {
        for (const el of all(oid)) if (el.textContent === d.value) el.textContent = editingOriginal
      }
      else if (d.type === 'ping') post({ type: 'ready', path: location.pathname })
    }
    let raf = 0
    const follow = () => {
      const el = find(selected)
      place(sel, el)
      placeLabel(label, editing ? null : el, el ? el.tagName.toLowerCase() : '')
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    let lastPath = location.pathname
    const pathTimer = window.setInterval(() => {
      if (location.pathname !== lastPath) { lastPath = location.pathname; selected = null; post({ type: 'ready', path: lastPath }) }
    }, 500)

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseleave', onLeave, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('submit', block, true)
    window.addEventListener('message', onMessage)
    post({ type: 'ready', path: location.pathname })
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(pathTimer)
      restorePreview()
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseleave', onLeave, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('submit', block, true)
      window.removeEventListener('message', onMessage)
      hover.remove()
      sel.remove()
      label.remove()
    }
  }, [])
  return null
}
`
}

/**
 * The sandbox copy of app/layout.tsx with <EditorBridge /> mounted just before </body>.
 * null when the layout has no </body> (the editor can't attach — the caller reports it).
 */
export function injectEditorBridge(layoutSource: string): string | null {
  const bodyClose = layoutSource.lastIndexOf('</body>')
  if (bodyClose < 0) return null
  const importLine = `import { EditorBridge } from '@/components/__editor/EditorBridge'\n`
  const withTag = layoutSource.slice(0, bodyClose) + '<EditorBridge />\n' + layoutSource.slice(bodyClose)
  // At the top (imports are hoisted, so their order doesn't matter) — after a leading
  // directive prologue ('use client' …) if there is one. Never inside a multi-line import.
  const directive = withTag.match(/^(?:\s*(?:'use [a-z]+'|"use [a-z]+");?[ \t]*\r?\n)+/)
  const at = directive ? directive[0].length : 0
  return withTag.slice(0, at) + importLine + withTag.slice(at)
}
