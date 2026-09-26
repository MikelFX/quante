'use client'

// Visual editor v1 (2026-09-26): the store runs in a Vercel Sandbox (`next dev`, hot
// reload) with data-oid instrumentation; clicking an element selects it, and text /
// class / order edits are written straight into the store's code as a draft version
// (/api/projects/[id]/editor). Nothing reaches shoppers until Publish.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MousePointer2, Hand, RotateCcw, X, Check } from 'lucide-react'
import { EDITOR_MESSAGE_SOURCE } from '@/lib/editor/bridge'
import type { EditorNode, EditorOp } from '@/lib/editor/oid'

interface Props {
  projectId: string
  onExit: () => void
  /** A draft version was saved (refresh version list / publish state). */
  onSaved: (versionNo: number) => void
}

type Phase = 'starting' | 'ready' | 'error'

const TOKEN_HINTS = ['bg-accent', 'text-accent', 'text-muted', 'bg-surface', 'border-border', 'rounded-store', 'font-heading']

const panel: React.CSSProperties = { background: '#0d0d11', borderLeft: '1px solid rgba(255,255,255,.07)' }
const label: React.CSSProperties = { fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: '0 0 6px' }
const input: React.CSSProperties = { width: '100%', background: '#08080a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: '#f4f4f6', fontSize: 12, padding: '7px 8px', outline: 'none', resize: 'vertical' }
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: '#f4f4f6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }

export function VisualEditor({ projectId, onExit, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [nodes, setNodes] = useState<Record<string, EditorNode>>({})
  const [versionId, setVersionId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCount, setSelectedCount] = useState(1)
  const [selectMode, setSelectMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const startedRef = useRef(false)

  const api = useCallback(async (payload: Record<string, unknown>, keepalive = false) => {
    const res = await fetch(`/api/projects/${projectId}/editor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive,
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }, [projectId])

  const start = useCallback(async () => {
    setPhase('starting')
    setError(null)
    setSelected(null)
    try {
      const { res, data } = await api({ action: 'start' })
      if (!res.ok) { setPhase('error'); setError(data.error ?? `The editor could not start (${res.status}).`); return }
      setUrl(data.url)
      setNodes(data.nodes ?? {})
      setVersionId(data.versionId)
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

  useEffect(() => {
    if (!url) return
    const origin = new URL(url).origin
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return
      const d = e.data as { source?: unknown; type?: unknown; oid?: unknown; count?: unknown } | null
      if (!d || d.source !== EDITOR_MESSAGE_SOURCE) return
      if (d.type === 'ready') {
        post({ type: 'mode', edit: selectMode })
        if (selected) post({ type: 'select', oid: selected })
      } else if (d.type === 'select' && typeof d.oid === 'string') {
        setSelected(d.oid)
        setSelectedCount(typeof d.count === 'number' ? d.count : 1)
        setEditError(null)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [url, post, selectMode, selected])

  useEffect(() => { post({ type: 'mode', edit: selectMode }) }, [selectMode, post])

  const node = selected ? nodes[selected] : undefined

  async function edit(op: EditorOp) {
    if (!node || !versionId || busy) return
    setBusy(true)
    setEditError(null)
    try {
      const { res, data } = await api({ action: 'edit', oid: node.oid, tag: node.tag, op, baseVersionId: versionId })
      if (res.status === 409 && data.code === 'stale') { setEditError(data.error); await start(); return }
      if (!res.ok) { setEditError(data.error ?? `Edit failed (${res.status}).`); return }
      setNodes(data.nodes ?? {})
      setVersionId(data.versionId)
      setSelected(data.selectOid ?? null)
      post({ type: 'select', oid: data.selectOid })
      setSavedNote(`Saved to draft v${data.versionNo}`)
      onSaved(data.versionNo)
      if (data.sessionLost) await start()
    } catch {
      setEditError('Edit failed — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const fileLabel = node ? node.file.replace(/^components\/store\//, '').replace(/\.tsx$/, '') : ''

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#09090c' }}>
      {/* Toolbar */}
      <div style={{ flexShrink: 0, height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid rgba(255,255,255,.06)', background: '#0d0d11' }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 700, letterSpacing: '.05em', color: '#D4FF3F', textTransform: 'uppercase' }}>Visual edit</span>
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden' }}>
          <button onClick={() => setSelectMode(true)} title="Click elements to select them" style={{ ...btn, border: 'none', borderRadius: 0, background: selectMode ? 'rgba(212,255,63,.16)' : 'transparent' }}><MousePointer2 size={11} /> Select</button>
          <button onClick={() => setSelectMode(false)} title="Use the store normally (links, menus)" style={{ ...btn, border: 'none', borderRadius: 0, borderLeft: '1px solid rgba(255,255,255,.08)', background: !selectMode ? 'rgba(212,255,63,.16)' : 'transparent' }}><Hand size={11} /> Browse</button>
        </div>
        <button onClick={() => setFrameKey((k) => k + 1)} title="Reload the preview" style={btn}><RotateCcw size={11} /></button>
        <span style={{ flex: 1 }} />
        {savedNote && <span style={{ fontSize: 11, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>{savedNote}</span>}
        <button onClick={done} style={{ ...btn, borderColor: 'rgba(212,255,63,.35)', color: '#D4FF3F' }}><Check size={11} /> Done</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Preview */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {phase === 'ready' && url ? (
            <iframe key={frameKey} ref={frameRef} src={url} title="Visual editor preview" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
          ) : (
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
          )}
        </div>

        {/* Inspector */}
        <div style={{ ...panel, width: 290, flexShrink: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 11, color: '#8a8a93', margin: 0, lineHeight: 1.6 }}>
            Click any element in the preview. Changes are written into your store&apos;s code as a <b style={{ color: '#D4FF3F' }}>draft</b> — click Publish to make them live.
          </p>

          {!node ? (
            <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>{phase === 'ready' ? 'Nothing selected.' : ''}</p>
          ) : (
            <>
              <div>
                <p style={label}>Selected</p>
                <p style={{ fontSize: 13, color: '#f4f4f6', margin: 0, fontFamily: 'var(--font-geist-mono)' }}>&lt;{node.tag}&gt;</p>
                <p style={{ fontSize: 10, color: '#5b5b64', margin: '3px 0 0', fontFamily: 'var(--font-geist-mono)' }}>{fileLabel}</p>
                {(node.repeated || selectedCount > 1) && (
                  <p style={{ fontSize: 11, color: '#e0a04f', margin: '6px 0 0', lineHeight: 1.5 }}>
                    This element repeats (list item) — an edit changes every copy.
                  </p>
                )}
              </div>

              <NodeFields key={`${node.oid}|${node.text}|${node.className}`} node={node} busy={busy} onEdit={(op) => void edit(op)} />

              <div>
                <p style={label}>Order</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void edit({ kind: 'move', direction: 'up' })} disabled={busy || !node.canMoveUp} style={{ ...btn, opacity: busy || !node.canMoveUp ? 0.4 : 1 }}><ArrowUp size={11} /> Move up</button>
                  <button onClick={() => void edit({ kind: 'move', direction: 'down' })} disabled={busy || !node.canMoveDown} style={{ ...btn, opacity: busy || !node.canMoveDown ? 0.4 : 1 }}><ArrowDown size={11} /> Move down</button>
                </div>
              </div>

              {editError && <p style={{ fontSize: 11, color: '#f87171', margin: 0, lineHeight: 1.5 }}>{editError}</p>}
              <button onClick={() => { setSelected(null); post({ type: 'select', oid: null }) }} style={{ ...btn, alignSelf: 'flex-start', color: '#8a8a93' }}><X size={11} /> Deselect</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Text + class inputs of the selected element; remounted (fresh drafts) when it changes. */
function NodeFields({ node, busy, onEdit }: { node: EditorNode; busy: boolean; onEdit: (op: EditorOp) => void }) {
  const [textDraft, setTextDraft] = useState(node.text ?? '')
  const [classDraft, setClassDraft] = useState(node.className ?? '')
  const textSame = textDraft === node.text
  const classSame = classDraft.trim() === (node.className ?? '').trim()
  return (
    <>
      <div>
        <p style={label}>Text</p>
        {node.text === null ? (
          <p style={{ fontSize: 11, color: '#5b5b64', margin: 0, lineHeight: 1.5 }}>Mixed or dynamic content — select an inner element, or change it in Chat.</p>
        ) : (
          <>
            <textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} rows={3} style={input} disabled={busy} />
            <button onClick={() => onEdit({ kind: 'text', value: textDraft })} disabled={busy || textSame} style={{ ...btn, marginTop: 6, opacity: busy || textSame ? 0.5 : 1 }}>Save text</button>
          </>
        )}
      </div>

      <div>
        <p style={label}>Classes</p>
        {node.className === null ? (
          <p style={{ fontSize: 11, color: '#5b5b64', margin: 0, lineHeight: 1.5 }}>Classes are built in code here — change them in Chat.</p>
        ) : (
          <>
            <textarea value={classDraft} onChange={(e) => setClassDraft(e.target.value)} rows={3} spellCheck={false} style={{ ...input, fontFamily: 'var(--font-geist-mono)', fontSize: 11 }} disabled={busy} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {TOKEN_HINTS.map((t) => (
                <button key={t} onClick={() => setClassDraft((c) => (c.split(/\s+/).includes(t) ? c : `${c} ${t}`.trim()))} style={{ ...btn, fontSize: 10, padding: '2px 6px', fontFamily: 'var(--font-geist-mono)' }}>+ {t}</button>
              ))}
            </div>
            <button onClick={() => onEdit({ kind: 'classes', value: classDraft })} disabled={busy || classSame} style={{ ...btn, marginTop: 8, opacity: busy || classSame ? 0.5 : 1 }}>Save classes</button>
          </>
        )}
      </div>
    </>
  )
}
