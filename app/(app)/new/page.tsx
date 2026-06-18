'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Stage = 'chat' | 'ready' | 'generating'

interface Message {
  role: 'quante' | 'user'
  content: string
  streaming?: boolean
}

const OPENING = "Hey! I'm Quante. Tell me about your store — what are you selling, and who are your customers?"

export default function NewProjectPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('chat')
  const [messages, setMessages] = useState<Message[]>([{ role: 'quante', content: OPENING }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [brief, setBrief] = useState('')
  const [projectName, setProjectName] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, stage])

  useEffect(() => {
    if (stage === 'chat' && !thinking) inputRef.current?.focus()
  }, [stage, thinking])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking || stage !== 'chat') return

    setInput('')
    setError('')

    const updated: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(updated)
    setThinking(true)

    // History sent to API: exclude hardcoded opening (messages[0]), start from first user message
    const history = updated.slice(1)
      .filter(m => m.content.trim())
      .map(m => ({
        role: m.role === 'quante' ? 'assistant' as const : 'user' as const,
        content: m.content,
      }))

    try {
      const abort = new AbortController()
      abortRef.current = abort

      const res = await fetch('/api/quante/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
        signal: abort.signal,
      })
      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()

      // Append empty streaming placeholder for Quante reply
      setMessages(prev => [...prev, { role: 'quante', content: '', streaming: true }])
      setThinking(false)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const raw = dec.decode(value, { stream: true })
        for (const line of raw.split('\n').filter(l => l.trim())) {
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'text_chunk') {
              setMessages(prev => {
                const last = prev[prev.length - 1]
                return [...prev.slice(0, -1), { ...last, content: last.content + evt.text }]
              })
            } else if (evt.type === 'ready') {
              // Finalize Quante's message (stop streaming cursor)
              setMessages(prev => {
                const last = prev[prev.length - 1]
                return [...prev.slice(0, -1), { ...last, streaming: false }]
              })
              setBrief(evt.brief)
              // Try to extract a project name from the brief
              const m = evt.brief.match(/^([A-Z][A-Za-z0-9\s&'.-]{1,28}?) (?:is |are |–|—)/)
              if (m) setProjectName(m[1].trim())
              setStage('ready')
            } else if (evt.type === 'error') {
              throw new Error(evt.message)
            }
          } catch { /* skip malformed JSON lines */ }
        }
      }

      // Stop streaming cursor if no <ready> was received
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }]
        return prev
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message || 'Something went wrong. Please try again.')
      setThinking(false)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'quante' && !last.content) return prev.slice(0, -1)
        return prev
      })
    }
  }, [input, thinking, stage, messages])

  async function handleGenerate() {
    if (!brief.trim()) return
    setStage('generating')
    setStatusText('Designing your store…')
    setError('')

    try {
      const res = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), projectName: projectName.trim() || undefined }),
      })
      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const raw = dec.decode(value, { stream: true })
        for (const line of raw.split('\n').filter(l => l.trim())) {
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'status') setStatusText(evt.text)
            else if (evt.type === 'error') { setError(evt.message); setStage('ready'); return }
            else if (evt.type === 'done' && evt.projectId) { router.push(`/project/${evt.projectId}`); return }
          } catch { /* skip */ }
        }
      }
    } catch {
      setError('Generation failed. Please try again.')
      setStage('ready')
    }
  }

  // ── Generating ──────────────────────────────────────────────────────────────
  if (stage === 'generating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', gap: 24 }}>
        <div style={{ position: 'relative', width: 44, height: 44 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '1.5px solid rgba(111,120,230,.15)',
            borderTopColor: '#6f78e6',
            animation: 'spin 0.9s linear infinite',
          }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', margin: '0 0 5px' }}>{statusText}</p>
          <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>20–40 seconds.</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  const avatarSt: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
    background: 'rgba(111,120,230,.14)',
    border: '1px solid rgba(111,120,230,.22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, color: '#6f78e6',
    fontFamily: 'var(--font-geist-mono)', letterSpacing: '.02em',
    marginTop: 1,
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '2rem 1rem 6rem', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <p style={{
        fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
        textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 2rem',
      }}>
        New project
      </p>

      {/* Messages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: msg.role === 'quante' ? 'row' : 'row-reverse',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            {msg.role === 'quante' && <div style={avatarSt}>Q</div>}
            <div style={{
              maxWidth: '80%',
              ...(msg.role === 'user' ? {
                padding: '9px 13px',
                borderRadius: 12,
                background: 'rgba(111,120,230,.09)',
                border: '1px solid rgba(111,120,230,.16)',
              } : {}),
              fontSize: 14,
              lineHeight: 1.65,
              color: '#f4f4f6',
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
              {msg.streaming && (
                <span style={{
                  display: 'inline-block', width: 5, height: 14,
                  background: '#6f78e6', marginLeft: 2, borderRadius: 1,
                  verticalAlign: 'middle',
                  animation: 'blink .75s step-end infinite',
                }} />
              )}
            </div>
          </div>
        ))}

        {/* Thinking dots */}
        {thinking && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={avatarSt}>Q</div>
            <div style={{ display: 'flex', gap: 5, paddingTop: 3 }}>
              {[0, 160, 320].map(d => (
                <div key={d} style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#5b5b64',
                  animation: `pulse 1.3s ${d}ms ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Ready panel */}
      {stage === 'ready' && (
        <div style={{
          marginTop: 28,
          borderRadius: 12,
          border: '1px solid rgba(111,120,230,.22)',
          background: 'rgba(111,120,230,.04)',
          overflow: 'hidden',
        }}>
          {/* Brief header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <p style={{
              fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#6f78e6',
              textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 10px',
            }}>
              ✦ Store brief
            </p>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              rows={4}
              style={{
                width: '100%', fontSize: 13, color: '#e0e0e8', background: 'transparent',
                border: 'none', outline: 'none', resize: 'none', lineHeight: 1.7,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{
                fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
                textTransform: 'uppercase', letterSpacing: '.07em', margin: '0 0 6px',
              }}>
                Project name
              </p>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="My store"
                style={{
                  width: '100%', fontSize: 13, padding: '8px 11px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.09)', background: '#0a0a0e',
                  color: '#f4f4f6', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.45)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={() => { setStage('chat'); setError('') }}
                style={{
                  fontSize: 12, color: '#5b5b64', background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0,
                  transition: 'color .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#8a8a93')}
                onMouseLeave={e => (e.currentTarget.style.color = '#5b5b64')}
              >
                ← Keep refining
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>10 cr</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!brief.trim()}
                  style={{
                    padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                    border: 'none', cursor: brief.trim() ? 'pointer' : 'not-allowed',
                    background: brief.trim() ? '#6f78e6' : 'rgba(255,255,255,.06)',
                    color: brief.trim() ? '#fff' : '#5b5b64',
                    transition: 'background .12s, opacity .12s',
                  }}
                  onMouseEnter={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#5d66d4' }}
                  onMouseLeave={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#6f78e6' }}
                >
                  Generate store
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat input */}
      {stage === 'chat' && (
        <div style={{
          marginTop: 24,
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,.09)',
          background: '#0a0a0e',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '10px 10px 10px 14px',
          transition: 'border-color .15s',
        }}
          onFocusCapture={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.35)')}
          onBlurCapture={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
        >
          <textarea
            ref={inputRef}
            value={input}
            disabled={thinking}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder={thinking ? '' : 'Reply to Quante…'}
            rows={1}
            style={{
              flex: 1, fontSize: 14, color: '#f4f4f6', background: 'transparent',
              border: 'none', outline: 'none', resize: 'none', lineHeight: 1.55,
              fontFamily: 'inherit', minHeight: 22, maxHeight: 130,
              opacity: thinking ? 0.3 : 1, transition: 'opacity .2s',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || thinking}
            style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: 8,
              background: input.trim() && !thinking ? '#6f78e6' : 'rgba(255,255,255,.06)',
              border: 'none', cursor: input.trim() && !thinking ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .12s',
              color: input.trim() && !thinking ? '#fff' : '#5b5b64',
              fontSize: 15, lineHeight: 1,
            }}
            onMouseEnter={e => { if (input.trim() && !thinking) (e.currentTarget as HTMLButtonElement).style.background = '#5d66d4' }}
            onMouseLeave={e => { if (input.trim() && !thinking) (e.currentTarget as HTMLButtonElement).style.background = '#6f78e6' }}
          >
            ↑
          </button>
        </div>
      )}

      {error && stage === 'chat' && (
        <p style={{ fontSize: 12, color: '#f87171', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>
      )}

      <style>{`
        @keyframes blink  { 50% { opacity: 0 } }
        @keyframes pulse  { 0%,80%,100% { opacity: .25; transform: scale(.85) } 40% { opacity: 1; transform: scale(1) } }
        @keyframes spin   { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
