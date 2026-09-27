'use client'

// Visual editor (v1 2026-09-26, v2 + v3 2026-09-27): the store runs in a Vercel Sandbox
// (`next dev`, hot reload) with data-oid instrumentation; clicking an element selects it.
// Text / class / order edits, ready-made blocks, images, 'Create with AI' and deletes are
// written straight into the store's code as a draft version (/api/projects/[id]/editor).
// "My elements" (v3): any plain element can be saved (/api/editor-blocks) and inserted
// again in any of the merchant's stores. Nothing reaches shoppers until Publish.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MousePointer2, Hand, RotateCcw, X, Check, ImagePlus, Sparkles, Trash2, Heading, Type, Minus, RectangleHorizontal, LayoutTemplate, Bookmark, BookmarkPlus } from 'lucide-react'
import { EDITOR_MESSAGE_SOURCE } from '@/lib/editor/bridge'
import type { EditorNode, EditorOp } from '@/lib/editor/oid'

interface Props {
  projectId: string
  onExit: () => void
  /** A draft version was saved (refresh version list / publish state). */
  onSaved: (versionNo: number) => void
}

type Phase = 'starting' | 'ready' | 'error'

/** A saved "My elements" block (lib/editor/blocks.ts). */
interface SavedBlock { id: string; name: string; snippet: string }

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
  const [blocks, setBlocks] = useState<SavedBlock[]>([])
  const [blocksAvailable, setBlocksAvailable] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const startedRef = useRef(false)

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

  async function run(payload: Record<string, unknown>): Promise<boolean> {
    if (!node || !versionId || busy) return false
    setBusy(true)
    setEditError(null)
    try {
      const { res, data } = await api({ ...payload, oid: node.oid, tag: node.tag, baseVersionId: versionId })
      if (res.status === 409 && data.code === 'stale') { setEditError(data.error); await start(); return false }
      if (!res.ok) { setEditError(data.error ?? `Edit failed (${res.status}).`); return false }
      setNodes(data.nodes ?? {})
      setVersionId(data.versionId)
      setSelected(data.selectOid ?? null)
      post({ type: 'select', oid: data.selectOid ?? null })
      setSavedNote(`Saved to draft v${data.versionNo}`)
      onSaved(data.versionNo)
      if (data.sessionLost) await start()
      return true
    } catch {
      setEditError('Edit failed — check your connection.')
      return false
    } finally {
      setBusy(false)
    }
  }
  const edit = (op: EditorOp) => run({ action: 'edit', op })

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
    if (!node || !versionId || busy) return false
    setBusy(true)
    setEditError(null)
    try {
      const { res, data } = await api({ action: 'save_block', oid: node.oid, tag: node.tag, name, baseVersionId: versionId })
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

              {editError && <p style={{ fontSize: 11, color: '#f87171', margin: 0, lineHeight: 1.5 }}>{editError}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => { setSelected(null); post({ type: 'select', oid: null }) }} style={{ ...btn, color: '#8a8a93' }}><X size={11} /> Deselect</button>
                <DeleteButton key={`del|${node.oid}`} disabled={busy || !node.canDelete} onDelete={() => void edit({ kind: 'delete' })} />
              </div>
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
