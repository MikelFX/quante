'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProjectPage() {
  const router = useRouter()
  const [brief, setBrief] = useState('')
  const [projectName, setProjectName] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const briefRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { briefRef.current?.focus() }, [])

  async function handleGenerate() {
    if (!brief.trim() || generating) return
    setGenerating(true)
    setStatus('Designing your store…')
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
            if (evt.type === 'status') setStatus(evt.text)
            else if (evt.type === 'error') { setError(evt.message); setGenerating(false); return }
            else if (evt.type === 'done' && evt.projectId) {
                const qs = new URLSearchParams()
                if (evt.deploymentId) qs.set('did', evt.deploymentId)
                if (evt.previewUrl) qs.set('pu', encodeURIComponent(evt.previewUrl))
                router.push(`/project/${evt.projectId}?${qs.toString()}`)
                return
              }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch {
      setError('Generation failed. Please try again.')
      setGenerating(false)
    }
  }

  if (generating) {
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
          <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', margin: '0 0 5px' }}>{status}</p>
          <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>20–40 seconds.</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '2.5rem 1rem' }}>

      <p style={{
        fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
        textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 2rem',
      }}>
        New project
      </p>

      <div style={{
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,.09)',
        background: '#0a0a0e',
        overflow: 'hidden',
      }}>

        {/* Brief */}
        <div style={{ padding: '16px 16px 0' }}>
          <p style={{
            fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64',
            textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 8px',
          }}>
            Describe your store
          </p>
          <textarea
            ref={briefRef}
            value={brief}
            onChange={e => setBrief(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleGenerate() }}
            placeholder="e.g. Elegant jewelry shop targeting women 25–45. Minimalist aesthetic, products include rings, necklaces and earrings. Currency CZK."
            rows={5}
            style={{
              width: '100%', fontSize: 14, color: '#e0e0e8', background: 'transparent',
              border: 'none', outline: 'none', resize: 'none', lineHeight: 1.7,
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '12px 0' }} />

        {/* Project name + action */}
        <div style={{ padding: '0 16px 16px', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}>
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
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate() }}
              placeholder="My store"
              style={{
                width: '100%', fontSize: 13, padding: '8px 11px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,.09)', background: '#121218',
                color: '#f4f4f6', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.45)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
                transition: 'background .12s',
              }}
              onMouseEnter={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#5d66d4' }}
              onMouseLeave={e => { if (brief.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#6f78e6' }}
            >
              Generate
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: '#f87171', margin: '12px 0 0', textAlign: 'center' }}>{error}</p>
      )}

      <p style={{ fontSize: 11, color: '#5b5b64', margin: '14px 0 0', textAlign: 'center' }}>
        ⌘ Enter to generate
      </p>

    </div>
  )
}
