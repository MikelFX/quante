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
  hero: 'Hero',
  productGrid: 'Product grid',
  featureRow: 'Feature row',
  testimonials: 'Testimonials',
  richText: 'Rich text',
  banner: 'Banner',
  newsletter: 'Newsletter',
  gallery: 'Gallery',
  faq: 'FAQ',
  customComponent: 'Custom',
}

function sectionSummary(section: Section): string {
  switch (section.type) {
    case 'hero': return section.props.headline.replace(/\n/g, ' ').slice(0, 48)
    case 'productGrid': return section.props.title || 'Product grid'
    case 'featureRow': return `${section.props.features.length} features${section.props.title ? ` · ${section.props.title}` : ''}`
    case 'testimonials': return `${section.props.items.length} reviews${section.props.title ? ` · ${section.props.title}` : ''}`
    case 'richText': return section.props.content.replace(/\n/g, ' ').slice(0, 48)
    case 'banner': return section.props.text.slice(0, 48)
    case 'newsletter': return section.props.title
    case 'gallery': return `${section.props.images.length} images`
    case 'faq': return `${section.props.items.length} items${section.props.title ? ` · ${section.props.title}` : ''}`
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
  const [activeTab, setActiveTab] = useState<'chat' | 'sections'>('chat')
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

  // Shared stream consumer — updates the last assistant message with status/done/error
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
        const summary = `**${manifest.brand.name}** — ${manifest.catalog.products.length} products. Preview refreshed.`
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: summary, type: 'done' }
          return updated
        })
        setCurrentManifest(manifest)
        setIframeKey((k) => k + 1)
        refreshBalance()
        fetchVersions()
      })
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Please try again.', type: 'error' }
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

    // Add status messages to chat as context
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
              content: `**${sectionName}** regenerated. Preview refreshed.`,
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
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Version restored. Preview updated.', type: 'done' },
        ])
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
        alert(data.error ?? 'Export failed. Please try again.')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'store.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      refreshBalance()
    } catch {
      alert('Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const homeSections = currentManifest?.pages.home ?? []
  const latestVersion = versions[0]

  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>
      {/* ── Top bar ── */}
      <header
        className="shrink-0 border-b border-border px-4 flex items-center justify-between"
        style={{ height: '3.25rem' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">{projectName}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Version history */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !showVersions
                setShowVersions(next)
                if (next) fetchVersions()
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {latestVersion ? `v${latestVersion.version_no}` : 'v—'}
              <span className="text-muted-foreground/50">▾</span>
            </button>

            {showVersions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowVersions(false)} />
                <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Version history</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {versions.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3">No versions yet.</p>
                    ) : (
                      versions.map((v) => (
                        <div
                          key={v.id}
                          className="flex items-start justify-between gap-2 px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/50 last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-mono text-muted-foreground">v{v.version_no}</p>
                            <p className="text-xs text-foreground truncate mt-0.5">{v.prompt || 'Generated'}</p>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">{timeAgo(v.created_at)}</p>
                          </div>
                          {versions[0]?.id !== v.id && (
                            <button
                              onClick={() => handleRestore(v.id)}
                              className="shrink-0 text-xs text-accent hover:text-accent/80 transition-colors mt-0.5"
                            >
                              Restore
                            </button>
                          )}
                          {versions[0]?.id === v.id && (
                            <span className="shrink-0 text-xs text-muted-foreground/40 mt-0.5">current</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <span className="text-xs font-mono text-muted-foreground">{balance} cr</span>

          <button
            className={cn(
              'text-xs px-3 py-1.5 rounded border border-border transition-colors',
              currentManifest && !isExporting
                ? 'text-foreground border-white/20 hover:bg-white/5'
                : 'text-muted-foreground opacity-50 cursor-not-allowed'
            )}
            onClick={handleExport}
            disabled={!currentManifest || isExporting}
            title={!currentManifest ? 'Generate a store first' : 'Download as ZIP (5 credits)'}
          >
            {isExporting ? 'Exporting…' : 'Export ZIP'}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex flex-col border-r border-border shrink-0" style={{ width: '380px' }}>
          {/* Tabs */}
          <div className="shrink-0 flex border-b border-border">
            {(['chat', 'sections'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex-1 py-2 text-xs font-medium capitalize transition-colors',
                  activeTab === tab
                    ? 'text-foreground border-b-2 border-accent'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Chat tab */}
          {activeTab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-12 px-4">
                    <p className="text-sm font-mono text-muted-foreground mb-2">quante</p>
                    <p className="text-sm text-muted-foreground">Describe the store you want to build.</p>
                    <p className="text-xs text-muted-foreground mt-1">Brand, products, vibe, currency.</p>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <ChatMessage key={i} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="shrink-0 p-3 border-t border-border">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                    }}
                    disabled={isGenerating}
                    placeholder={
                      !currentManifest
                        ? 'A minimal skincare brand. Products: serum, moisturiser, cleanser. EUR currency…'
                        : 'Change the accent color to deep green…'
                    }
                    rows={3}
                    className={cn(
                      'flex-1 resize-none text-sm rounded border border-border bg-secondary/50 px-3 py-2 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                      isGenerating && 'opacity-50 cursor-not-allowed'
                    )}
                  />
                  <button
                    onClick={handleSend}
                    disabled={isGenerating || !input.trim()}
                    className={cn(
                      'shrink-0 px-3 py-2 text-xs font-semibold rounded bg-primary text-primary-foreground',
                      (isGenerating || !input.trim()) && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    {isGenerating ? '…' : 'Send'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {!currentManifest ? '10 credits' : '1 credit'} · shift+enter for newline
                </p>
              </div>
            </>
          )}

          {/* Sections tab */}
          {activeTab === 'sections' && (
            <div className="flex-1 overflow-y-auto">
              {!currentManifest ? (
                <div className="text-center py-12 px-4">
                  <p className="text-sm text-muted-foreground">Generate a store first.</p>
                  <button
                    className="text-xs text-accent hover:text-accent/80 transition-colors mt-2"
                    onClick={() => setActiveTab('chat')}
                  >
                    Go to Chat
                  </button>
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-xs text-muted-foreground">Home page · {homeSections.length} sections · 2 credits each</p>
                  </div>
                  {homeSections.map((section, i) => (
                    <div key={i} className="border-b border-border/60 last:border-0">
                      <div className="flex items-center justify-between px-3 py-2.5 hover:bg-secondary/30 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground">
                            {SECTION_LABELS[section.type] ?? section.type}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {sectionSummary(section)}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            if (expandedSection === i) { setExpandedSection(null); setSectionInput('') }
                            else { setExpandedSection(i); setSectionInput('') }
                          }}
                          disabled={isGenerating}
                          className={cn(
                            'shrink-0 ml-2 text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors',
                            regeneratingSection === i && 'opacity-50',
                            isGenerating && 'cursor-not-allowed opacity-40'
                          )}
                        >
                          {regeneratingSection === i ? '…' : 'Improve'}
                        </button>
                      </div>

                      {expandedSection === i && (
                        <div className="px-3 pb-3 space-y-2">
                          <textarea
                            value={sectionInput}
                            onChange={(e) => setSectionInput(e.target.value)}
                            placeholder="Optional: describe what to change, or leave blank for automatic improvement"
                            rows={2}
                            className="w-full resize-none text-xs rounded border border-border bg-secondary/50 px-2.5 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSectionRegenerate(i, sectionInput)}
                              disabled={isGenerating}
                              className={cn(
                                'flex-1 text-xs py-1.5 rounded bg-primary text-primary-foreground font-semibold',
                                isGenerating && 'opacity-40 cursor-not-allowed'
                              )}
                            >
                              Regenerate
                            </button>
                            <button
                              onClick={() => { setExpandedSection(null); setSectionInput('') }}
                              className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
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

        {/* Preview panel */}
        <div className="flex-1 relative bg-[#111] overflow-hidden">
          {!currentManifest ? (
            <PreviewPlaceholder />
          ) : (
            <iframe
              key={iframeKey}
              src={`/preview/${projectId}`}
              className="w-full h-full border-none"
              title="Store preview"
            />
          )}
          {isGenerating && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80"
                  style={{ animation: 'spin 0.8s linear infinite' }}
                />
                <p className="text-xs text-white/70 font-mono">generating…</p>
              </div>
            </div>
          )}
        </div>
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
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isError
            ? 'bg-destructive/10 text-destructive border border-destructive/20 text-xs'
            : isStatus
            ? 'text-muted-foreground italic text-xs'
            : 'bg-secondary text-foreground'
        )}
      >
        {message.content.split('**').map((part, i) =>
          i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
        )}
      </div>
    </div>
  )
}

function PreviewPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-16 h-16 rounded-xl border border-white/10 flex items-center justify-center mx-auto mb-4">
          <span className="font-mono text-white/20 text-xl">∅</span>
        </div>
        <p className="text-white/30 text-sm font-mono">preview will appear here</p>
      </div>
    </div>
  )
}
