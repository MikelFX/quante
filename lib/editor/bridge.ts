// Visual editor v1 — the in-preview bridge (2026-09-26). Written ONLY into the editing
// sandbox (never code_versions, deploys or exports): a client component mounted by the
// sandbox copy of app/layout.tsx. It outlines [data-oid] elements under the cursor,
// reports clicks to the Studio (postMessage) and draws the selection the Studio asks for.
// Messages are accepted only from, and sent only to, the platform origins baked in when
// the session starts. No '@/…' imports: tests load this file through type stripping.

export const EDITOR_BRIDGE_PATH = 'components/__editor/EditorBridge.tsx'
export const EDITOR_MESSAGE_SOURCE = 'store-visual-editor'

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

function box(color: string, dashed: boolean): HTMLDivElement {
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;display:none;box-sizing:border-box;border-radius:3px;' +
    'border:2px ' + (dashed ? 'dashed' : 'solid') + ' ' + color + ';background:' + (dashed ? 'transparent' : 'rgba(212,255,63,.08)')
  document.body.appendChild(d)
  return d
}

function place(d: HTMLDivElement, el: Element | null) {
  if (!el) { d.style.display = 'none'; return }
  const r = el.getBoundingClientRect()
  d.style.display = 'block'
  d.style.left = r.left - 2 + 'px'
  d.style.top = r.top - 2 + 'px'
  d.style.width = r.width + 4 + 'px'
  d.style.height = r.height + 4 + 'px'
}

export function EditorBridge() {
  useEffect(() => {
    if (window.parent === window || ORIGINS.length === 0) return
    let editMode = true
    let selected: string | null = null
    const hover = box('rgba(212,255,63,.9)', true)
    const sel = box('#D4FF3F', false)
    const post = (msg: Record<string, unknown>) => {
      for (const o of ORIGINS) window.parent.postMessage({ source: SOURCE, ...msg }, o)
    }
    const target = (t: EventTarget | null): Element | null =>
      t instanceof Element ? t.closest('[data-oid]') : null
    const find = (oid: string | null): Element | null =>
      oid ? document.querySelector('[data-oid="' + CSS.escape(oid) + '"]') : null

    const onMove = (e: MouseEvent) => { if (editMode) place(hover, target(e.target)) }
    const onLeave = () => place(hover, null)
    const onClick = (e: MouseEvent) => {
      if (!editMode) return
      const el = target(e.target)
      e.preventDefault()
      e.stopPropagation()
      if (!el) return
      selected = el.getAttribute('data-oid')
      place(sel, el)
      post({ type: 'select', oid: selected, count: document.querySelectorAll('[data-oid="' + CSS.escape(selected || '') + '"]').length })
    }
    const block = (e: Event) => { if (editMode) { e.preventDefault(); e.stopPropagation() } }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !ORIGINS.includes(e.origin)) return
      const d = e.data as { source?: unknown; type?: unknown; oid?: unknown; edit?: unknown } | null
      if (!d || d.source !== SOURCE) return
      if (d.type === 'mode') { editMode = d.edit === true; if (!editMode) { place(hover, null) } }
      else if (d.type === 'select') { selected = typeof d.oid === 'string' ? d.oid : null; place(sel, find(selected)) }
      else if (d.type === 'ping') post({ type: 'ready', path: location.pathname })
    }
    let raf = 0
    const follow = () => { place(sel, find(selected)); raf = requestAnimationFrame(follow) }
    raf = requestAnimationFrame(follow)
    let lastPath = location.pathname
    const pathTimer = window.setInterval(() => {
      if (location.pathname !== lastPath) { lastPath = location.pathname; selected = null; post({ type: 'ready', path: lastPath }) }
    }, 500)

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseleave', onLeave, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', block, true)
    window.addEventListener('message', onMessage)
    post({ type: 'ready', path: location.pathname })
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(pathTimer)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseleave', onLeave, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', block, true)
      window.removeEventListener('message', onMessage)
      hover.remove()
      sel.remove()
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
