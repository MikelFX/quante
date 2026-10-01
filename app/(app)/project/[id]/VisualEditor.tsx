'use client'

// Visual editor (v1 2026-09-26, v2 + v3 2026-09-27, design panel 2026-09-28): the store
// runs in a Vercel Sandbox (`next dev`, hot reload) with data-oid instrumentation; clicking
// an element selects it, double-clicking a text edits it in place.
//   Design tab — Framer-style panel (DesignPanel.tsx): typography, fill, layout, size,
//   spacing, border — per device (Desktop / Tablet / Phone), previewed instantly.
//   Content tab — text, order, ready-made blocks, images, 'Create with AI', "My elements"
//   (/api/editor-blocks), delete.
// Everything is written straight into the store's code as a draft version
// (/api/projects/[id]/editor). Nothing reaches shoppers until Publish.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MousePointer2, Hand, RotateCcw, X, Check, ImagePlus, Sparkles, Trash2, Heading, Type, Minus, RectangleHorizontal, LayoutTemplate, Bookmark, BookmarkPlus, Monitor, Tablet, Smartphone, ChevronDown, ChevronRight } from 'lucide-react'
import { EDITOR_MESSAGE_SOURCE } from '@/lib/editor/bridge'
import type { EditorNode, EditorOp } from '@/lib/editor/oid'
import { applyStyleEdits, DEVICE_WIDTH, type Device, type StyleEdit } from '@/lib/editor/styles'
import { DesignPanel, type Styles } from './DesignPanel'

interface Props {
  projectId: string
  onExit: () => void
  /** A draft version was saved (refresh version list / publish state). */
  onSaved: (versionNo: number) => void
}

type Phase = 'starting' | 'ready' | 'error'
type Tab = 'design' | 'content'

/** A saved "My elements" block (lib/editor/blocks.ts). */
interface SavedBlock { id: string; name: string; snippet: string }

const TOKEN_HINTS = ['bg-accent', 'text-accent', 'text-muted', 'bg-surface', 'border-border', 'rounded-store', 'font-heading']

const panel: React.CSSProperties = { background: '#0d0d11', borderLeft: '1px solid rgba(255,255,255,.07)' }
const label: React.CSSProperties = { fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: '0 0 6px' }
const input: React.CSSProperties = { width: '100%', background: '#08080a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: '#f4f4f6', fontSize: 12, padding: '7px 8px', outline: 'none', resize: 'vertical' }
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: '#f4f4f6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }

const DEVICES: Array<{ id: Device; icon: React.ElementType; title: string }> = [
  { id: 'desktop', icon: Monitor, title: 'Desktop' },
  { id: 'tablet', icon: Tablet, title: 'Tablet (768 px +)' },
  { id: 'phone', icon: Smartphone, title: 'Phone' },
]

interface SaveResult { versionId: string; versionNo: number; nodes: Record<string, EditorNode>; selectOid: string | null; sessionLost?: boolean; reply?: string; warning?: string | null; unchanged?: boolean }
type SendResult = { ok: true; data: SaveResult } | { ok: false; error: string }

export function VisualEditor({ projectId, onExit, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [nodes, setNodes] = useState<Record<string, EditorNode>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCount, setSelectedCount] = useState(1)
  const [selectMode, setSelectMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [blocks, setBlocks] = useState<SavedBlock[]>([])
  const [blocksAvailable, setBlocksAvailable] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [tab, setTab] = useState<Tab>('design')
  const [styles, setStyles] = useState<Styles | null>(null)
  const [theme, setTheme] = useState<Styles>({})
  const [stamp, setStamp] = useState(0)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [selRect, setSelRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [askBusySince, setAskBusySince] = useState<number | null>(null)
  const [askResult, setAskResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [askHidden, setAskHidden] = useState(false)
  const pathRef = useRef('/')
  const askRef = useRef(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef(false)
  // Saves run one at a time and always read the newest state through these refs, so a
  // burst of style changes never works on an outdated className or version.
  const nodesRef = useRef<Record<string, EditorNode>>({})
  const selectedRef = useRef<string | null>(null)
  const versionIdRef = useRef<string | null>(null)
  const deviceRef = useRef<Device>('desktop')
  const lockRef = useRef<Promise<unknown>>(Promise.resolve())
  const styleQueue = useRef<Array<{ edits: StyleEdit[]; device: Device }>>([])
  const styleRunning = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/editor-blocks')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        setBlocks(Array.isArray(d.blocks) ? d.blocks : [])
        setBlocksAvailable(d.available === true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Preview area size (for the device frame).
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setArea({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  const api = useCallback(async (payload: Record<string, unknown>, keepalive = false) => {
    const res = await fetch(`/api/projects/${projectId}/editor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive,
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }, [projectId])

  const applyNodes = (next: Record<string, EditorNode>, versionId: string | null, sel: string | null) => {
    nodesRef.current = next
    versionIdRef.current = versionId
    selectedRef.current = sel
    setNodes(next)
    setSelected(sel)
  }

  const start = useCallback(async () => {
    setPhase('starting')
    setError(null)
    applyNodes({}, null, null)
    setStyles(null)
    try {
      const { res, data } = await api({ action: 'start' })
      if (!res.ok) { setPhase('error'); setError(data.error ?? `The editor could not start (${res.status}).`); return }
      setUrl(data.url)
      applyNodes(data.nodes ?? {}, data.versionId, null)
      setFrameKey((k) => k + 1)
      setPhase('ready')
    } catch {
      setPhase('error')
      setError('The editor could not start — check your connection.')
    }
  }, [api])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  // Keep the sandbox alive while the editor is open. It is stopped by Done or when the
  // page goes away; otherwise it stops itself EDITOR_IDLE_MS after the last heartbeat.
  useEffect(() => {
    const beat = window.setInterval(() => { void api({ action: 'heartbeat' }) }, 60_000)
    const stop = () => { void api({ action: 'stop' }, true) }
    window.addEventListener('pagehide', stop)
    return () => { window.clearInterval(beat); window.removeEventListener('pagehide', stop) }
  }, [api])

  const done = () => {
    void api({ action: 'stop' }, true)
    onExit()
  }

  const post = useCallback((msg: Record<string, unknown>) => {
    const win = frameRef.current?.contentWindow
    if (!win || !url) return
    win.postMessage({ source: EDITOR_MESSAGE_SOURCE, ...msg }, new URL(url).origin)
  }, [url])

  /** Runs saves one after another. */
  const locked = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = lockRef.current.then(fn, fn)
    lockRef.current = p.catch(() => {})
    return p
  }, [])

  /** One editor API call for an element; updates nodes / version on success. */
  const send = useCallback(async (payload: Record<string, unknown>, target: EditorNode, quiet = false): Promise<SendResult> => {
    const versionId = versionIdRef.current
    if (!versionId) return { ok: false, error: 'The editor is not ready yet.' }
    const failed = (error: string): SendResult => { if (!quiet) setEditError(error); return { ok: false, error } }
    try {
      const { res, data } = await api({ ...payload, oid: target.oid, tag: target.tag, baseVersionId: versionId })
      if (res.status === 409 && data.code === 'stale') { const r = failed(data.error); await start(); return r }
      if (!res.ok) return failed(data.error ?? `Edit failed (${res.status}).`)
      const r = data as SaveResult
      if (r.unchanged) return { ok: true, data: r }
      applyNodes(r.nodes ?? {}, r.versionId, r.selectOid ?? null)
      post({ type: 'select', oid: r.selectOid ?? null })
      setSavedNote(`Saved to draft v${r.versionNo}`)
      onSaved(r.versionNo)
      if (r.sessionLost) await start()
      return { ok: true, data: r }
    } catch {
      return failed('Edit failed — check your connection.')
    }
  }, [api, onSaved, post, start])

  const textEdit = useCallback((oid: string, value: string) => locked(async () => {
    const n = nodesRef.current[oid]
    if (!n || n.text === null) {
      post({ type: 'text-rejected', oid, value })
      setEditError('This text comes from your store data (products, settings …) — change it in Chat or in Products.')
      return
    }
    setEditError(null)
    setSaving(true)
    const ok = (await send({ action: 'edit', op: { kind: 'text', value } }, n)).ok
    setSaving(false)
    if (!ok) post({ type: 'text-rejected', oid, value })
  }), [locked, post, send])

  useEffect(() => {
    if (!url) return
    const origin = new URL(url).origin
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return
      const d = e.data as { source?: unknown; type?: unknown; oid?: unknown; count?: unknown; styles?: unknown; theme?: unknown; value?: unknown; path?: unknown; rect?: unknown } | null
      if (!d || d.source !== EDITOR_MESSAGE_SOURCE) return
      const oid = typeof d.oid === 'string' ? d.oid : null
      const report = () => {
        if (d.styles && typeof d.styles === 'object') setStyles(d.styles as Styles)
        if (d.theme && typeof d.theme === 'object') setTheme(d.theme as Styles)
        setStamp((n) => n + 1)
      }
      if (d.type === 'ready') {
        if (typeof d.path === 'string') pathRef.current = d.path
        post({ type: 'mode', edit: selectMode })
        if (selectedRef.current) post({ type: 'select', oid: selectedRef.current })
      } else if (d.type === 'select' && oid) {
        selectedRef.current = oid
        setSelected(oid)
        setSelectedCount(typeof d.count === 'number' ? d.count : 1)
        setEditError(null)
        if (!askRef.current) { setAskResult(null); setAskHidden(false) }
        report()
      } else if (d.type === 'styles' && oid && oid === selectedRef.current) {
        report()
      } else if (d.type === 'rect') {
        const r = d.rect as { left?: unknown; top?: unknown; width?: unknown; height?: unknown } | null
        setSelRect(r && typeof r.left === 'number' && typeof r.top === 'number' && typeof r.width === 'number' && typeof r.height === 'number'
          ? { left: r.left, top: r.top, width: r.width, height: r.height } : null)
      } else if (d.type === 'text' && oid && typeof d.value === 'string') {
        void textEdit(oid, d.value)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [url, post, selectMode, textEdit])

  useEffect(() => { post({ type: 'mode', edit: selectMode }) }, [selectMode, post])

  // Another device width → other breakpoint styles: re-read them once the frame re-laid out.
  useEffect(() => {
    deviceRef.current = device
    const id = selectedRef.current
    if (!id) return
    const t = window.setTimeout(() => post({ type: 'inspect', oid: id }), 250)
    return () => window.clearTimeout(t)
  }, [device, post])

  const node = selected ? nodes[selected] : undefined

  async function run(payload: Record<string, unknown>): Promise<boolean> {
    if (!selectedRef.current || busy) return false
    setBusy(true)
    setEditError(null)
    try {
      return await locked(async () => {
        const n = selectedRef.current ? nodesRef.current[selectedRef.current] : undefined
        return n ? (await send(payload, n)).ok : false
      })
    } finally {
      setBusy(false)
    }
  }
  const edit = (op: EditorOp) => run({ action: 'edit', op })

  // Design panel: preview instantly, save the classes in the background (queued).
  const previewStyle = (css: Record<string, string>) => {
    if (selectedRef.current) post({ type: 'preview-style', oid: selectedRef.current, style: css })
  }
  const commitStyle = (edits: StyleEdit[], css?: Record<string, string>) => {
    if (css && Object.keys(css).length > 0) previewStyle(css)
    styleQueue.current.push({ edits, device: deviceRef.current })
    if (styleRunning.current) return
    styleRunning.current = true
    setSaving(true)
    setEditError(null)
    void locked(async () => {
      try {
        while (styleQueue.current.length > 0) {
          const batch = styleQueue.current.splice(0)
          const n = selectedRef.current ? nodesRef.current[selectedRef.current] : undefined
          if (!n || n.className === null) { post({ type: 'clear-preview' }); break }
          const before = n.className.split(/\s+/).filter(Boolean).join(' ')
          const next = batch.reduce((cls, b) => applyStyleEdits(cls, b.edits, b.device, n.tag), before)
          if (next === before) { post({ type: 'clear-preview', oid: n.oid }); continue }
          const ok = (await send({ action: 'edit', op: { kind: 'classes', value: next } }, n)).ok
          post({ type: ok ? 'commit-preview' : 'clear-preview', oid: selectedRef.current ?? n.oid })
        }
      } finally {
        styleRunning.current = false
        setSaving(false)
      }
    })
  }

  // "Ask Quante" — the floating chat next to the selected element (a real code edit).
  async function askQuante(instruction: string): Promise<boolean> {
    if (!selectedRef.current || askRef.current) return false
    askRef.current = true
    setAskBusySince(Date.now())
    setAskResult(null)
    try {
      const r = await locked(async (): Promise<SendResult> => {
        const n = selectedRef.current ? nodesRef.current[selectedRef.current] : undefined
        if (!n) return { ok: false, error: 'Select an element first.' }
        return send({ action: 'ai_edit', instruction, path: pathRef.current }, n, true)
      })
      if (!r.ok) { setAskResult({ ok: false, text: r.error }); return false }
      const text = [r.data.reply, r.data.warning].filter(Boolean).join(' ')
      setAskResult({ ok: !r.data.unchanged, text: text || 'Done.' })
      const again = selectedRef.current
      if (again) window.setTimeout(() => post({ type: 'inspect', oid: again }), 1500)
      return true
    } finally {
      askRef.current = false
      setAskBusySince(null)
    }
  }

  async function insertImage(file: File, position: 'after' | 'inside') {
    setEditError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('projectId', projectId)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.url !== 'string') { setEditError(data.error ?? 'Upload failed.'); return }
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/["<>{}\\]/g, '').slice(0, 80)
      await edit({ kind: 'insert', position, snippet: `<img src="${data.url}" alt="${alt}" className="w-full h-auto rounded-store" />` })
    } catch {
      setEditError('Upload failed — check your connection.')
    }
  }

  async function saveBlock(name: string): Promise<boolean> {
    const n = selectedRef.current ? nodesRef.current[selectedRef.current] : undefined
    if (!n || !versionIdRef.current || busy) return false
    setBusy(true)
    setEditError(null)
    try {
      const { res, data } = await api({ action: 'save_block', oid: n.oid, tag: n.tag, name, baseVersionId: versionIdRef.current })
      if (res.status === 409 && data.code === 'stale') { setEditError(data.error); await start(); return false }
      if (!res.ok || !data.block) { setEditError(data.error ?? `Saving failed (${res.status}).`); return false }
      setBlocks((b) => [data.block as SavedBlock, ...b])
      setSavedNote(`Saved “${(data.block as SavedBlock).name}” to My elements`)
      return true
    } catch {
      setEditError('Saving failed — check your connection.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function removeBlock(id: string) {
    setEditError(null)
    try {
      const res = await fetch(`/api/editor-blocks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok || res.status === 404) setBlocks((b) => b.filter((x) => x.id !== id))
      else setEditError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Delete failed.')
    } catch {
      setEditError('Delete failed — check your connection.')
    }
  }

  const fileLabel = node ? node.file.replace(/^components\/store\//, '').replace(/\.tsx$/, '') : ''

  // Device frame: Desktop uses the available width (1024–1279 px, so exactly `lg:` applies)
  // or 1200 px scaled down on small screens; Tablet / Phone are fixed widths, centered.
  const pad = device === 'desktop' ? 0 : 24
  const frameW = device === 'desktop'
    ? (area.w >= 1024 ? Math.min(area.w, 1279) : DEVICE_WIDTH.desktop)
    : DEVICE_WIDTH[device]
  const scale = area.w > 0 ? Math.min(1, (area.w - pad * 2) / frameW) : 1
  const frameH = area.h > 0 ? (area.h - pad * 2) / scale : 800

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#09090c' }}>
      {/* Toolbar */}
      <div style={{ flexShrink: 0, height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid rgba(255,255,255,.06)', background: '#0d0d11' }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 700, letterSpacing: '.05em', color: '#D4FF3F', textTransform: 'uppercase' }}>Visual edit</span>
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden' }}>
          <button onClick={() => setSelectMode(true)} title="Click elements to select them, double-click text to edit it" style={{ ...btn, border: 'none', borderRadius: 0, background: selectMode ? 'rgba(212,255,63,.16)' : 'transparent' }}><MousePointer2 size={11} /> Select</button>
          <button onClick={() => setSelectMode(false)} title="Use the store normally (links, menus) — nothing is selectable" style={{ ...btn, border: 'none', borderRadius: 0, borderLeft: '1px solid rgba(255,255,255,.08)', background: !selectMode ? 'rgba(212,255,63,.16)' : 'transparent' }}><Hand size={11} /> Browse</button>
        </div>
        <button onClick={() => setFrameKey((k) => k + 1)} title="Reload the preview" style={btn}><RotateCcw size={11} /></button>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden' }}>
          {DEVICES.map((d, i) => (
            <button key={d.id} onClick={() => setDevice(d.id)} title={d.title} style={{ ...btn, border: 'none', borderRadius: 0, borderLeft: i ? '1px solid rgba(255,255,255,.08)' : 'none', padding: '5px 9px', background: device === d.id ? 'rgba(212,255,63,.16)' : 'transparent', color: device === d.id ? '#D4FF3F' : '#8a8a93' }}>
              <d.icon size={12} />
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {saving ? (
          <span style={{ fontSize: 11, color: '#8a8a93', fontFamily: 'var(--font-geist-mono)' }}>Saving…</span>
        ) : savedNote && <span style={{ fontSize: 11, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>{savedNote}</span>}
        <button onClick={done} style={{ ...btn, borderColor: 'rgba(212,255,63,.35)', color: '#D4FF3F' }}><Check size={11} /> Done</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Preview */}
        <div ref={areaRef} style={{ flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden', background: device === 'desktop' ? '#09090c' : '#141418' }}>
          {phase === 'ready' && url ? (
            <div style={{ position: 'absolute', top: pad, left: '50%', width: frameW * scale, height: frameH * scale, transform: 'translateX(-50%)', borderRadius: device === 'desktop' ? 0 : 14, overflow: 'hidden', boxShadow: device === 'desktop' ? 'none' : '0 0 0 1px rgba(255,255,255,.1), 0 20px 50px rgba(0,0,0,.5)' }}>
              <iframe key={frameKey} ref={frameRef} src={url} title="Visual editor preview" style={{ width: frameW, height: frameH, border: 'none', background: '#fff', transform: `scale(${scale})`, transformOrigin: '0 0' }} />
            </div>
          ) : null}
          {phase === 'ready' && url && node && selectMode && !askHidden && (selRect || askBusySince) ? (
            <AskQuante
              tag={node.tag}
              anchor={selRect ? {
                left: (area.w - frameW * scale) / 2 + selRect.left * scale,
                top: pad + selRect.top * scale,
                bottom: pad + (selRect.top + selRect.height) * scale,
              } : null}
              area={area}
              busySince={askBusySince}
              result={askResult}
              onSubmit={askQuante}
              onClose={() => setAskHidden(true)}
            />
          ) : null}
          {phase !== 'ready' || !url ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
              {phase === 'starting' ? (
                <div>
                  <div style={{ width: 22, height: 22, margin: '0 auto 12px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.1)', borderTopColor: '#D4FF3F', animation: 'spin .8s linear infinite' }} />
                  <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Starting the live editor… (about 10 s)</p>
                </div>
              ) : (
                <div style={{ maxWidth: 420 }}>
                  <p style={{ fontSize: 12, color: '#f87171', margin: '0 0 12px', whiteSpace: 'pre-wrap', textAlign: 'left' }}>{error}</p>
                  <button onClick={() => void start()} style={btn}>Try again</button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Inspector */}
        <div style={{ ...panel, width: 300, flexShrink: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!node ? (
            <div>
              <p style={{ fontSize: 12, color: '#f4f4f6', margin: '0 0 8px', fontWeight: 600 }}>{phase === 'ready' ? (selectMode ? 'Click any element in the preview' : 'Browse mode') : ''}</p>
              {phase === 'ready' && (
                <p style={{ fontSize: 11, color: '#8a8a93', margin: 0, lineHeight: 1.6 }}>
                  {selectMode
                    ? <>Click to select · double-click a text to rewrite it · switch Desktop / Tablet / Phone above to style each screen size. Changes are saved as a <b style={{ color: '#D4FF3F' }}>draft</b> — Publish makes them live.</>
                    : <>The store works normally (links, menus). Switch to <b style={{ color: '#D4FF3F' }}>Select</b> to edit elements.</>}
                </p>
              )}
              {editError && <p style={{ fontSize: 11, color: '#f87171', margin: '10px 0 0', lineHeight: 1.5 }}>{editError}</p>}
            </div>
          ) : (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <p style={{ fontSize: 13, color: '#f4f4f6', margin: 0, fontFamily: 'var(--font-geist-mono)' }}>&lt;{node.tag}&gt;</p>
                  <p style={{ fontSize: 10, color: '#5b5b64', margin: 0, fontFamily: 'var(--font-geist-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileLabel}</p>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => { applyNodes(nodesRef.current, versionIdRef.current, null); post({ type: 'select', oid: null }) }} title="Deselect" style={{ ...btn, padding: '3px 5px', color: '#8a8a93' }}><X size={11} /></button>
                </div>
                {(node.repeated || selectedCount > 1) && (
                  <p style={{ fontSize: 11, color: '#e0a04f', margin: '6px 0 0', lineHeight: 1.5 }}>
                    This element repeats (list item) — a change applies to every copy.
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden', flexShrink: 0 }}>
                {(['design', 'content'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} style={{ ...btn, flex: 1, justifyContent: 'center', border: 'none', borderRadius: 0, background: tab === t ? 'rgba(255,255,255,.1)' : 'transparent', color: tab === t ? '#f4f4f6' : '#8a8a93' }}>
                    {t === 'design' ? 'Design' : 'Content'}
                  </button>
                ))}
              </div>

              {editError && <p style={{ fontSize: 11, color: '#f87171', margin: 0, lineHeight: 1.5 }}>{editError}</p>}

              {tab === 'design' ? (
                <>
                  <DesignPanel key={node.oid} node={node} styles={styles} theme={theme} stamp={stamp} device={device} onPreview={previewStyle} onCommit={commitStyle} />
                  <ClassesField key={`cls|${node.oid}|${node.className}`} node={node} busy={busy || saving} onEdit={(op) => void edit(op)} />
                </>
              ) : (
                <>
                  <TextField key={`${node.oid}|${node.text}`} node={node} busy={busy} onEdit={(op) => void edit(op)} />

                  <div>
                    <p style={label}>Order</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => void edit({ kind: 'move', direction: 'up' })} disabled={busy || !node.canMoveUp} style={{ ...btn, opacity: busy || !node.canMoveUp ? 0.4 : 1 }}><ArrowUp size={11} /> Move up</button>
                      <button onClick={() => void edit({ kind: 'move', direction: 'down' })} disabled={busy || !node.canMoveDown} style={{ ...btn, opacity: busy || !node.canMoveDown ? 0.4 : 1 }}><ArrowDown size={11} /> Move down</button>
                    </div>
                  </div>

                  <AddBlock
                    key={`add|${node.oid}`}
                    node={node}
                    busy={busy}
                    onInsert={(position, snippet) => void edit({ kind: 'insert', position, snippet })}
                    onImage={(file, position) => void insertImage(file, position)}
                    blocks={blocksAvailable ? blocks : null}
                    onRemoveBlock={(id) => void removeBlock(id)}
                  />

                  <AiBlock key={`ai|${node.oid}`} node={node} busy={busy} onRun={(mode, instruction) => run({ action: 'ai', mode, instruction })} />

                  {blocksAvailable && <SaveBlock key={`save|${node.oid}`} node={node} busy={busy} onSave={saveBlock} />}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <DeleteButton key={`del|${node.oid}`} disabled={busy || !node.canDelete} onDelete={() => void edit({ kind: 'delete' })} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Seconds since mount (remounted per request through its key). */
function Elapsed() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return <>{secs} s</>
}

/**
 * "Ask Quante" — a small chat box next to the selected element. Whatever the merchant
 * writes is done to that element by the AI (1 credit, refunded when it fails).
 */
function AskQuante({ tag, anchor, area, busySince, result, onSubmit, onClose }: {
  tag: string
  /** Selected element in preview-area coordinates (null = not visible). */
  anchor: { left: number; top: number; bottom: number } | null
  area: { w: number; h: number }
  busySince: number | null
  result: { ok: boolean; text: string } | null
  onSubmit: (instruction: string) => Promise<boolean>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const busy = busySince !== null
  const W = Math.min(360, Math.max(240, area.w - 16))
  const H = result ? 172 : 124
  let left = anchor ? anchor.left : area.w / 2 - W / 2
  left = Math.max(8, Math.min(left, area.w - W - 8))
  let top = anchor ? anchor.bottom + 8 : area.h - H - 12
  if (anchor && top + H > area.h - 8) top = anchor.top - H - 8
  if (top < 8) top = Math.max(8, area.h - H - 12)
  const ready = text.trim().length >= 2 && !busy
  const submit = async () => {
    if (!ready) return
    if (await onSubmit(text.trim())) setText('')
  }
  return (
    <div style={{ position: 'absolute', left, top, width: W, zIndex: 5, background: '#111114', border: '1px solid rgba(212,255,63,.35)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.55)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={12} color="#D4FF3F" />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#f4f4f6' }}>Ask Quante</span>
        <span style={{ fontSize: 10, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)' }}>&lt;{tag}&gt;</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Hide (comes back when you select another element)" style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#8a8a93', display: 'flex' }}><X size={12} /></button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
          else if (e.key === 'Escape') onClose()
        }}
        rows={2}
        maxLength={2000}
        disabled={busy}
        placeholder="What should change here? e.g. make it bigger and gold · add a “Sale” badge · change the price to 299 Kč · turn this into 3 columns"
        style={{ ...input, fontSize: 12, resize: 'none', opacity: busy ? 0.6 : 1 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {busy ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8a8a93' }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(255,255,255,.12)', borderTopColor: '#D4FF3F', animation: 'spin .8s linear infinite' }} />
            Quante is editing… <Elapsed key={busySince} />
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#5b5b64' }}>Enter to send · Shift+Enter new line · 1 credit</span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => void submit()} disabled={!ready} style={{ ...btn, padding: '4px 10px', borderColor: 'rgba(212,255,63,.45)', color: '#D4FF3F', opacity: ready ? 1 : 0.4 }}><Sparkles size={11} /> Do it</button>
      </div>
      {result && (
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: result.ok ? '#3ecf8e' : '#f87171', maxHeight: 60, overflowY: 'auto' }}>{result.text}</p>
      )}
    </div>
  )
}

/** Text of the selected element (also editable in place by double-click). */
function TextField({ node, busy, onEdit }: { node: EditorNode; busy: boolean; onEdit: (op: EditorOp) => void }) {
  const [textDraft, setTextDraft] = useState(node.text ?? '')
  const textSame = textDraft === node.text
  return (
    <div>
      <p style={label}>Text</p>
      {node.text === null ? (
        <p style={{ fontSize: 11, color: '#5b5b64', margin: 0, lineHeight: 1.5 }}>Mixed or dynamic content — select an inner element, or change it in Chat.</p>
      ) : (
        <>
          <textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} rows={3} style={input} disabled={busy} />
          <button onClick={() => onEdit({ kind: 'text', value: textDraft })} disabled={busy || textSame} style={{ ...btn, marginTop: 6, opacity: busy || textSame ? 0.5 : 1 }}>Save text</button>
          <p style={{ fontSize: 10, color: '#5b5b64', margin: '6px 0 0' }}>Tip: double-click the text in the preview to edit it right there.</p>
        </>
      )}
    </div>
  )
}

/** Raw Tailwind classes (advanced, collapsed by default). */
function ClassesField({ node, busy, onEdit }: { node: EditorNode; busy: boolean; onEdit: (op: EditorOp) => void }) {
  const [open, setOpen] = useState(false)
  const [classDraft, setClassDraft] = useState(node.className ?? '')
  const classSame = classDraft.trim() === (node.className ?? '').trim()
  if (node.className === null) return null
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#8a8a93', fontSize: 11, fontWeight: 600 }}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Advanced — classes
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea value={classDraft} onChange={(e) => setClassDraft(e.target.value)} rows={3} spellCheck={false} style={{ ...input, fontFamily: 'var(--font-geist-mono)', fontSize: 11 }} disabled={busy} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {TOKEN_HINTS.map((t) => (
              <button key={t} onClick={() => setClassDraft((c) => (c.split(/\s+/).includes(t) ? c : `${c} ${t}`.trim()))} style={{ ...btn, fontSize: 10, padding: '2px 6px', fontFamily: 'var(--font-geist-mono)' }}>+ {t}</button>
            ))}
          </div>
          <button onClick={() => onEdit({ kind: 'classes', value: classDraft })} disabled={busy || classSame} style={{ ...btn, marginTop: 8, opacity: busy || classSame ? 0.5 : 1 }}>Save classes</button>
        </div>
      )}
    </div>
  )
}

// Ready-made blocks (validated server-side like AI snippets — lib/editor/snippet.ts).
// Texts are placeholders the merchant overwrites right away (the new element is selected).
const PALETTE: Array<{ id: string; label: string; icon: React.ElementType; snippet: string }> = [
  { id: 'button', label: 'Button', icon: RectangleHorizontal, snippet: '<Link href="/collections/all" className="inline-flex items-center gap-2 bg-accent text-accent-text rounded-store px-6 py-3 font-semibold hover:opacity-90 transition">Button text <ArrowRight size={16} /></Link>' },
  { id: 'outline', label: 'Outline button', icon: RectangleHorizontal, snippet: '<Link href="/collections/all" className="inline-flex items-center gap-2 border border-border text-text rounded-store px-6 py-3 font-semibold hover:bg-surface transition">Button text</Link>' },
  { id: 'heading', label: 'Heading', icon: Heading, snippet: '<h2 className="font-heading text-3xl md:text-4xl text-text">New heading</h2>' },
  { id: 'text', label: 'Text', icon: Type, snippet: '<p className="text-muted leading-relaxed">New paragraph — click it to write your text.</p>' },
  { id: 'divider', label: 'Divider', icon: Minus, snippet: '<hr className="border-border my-8" />' },
  {
    id: 'section',
    label: 'Section',
    icon: LayoutTemplate,
    snippet: [
      '<section className="py-16 px-6 bg-surface">',
      '  <div className="max-w-3xl mx-auto text-center">',
      '    <h2 className="font-heading text-3xl md:text-4xl text-text mb-4">New section</h2>',
      '    <p className="text-muted leading-relaxed mb-8">Describe what this section is about.</p>',
      '    <Link href="/collections/all" className="inline-flex items-center gap-2 bg-accent text-accent-text rounded-store px-6 py-3 font-semibold">Button text <ArrowRight size={16} /></Link>',
      '  </div>',
      '</section>',
    ].join('\n'),
  },
]

function PositionToggle({ node, value, onChange }: { node: EditorNode; value: 'after' | 'inside'; onChange: (v: 'after' | 'inside') => void }) {
  return (
    <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden', alignSelf: 'flex-start' }}>
      {(['after', 'inside'] as const).map((p) => {
        const allowed = p === 'after' ? node.canDelete : node.canInsertInside
        return (
          <button key={p} disabled={!allowed} onClick={() => onChange(p)} style={{ ...btn, border: 'none', borderRadius: 0, fontSize: 10, padding: '3px 8px', opacity: allowed ? 1 : 0.35, background: value === p ? 'rgba(212,255,63,.16)' : 'transparent' }}>
            {p === 'after' ? 'After this' : 'Inside this'}
          </button>
        )
      })}
    </div>
  )
}

/** "Add element": ready-made blocks and an image upload, after / inside the selection. */
function AddBlock({ node, busy, onInsert, onImage, blocks, onRemoveBlock }: {
  node: EditorNode
  busy: boolean
  onInsert: (position: 'after' | 'inside', snippet: string) => void
  onImage: (file: File, position: 'after' | 'inside') => void
  /** The merchant's saved elements; null = feature not set up (migration pending). */
  blocks: SavedBlock[] | null
  onRemoveBlock: (id: string) => void
}) {
  const [position, setPosition] = useState<'after' | 'inside'>(node.canDelete ? 'after' : 'inside')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const possible = node.canDelete || node.canInsertInside
  return (
    <div>
      <p style={label}>Add element</p>
      {!possible ? (
        <p style={{ fontSize: 11, color: '#5b5b64', margin: 0 }}>Nothing can be added here — select a container or a neighbouring element.</p>
      ) : (
        <>
          <PositionToggle node={node} value={position} onChange={setPosition} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 8 }}>
            {PALETTE.map((b) => (
              <button key={b.id} disabled={busy} onClick={() => onInsert(position, b.snippet)} style={{ ...btn, justifyContent: 'flex-start', fontWeight: 500, opacity: busy ? 0.5 : 1 }}>
                <b.icon size={11} /> {b.label}
              </button>
            ))}
            <button disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...btn, justifyContent: 'flex-start', fontWeight: 500, opacity: busy ? 0.5 : 1 }}>
              <ImagePlus size={11} /> Image
            </button>
          </div>
          {blocks && (
            <>
              <p style={{ ...label, margin: '12px 0 6px' }}>My elements</p>
              {blocks.length === 0 ? (
                <p style={{ fontSize: 11, color: '#5b5b64', margin: 0, lineHeight: 1.5 }}>Nothing saved yet — select an element you like and use “Save to My elements”.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                  {blocks.map((b) => (
                    <div key={b.id} style={{ display: 'flex', gap: 4 }}>
                      <button disabled={busy} onClick={() => onInsert(position, b.snippet)} title="Insert" style={{ ...btn, flex: 1, minWidth: 0, justifyContent: 'flex-start', fontWeight: 500, opacity: busy ? 0.5 : 1 }}>
                        <Bookmark size={11} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      </button>
                      <button onClick={() => onRemoveBlock(b.id)} title="Remove from My elements (the store is not changed)" style={{ ...btn, color: '#8a8a93', padding: '5px 7px' }}><X size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImage(f, position) }}
          />
        </>
      )}
    </div>
  )
}

/** "Create with AI": the model writes a static element after / inside / instead of the selection. */
function AiBlock({ node, busy, onRun }: { node: EditorNode; busy: boolean; onRun: (mode: 'after' | 'inside' | 'replace', instruction: string) => Promise<boolean> }) {
  const [prompt, setPrompt] = useState('')
  const ready = prompt.trim().length >= 3 && !busy
  const go = async (mode: 'after' | 'inside' | 'replace') => { if (await onRun(mode, prompt.trim())) setPrompt('') }
  return (
    <div>
      <p style={label}>✦ Create with AI <span style={{ color: '#5b5b64', textTransform: 'none', letterSpacing: 0 }}>· 1 credit</span></p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        disabled={busy}
        placeholder="e.g. a gold “Shop now” button with an arrow · three benefit cards with icons · a customer quote"
        style={input}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
        <button disabled={!ready || !node.canDelete} onClick={() => void go('after')} style={{ ...btn, opacity: ready && node.canDelete ? 1 : 0.4 }}><Sparkles size={11} /> Add after</button>
        <button disabled={!ready || !node.canInsertInside} onClick={() => void go('inside')} style={{ ...btn, opacity: ready && node.canInsertInside ? 1 : 0.4 }}><Sparkles size={11} /> Add inside</button>
        <button disabled={!ready || !node.static} title={node.static ? '' : 'Shows live data — rewrite it in Chat'} onClick={() => void go('replace')} style={{ ...btn, opacity: ready && node.static ? 1 : 0.4 }}><Sparkles size={11} /> Rewrite this</button>
      </div>
      {busy && <p style={{ fontSize: 11, color: '#8a8a93', margin: '6px 0 0' }}>Working…</p>}
    </div>
  )
}

/** "Save to My elements": stores the selected plain element for reuse in any store. */
function SaveBlock({ node, busy, onSave }: { node: EditorNode; busy: boolean; onSave: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState((node.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40))
  const [saved, setSaved] = useState(false)
  const ready = name.trim().length > 0 && !busy && node.static
  return (
    <div>
      <p style={label}>Save to My elements</p>
      {!node.static ? (
        <p style={{ fontSize: 11, color: '#5b5b64', margin: 0, lineHeight: 1.5 }}>This element shows live data or code — only plain elements (text, buttons, images, sections you built) can be saved.</p>
      ) : (
        <div style={{ display: 'flex', gap: 5 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} maxLength={60} placeholder="Name, e.g. Gold CTA button" disabled={busy} style={{ ...input, flex: 1, minWidth: 0 }} />
          <button disabled={!ready || saved} onClick={() => void onSave(name.trim()).then((ok) => setSaved(ok))} style={{ ...btn, opacity: ready && !saved ? 1 : 0.4, flexShrink: 0 }}>
            {saved ? <><Check size={11} /> Saved</> : <><BookmarkPlus size={11} /> Save</>}
          </button>
        </div>
      )}
    </div>
  )
}

/** Two-step delete (no browser confirm dialog). */
function DeleteButton({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  return armed ? (
    <button onClick={() => { setArmed(false); onDelete() }} style={{ ...btn, color: '#f87171', borderColor: 'rgba(248,113,113,.5)' }}><Trash2 size={11} /> Confirm delete</button>
  ) : (
    <button disabled={disabled} onClick={() => setArmed(true)} style={{ ...btn, color: '#f87171', opacity: disabled ? 0.4 : 1 }}><Trash2 size={11} /> Delete</button>
  )
}
