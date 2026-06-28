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

const STAGES = [
  { label: 'Analyzing brief', duration: 3000 },
  { label: 'Designing layout', duration: 5000 },
  { label: 'Writing components', duration: 8000 },
  { label: 'Styling & theming', duration: 6000 },
  { label: 'Wiring up cart & checkout', duration: 5000 },
  { label: 'Preparing deployment', duration: 4000 },
]

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
  const [codeChunks, setCodeChunks] = useState('')
  const [stageIndex, setStageIndex] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, stage])

  useEffect(() => {
    if (stage === 'chat' && !thinking) inputRef.current?.focus()
  }, [stage, thinking])

  useEffect(() => {
    if (stage !== 'generating') return
    setStageIndex(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    let cumulative = 0
    for (let s = 0; s < STAGES.length - 1; s++) {
      cumulative += STAGES[s]!.duration
      const snap = s + 1
      timers.push(setTimeout(() => setStageIndex(snap), cumulative))
    }
    return () => timers.forEach(clearTimeout)
  }, [stage])

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
    setCodeChunks('')

    let redirected = false

    // After 250s warn the user; after 290s give up and check dashboard automatically
    const warnTimer = setTimeout(() => {
      if (!redirected) setStatusText('Almost there — finalizing your store…')
    }, 250_000)
    const giveUpTimer = setTimeout(async () => {
      if (redirected) return
      setStatusText('Checking if your store was saved…')
      try {
        const r = await fetch('/api/projects')
        if (r.ok) {
          const data = await r.json()
          const projects: Array<{ id: string; created_at: string }> = data.projects ?? data ?? []
          // Find a project created in the last 6 minutes
          const cutoff = Date.now() - 6 * 60_000
          const recent = projects
            .filter(p => new Date(p.created_at).getTime() > cutoff)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
          if (recent) {
            redirected = true
            router.push(`/project/${recent.id}`)
            return
          }
        }
      } catch {}
      setError('Generation timed out. Check your dashboard — your store may have been saved there.')
      setStage('ready')
    }, 290_000)

    try {
      const res = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), projectName: projectName.trim() || undefined }),
      })
      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'status') setStatusText(evt.text)
            else if (evt.type === 'chunk') {
              setCodeChunks(prev => (prev + evt.text).slice(-3000))
            }
            else if (evt.type === 'ping') { /* keepalive — ignore */ }
            else if (evt.type === 'error') {
              clearTimeout(warnTimer); clearTimeout(giveUpTimer)
              setError(evt.message); setStage('ready'); return
            }
            else if (evt.type === 'done' && evt.projectId) {
              redirected = true
              clearTimeout(warnTimer); clearTimeout(giveUpTimer)
              router.push(`/project/${evt.projectId}`); return
            }
          } catch { /* malformed line — skip */ }
        }
      }
    } catch {
      // network error or Vercel hard limit — let giveUpTimer handle recovery
    } finally {
      clearTimeout(warnTimer)
      // giveUpTimer clears itself after redirect or error
    }

    // Stream ended cleanly without a done event — run the same recovery check
    if (!redirected) {
      clearTimeout(giveUpTimer)
      setStatusText('Checking if your store was saved…')
      try {
        const r = await fetch('/api/projects')
        if (r.ok) {
          const data = await r.json()
          const projects: Array<{ id: string; created_at: string }> = data.projects ?? data ?? []
          const cutoff = Date.now() - 6 * 60_000
          const recent = projects
            .filter(p => new Date(p.created_at).getTime() > cutoff)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
          if (recent) {
            router.push(`/project/${recent.id}`)
            return
          }
        }
      } catch {}
      setError('Generation failed. Your store may still appear in the dashboard — check there, or try again.')
      setStage('ready')
    }
  }

  // ── Generating ──────────────────────────────────────────────────────────────
  if (stage === 'generating') {
    return (
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '2.5rem 1rem',
        display: 'flex', flexDirection: 'column', gap: 32, minHeight: '85vh',
      }}>
        {/* Header */}
        <div>
          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 6px' }}>
            Building your store
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.08)', borderTopColor: '#6f78e6', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#e0e0e8' }}>{statusText}</h2>
          </div>
        </div>

        {/* Stages */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STAGES.map((s, i) => {
            const done = i < stageIndex
            const active = i === stageIndex
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                {/* Indicator */}
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? '#3ecf8e' : active ? 'rgba(111,120,230,.15)' : 'rgba(255,255,255,.04)',
                  border: done ? 'none' : active ? '1.5px solid #6f78e6' : '1px solid rgba(255,255,255,.08)',
                  transition: 'all .4s ease',
                }}>
                  {done ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="#0a0a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : active ? (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6f78e6', animation: 'pulse 1.4s ease infinite' }} />
                  ) : null}
                </div>
                <span style={{ fontSize: 13, color: done ? '#3ecf8e' : active ? '#d0d0da' : '#4a4a55', fontFamily: 'var(--font-geist-mono)', transition: 'color .4s ease' }}>
                  {s.label}
                </span>
                {done && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>done</span>
                )}
                {active && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6f78e6', fontFamily: 'var(--font-geist-mono)', animation: 'blink 1.2s ease infinite' }}>…</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Live code terminal — always visible during generation */}
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: '#070709', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
            <span style={{ marginLeft: 8, fontSize: 10, color: '#4a4a55', fontFamily: 'var(--font-geist-mono)' }}>generating store…</span>
          </div>
          <pre style={{
            margin: 0, padding: '12px 14px', fontSize: 11,
            fontFamily: 'var(--font-geist-mono)', color: '#6f78e6',
            lineHeight: 1.6, overflowX: 'auto', overflowY: 'hidden',
            maxHeight: 220, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            minHeight: 52,
          }}>
            {codeChunks
              ? codeChunks.slice(-1500)
              : <span style={{ color: '#363640' }}>Waiting for Claude…</span>
            }
            <span style={{ opacity: 0.5, animation: 'blink 1s step-end infinite' }}>▌</span>
          </pre>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{error}</p>
        )}

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
          @keyframes blink{0%,100%{opacity:.4}50%{opacity:0}}
        `}</style>
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
