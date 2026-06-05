'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { ShopManifest, Section } from '@/types/manifest'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
  type?: 'status' | 'error' | 'done'
}

interface VersionEntry {
  id: string
  version_no: number
  prompt: string
  created_at: string
}

type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; manifest?: ShopManifest; projectId?: string; versionId?: string }
  | { type: 'error'; message: string }

interface Props {
  projectId: string
  projectName: string
  initialManifest: ShopManifest | null
  initialBalance: number
}

type StudioTab = 'chat' | 'preview' | 'sections'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function* readNdjsonStream(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { yield JSON.parse(line) as StreamEvent } catch {}
    }
  }
  if (buffer.trim()) {
    try { yield JSON.parse(buffer) as StreamEvent } catch {}
  }
}

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero', productGrid: 'Product grid', featureRow: 'Feature row',
  testimonials: 'Testimonials', richText: 'Rich text', banner: 'Banner',
  newsletter: 'Newsletter', gallery: 'Gallery', faq: 'FAQ', customComponent: 'Custom',
}

function sectionSummary(section: Section): string {
  switch (section.type) {
    case 'hero': return section.props.headline.replace(/\n/g, ' ').slice(0, 48)
    case 'productGrid': return section.props.title || 'Product grid'
    case 'featureRow': return `${section.props.features.length} features${section.props.title ? ` · ${section.props.title}` : ''}`
    case 'testimonials': return `${section.props.items.length} reviews`
    case 'richText': return section.props.content.replace(/\n/g, ' ').slice(0, 48)
    case 'banner': return section.props.text.slice(0, 48)
    case 'newsletter': return section.props.title
    case 'gallery': return `${section.props.images.length} images`
    case 'faq': return `${section.props.items.length} items`
    case 'customComponent': return `ref: ${section.ref}`
  }
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudioClient({ projectId, projectName, initialManifest, initialBalance }: Props) {
  const [messages, setMessages] = useState<Message[]>(() =>
    initialManifest
      ? [{ role: 'assistant', content: `Store **${initialManifest.brand.name}** loaded. What would you like to change?` }]
      : []
  )
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [balance, setBalance] = useState(initialBalance)
  const [currentManifest, setCurrentManifest] = useState<ShopManifest | null>(initialManifest)
  const [activeTab, setActiveTab] = useState<StudioTab>('chat')
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [expandedSection, setExpandedSection] = useState<number | null>(null)
  const [sectionInput, setSectionInput] = useState('')
  const [regeneratingSection, setRegeneratingSection] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`)
      if (res.ok) setVersions(await res.json())
    } catch {}
  }, [projectId])

  const refreshBalance = useCallback(() => {
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => { if (typeof d.balance === 'number') setBalance(d.balance) })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchVersions() }, [fetchVersions])

  async function consumeStream(
    endpoint: string,
    body: object,
    onDone: (manifest: ShopManifest) => void,
    onError?: (msg: string) => void
  ) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.body) throw new Error('No stream')

    for await (const event of readNdjsonStream(response)) {
      if (event.type === 'status') {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: event.text, type: 'status' }
          return updated
        })
      } else if (event.type === 'error') {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: event.message, type: 'error' }
          return updated
        })
        onError?.(event.message)
        return
      } else if (event.type === 'done' && event.manifest) {
        onDone(event.manifest)
        return
      }
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || isGenerating) return

    setInput('')
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '…', type: 'status' },
    ])
    setIsGenerating(true)

    const hasManifest = !!currentManifest
    const endpoint = hasManifest ? '/api/quante/iterate' : '/api/quante/generate'
    const body = hasManifest ? { projectId, instruction: text } : { brief: text, projectId }

    try {
      await consumeStream(endpoint, body, (manifest) => {
        const summary = `**${manifest.brand.name}** ready. ${manifest.catalog.products.length} products.`
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: summary, type: 'done' }
          return updated
        })
        setCurrentManifest(manifest)
        setIframeKey((k) => k + 1)
        refreshBalance()
        fetchVersions()
        // Auto-switch to preview after generation
        setActiveTab('preview')
      })
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Try again.', type: 'error' }
        return updated
      })
    } finally {
      setIsGenerating(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  async function handleSectionRegenerate(sectionIndex: number, instruction: string) {
    if (isGenerating) return
    setIsGenerating(true)
    setRegeneratingSection(sectionIndex)
    setExpandedSection(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: instruction || `Improve section ${sectionIndex + 1}` },
      { role: 'assistant', content: 'Regenerating section…', type: 'status' },
    ])

    try {
      await consumeStream(
        '/api/quante/section',
        { projectId, page: 'home', sectionIndex, instruction },
        (manifest) => {
          const sectionName = SECTION_LABELS[(manifest.pages.home[sectionIndex] as { type: string })?.type ?? ''] ?? 'Section'
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: `**${sectionName}** regenerated.`,
              type: 'done',
            }
            return updated
          })
          setCurrentManifest(manifest)
          setIframeKey((k) => k + 1)
          setSectionInput('')
          refreshBalance()
          fetchVersions()
        }
      )
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Section regeneration failed.', type: 'error' }
        return updated
      })
    } finally {
      setIsGenerating(false)
      setRegeneratingSection(null)
    }
  }

  async function handleRestore(versionId: string) {
    setShowVersions(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })
      if (res.ok) {
        const { manifest } = await res.json()
        setCurrentManifest(manifest)
        setIframeKey((k) => k + 1)
        fetchVersions()
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Version restored.', type: 'done' }])
      }
    } catch {}
  }

  async function handleExport() {
    if (!currentManifest || isExporting) return
    setIsExporting(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Export failed.')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'store.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      refreshBalance()
    } catch {
      alert('Export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  const homeSections = currentManifest?.pages.home ?? []
  const latestVersion = versions[0]

  return (
    // Covers full screen from top to bottom nav
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: '4rem',
      zIndex: 30, display: 'flex', flexDirection: 'column',
      background: 'var(--background)',
    }}>
      {/* ── Studio top bar ── */}
      <header style={{
        flexShrink: 0, height: '3rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0.875rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--background)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Version picker */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { const next = !showVersions; setShowVersions(next); if (next) fetchVersions() }}
              style={{
                fontFamily: 'var(--font-geist-mono)', fontSize: 11,
                padding: '3px 8px', borderRadius: 5,
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
                background: 'transparent', cursor: 'pointer',
              }}
            >
              {latestVersion ? `v${latestVersion.version_no}` : 'v—'} ▾
            </button>

            {showVersions && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowVersions(false)} />
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: 4,
                  width: 280, background: 'var(--card)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,.4)', zIndex: 50, overflow: 'hidden',
                }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.04em' }}>History</p>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {versions.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: 12 }}>No versions yet.</p>
                    ) : versions.map((v) => (
                      <div key={v.id} style={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                        padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.05)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: 'var(--muted-foreground)' }}>v{v.version_no}</p>
                          <p style={{ fontSize: 12, color: 'var(--foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.prompt || 'Generated'}
                          </p>
                          <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 2 }}>{timeAgo(v.created_at)}</p>
                        </div>
                        {versions[0]?.id !== v.id ? (
                          <button onClick={() => handleRestore(v.id)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                            Restore
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0 }}>current</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: 'var(--muted-foreground)' }}>
            {balance} cr
          </span>

          <button
            onClick={handleExport}
            disabled={!currentManifest || isExporting}
            style={{
              fontSize: 11, fontWeight: 600,
              padding: '4px 10px', borderRadius: 5,
              border: '1px solid rgba(255,255,255,.15)',
              background: currentManifest && !isExporting ? 'rgba(255,255,255,.06)' : 'transparent',
              color: currentManifest && !isExporting ? 'var(--foreground)' : 'var(--muted-foreground)',
              cursor: currentManifest && !isExporting ? 'pointer' : 'not-allowed',
              opacity: currentManifest ? 1 : 0.4,
            }}
          >
            {isExporting ? '…' : 'Export'}
          </button>
        </div>
      </header>

      {/* ── Tab switcher ── */}
      <div style={{
        flexShrink: 0, display: 'flex',
        borderBottom: '1px solid var(--border)',
      }}>
        {(['chat', 'preview', 'sections'] as StudioTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '0.55rem 0', fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === tab ? 'var(--foreground)' : 'var(--muted-foreground)',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              textTransform: 'capitalize', transition: 'color 0.15s',
            }}
          >
            {tab}
            {tab === 'preview' && currentManifest && isGenerating && (
              <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.6 }}>●</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 6 }}>quante</p>
                  <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Describe the store you want to build.</p>
                  <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4, opacity: 0.6 }}>Brand, products, vibe, currency.</p>
                </div>
              )}
              {messages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ flexShrink: 0, padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  disabled={isGenerating}
                  placeholder={!currentManifest ? 'Minimal skincare brand, 3 products, EUR…' : 'Change accent to deep green…'}
                  rows={3}
                  style={{
                    flex: 1, resize: 'none', fontSize: 14, borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--secondary)',
                    color: 'var(--foreground)', padding: '8px 10px',
                    outline: 'none', fontFamily: 'inherit',
                    opacity: isGenerating ? 0.5 : 1,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={isGenerating || !input.trim()}
                  style={{
                    flexShrink: 0, padding: '8px 14px', fontSize: 13, fontWeight: 600,
                    borderRadius: 8, border: 'none', cursor: isGenerating || !input.trim() ? 'not-allowed' : 'pointer',
                    background: 'var(--primary)', color: 'var(--primary-foreground)',
                    opacity: isGenerating || !input.trim() ? 0.4 : 1,
                  }}
                >
                  {isGenerating ? '…' : '→'}
                </button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 6 }}>
                {!currentManifest ? '10 credits' : '1 credit'} · shift+enter for newline
              </p>
            </div>
          </>
        )}

        {/* PREVIEW TAB */}
        {activeTab === 'preview' && (
          <div style={{ flex: 1, position: 'relative', background: '#111', overflow: 'hidden' }}>
            {!currentManifest ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
                <div>
                  <p style={{ color: 'rgba(255,255,255,.25)', fontSize: 13, fontFamily: 'var(--font-geist-mono)' }}>no preview yet</p>
                  <button
                    onClick={() => setActiveTab('chat')}
                    style={{ marginTop: 12, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Generate a store →
                  </button>
                </div>
              </div>
            ) : (
              <iframe
                key={iframeKey}
                src={`/preview/${projectId}`}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Store preview"
              />
            )}
            {isGenerating && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(4px)',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,.2)', borderTopColor: 'rgba(255,255,255,.8)',
                    animation: 'spin 0.8s linear infinite', margin: '0 auto 10px',
                  }} />
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', fontFamily: 'var(--font-geist-mono)' }}>generating…</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTIONS TAB */}
        {activeTab === 'sections' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!currentManifest ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Generate a store first.</p>
                <button onClick={() => setActiveTab('chat')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 8 }}>
                  Go to Chat →
                </button>
              </div>
            ) : (
              <>
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                    Home · {homeSections.length} sections · 2 credits each
                  </p>
                </div>
                {homeSections.map((section, i) => (
                  <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>
                          {SECTION_LABELS[section.type] ?? section.type}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sectionSummary(section)}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (expandedSection === i) { setExpandedSection(null); setSectionInput('') }
                          else { setExpandedSection(i); setSectionInput('') }
                        }}
                        disabled={isGenerating}
                        style={{
                          flexShrink: 0, marginLeft: 10, fontSize: 11, padding: '5px 12px',
                          borderRadius: 6, border: '1px solid var(--border)',
                          background: 'none', color: 'var(--muted-foreground)', cursor: isGenerating ? 'not-allowed' : 'pointer',
                          opacity: regeneratingSection === i ? 0.5 : isGenerating ? 0.4 : 1,
                        }}
                      >
                        {regeneratingSection === i ? '…' : 'Improve'}
                      </button>
                    </div>

                    {expandedSection === i && (
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <textarea
                          value={sectionInput}
                          onChange={(e) => setSectionInput(e.target.value)}
                          placeholder="Describe what to change, or leave blank for auto-improvement"
                          rows={2}
                          autoFocus
                          style={{
                            width: '100%', resize: 'none', fontSize: 12,
                            borderRadius: 6, border: '1px solid var(--border)',
                            background: 'var(--secondary)', color: 'var(--foreground)',
                            padding: '7px 10px', outline: 'none', fontFamily: 'inherit',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => handleSectionRegenerate(i, sectionInput)}
                            disabled={isGenerating}
                            style={{
                              flex: 1, fontSize: 12, fontWeight: 600, padding: '7px',
                              borderRadius: 6, border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer',
                              background: 'var(--primary)', color: 'var(--primary-foreground)',
                              opacity: isGenerating ? 0.4 : 1,
                            }}
                          >
                            Regenerate
                          </button>
                          <button
                            onClick={() => { setExpandedSection(null); setSectionInput('') }}
                            style={{
                              fontSize: 12, padding: '7px 14px', borderRadius: 6,
                              border: '1px solid var(--border)', background: 'none',
                              color: 'var(--muted-foreground)', cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const isError = message.type === 'error'
  const isStatus = message.type === 'status'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '88%', borderRadius: 10, padding: '8px 12px',
        fontSize: isStatus ? 12 : 14, lineHeight: 1.5,
        background: isUser ? 'var(--primary)' : isError ? 'rgba(220,60,60,.12)' : isStatus ? 'transparent' : 'var(--secondary)',
        color: isUser ? 'var(--primary-foreground)' : isError ? '#f87171' : isStatus ? 'var(--muted-foreground)' : 'var(--foreground)',
        border: isError ? '1px solid rgba(220,60,60,.25)' : 'none',
        fontStyle: isStatus ? 'italic' : 'normal',
      }}>
        {message.content.split('**').map((part, i) =>
          i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
        )}
      </div>
    </div>
  )
}
