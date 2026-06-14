'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type Stage = 'form' | 'generating' | 'error'
type Mode = 'freeform' | 'guided'

// ─── Guided mode options ──────────────────────────────────────────────────────

const INDUSTRIES = ['Coffee', 'Skincare', 'Fashion', 'Jewellery', 'Food & drink', 'Art', 'Fitness', 'Books', 'Tech', 'Home & living', 'Pet supplies', 'Sports']
const VIBES = ['Minimal', 'Bold', 'Playful', 'Luxury', 'Editorial', 'Earthy', 'Futuristic', 'Vintage']
const PALETTES = ['Dark & moody', 'Light & clean', 'Warm neutrals', 'Cool & crisp', 'Vibrant', 'Pastel', 'Monochrome']
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'CHF']

function assembleBrief(industry: string, vibe: string, palette: string, currency: string, products: string): string {
  const paletteMap: Record<string, string> = {
    'Dark & moody': 'dark, high-contrast palette',
    'Light & clean': 'light, airy palette with lots of white space',
    'Warm neutrals': 'warm, earthy neutral palette',
    'Cool & crisp': 'cool, crisp blue-toned palette',
    'Vibrant': 'vibrant, punchy color palette',
    'Pastel': 'soft pastel palette',
    'Monochrome': 'monochrome black and white palette',
  }
  const parts = [
    `A ${vibe.toLowerCase()} ${industry.toLowerCase()} brand.`,
    `${paletteMap[palette] ?? palette}.`,
    products.trim() ? `Products: ${products.trim()}.` : '',
    `Currency: ${currency}.`,
  ].filter(Boolean)
  return parts.join(' ')
}

// ─── Chip component ───────────────────────────────────────────────────────────

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: selected ? 600 : 400,
        border: selected ? '1px solid rgba(111,120,230,.6)' : '1px solid rgba(255,255,255,.1)',
        background: selected ? 'rgba(111,120,230,.15)' : 'transparent',
        color: selected ? '#a5b4fc' : '#8a8a93',
        cursor: 'pointer', transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewProjectPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('form')
  const [mode, setMode] = useState<Mode>('freeform')
  const [projectName, setProjectName] = useState('')
  const [brief, setBrief] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')

  // Guided mode state
  const [gIndustry, setGIndustry] = useState('')
  const [gVibe, setGVibe] = useState('')
  const [gPalette, setGPalette] = useState('')
  const [gCurrency, setGCurrency] = useState('EUR')
  const [gProducts, setGProducts] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  const guidedComplete = gIndustry && gVibe && gPalette && gCurrency

  function applyGuidedBrief() {
    const assembled = assembleBrief(gIndustry, gVibe, gPalette, gCurrency, gProducts)
    setBrief(assembled)
    setMode('freeform')
  }

  async function handleGenerate(e?: React.FormEvent) {
    e?.preventDefault()
    const activeBrief = mode === 'guided'
      ? assembleBrief(gIndustry, gVibe, gPalette, gCurrency, gProducts)
      : brief.trim()
    if (!activeBrief) return

    setStage('generating')
    setStatusText('Starting…')
    setError('')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const response = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: activeBrief, projectName: projectName.trim() || gIndustry || undefined }),
        signal: abort.signal,
      })

      if (!response.body) throw new Error('No stream received')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n').filter(l => l.trim())) {
          let event: { type: string; text?: string; message?: string; projectId?: string }
          try { event = JSON.parse(line) } catch { continue }
          if (event.type === 'status' && event.text) setStatusText(event.text)
          else if (event.type === 'error' && event.message) { setError(event.message); setStage('error'); return }
          else if (event.type === 'done' && event.projectId) { router.push(`/project/${event.projectId}`); return }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError('Something went wrong. Please try again.')
      setStage('error')
    }
  }

  // ── Generating state ──────────────────────────────────────────────────────
  if (stage === 'generating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', gap: 24, padding: '0 2rem' }}>
        <div style={{ position: 'relative', width: 48, height: 48 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid rgba(111,120,230,.2)',
            borderTopColor: '#6f78e6',
            animation: 'spin 0.9s linear infinite',
          }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', margin: '0 0 6px' }}>{statusText}</p>
          <p style={{ fontSize: 12, color: '#5b5b64', margin: 0 }}>This takes 20–40 seconds.</p>
        </div>
        <button
          onClick={() => { abortRef.current?.abort(); setStage('form') }}
          style={{ fontSize: 12, color: '#5b5b64', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  const inputSt: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '9px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,.09)', background: '#0d0d11',
    color: '#f4f4f6', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', transition: 'border-color 0.12s',
  }
  const labelSt: React.CSSProperties = {
    fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 6,
  }

  return (
    <div style={{ padding: '1.5rem 1rem 3rem', maxWidth: 640, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', color: '#f4f4f6', margin: '0 0 6px' }}>New project</h1>
        <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>
          Describe your store — or use guided mode if you&apos;re not sure where to start.
        </p>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#0d0d11', borderRadius: 10, padding: 4, border: '1px solid rgba(255,255,255,.07)', width: 'fit-content' }}>
        {(['freeform', 'guided'] as Mode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: '6px 16px', borderRadius: 7, fontSize: 12, fontWeight: mode === m ? 600 : 400,
              background: mode === m ? 'rgba(255,255,255,.08)' : 'transparent',
              color: mode === m ? '#f4f4f6' : '#8a8a93',
              border: 'none', cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            {m === 'freeform' ? 'Free-form' : '✦ Guided'}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {stage === 'error' && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(224,86,79,.3)', background: 'rgba(224,86,79,.07)', fontSize: 13, color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Project name — always shown */}
      <div style={{ marginBottom: 16 }}>
        <p style={labelSt}>Project name <span style={{ fontFamily: 'inherit', fontWeight: 400, color: '#5b5b64', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></p>
        <input
          type="text"
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          placeholder={gIndustry || 'My coffee shop'}
          style={inputSt}
          onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.5)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
        />
      </div>

      {/* ── Guided mode ──────────────────────────────────────────────────────── */}
      {mode === 'guided' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Industry */}
          <div>
            <p style={labelSt}>What are you selling? <span style={{ color: '#e0564f' }}>*</span></p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {INDUSTRIES.map(v => <Chip key={v} label={v} selected={gIndustry === v} onClick={() => setGIndustry(v === gIndustry ? '' : v)} />)}
            </div>
          </div>

          {/* Vibe */}
          <div>
            <p style={labelSt}>Brand vibe <span style={{ color: '#e0564f' }}>*</span></p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {VIBES.map(v => <Chip key={v} label={v} selected={gVibe === v} onClick={() => setGVibe(v === gVibe ? '' : v)} />)}
            </div>
          </div>

          {/* Palette */}
          <div>
            <p style={labelSt}>Palette <span style={{ color: '#e0564f' }}>*</span></p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PALETTES.map(v => <Chip key={v} label={v} selected={gPalette === v} onClick={() => setGPalette(v === gPalette ? '' : v)} />)}
            </div>
          </div>

          {/* Currency */}
          <div>
            <p style={labelSt}>Currency <span style={{ color: '#e0564f' }}>*</span></p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CURRENCIES.map(v => <Chip key={v} label={v} selected={gCurrency === v} onClick={() => setGCurrency(v)} />)}
            </div>
          </div>

          {/* Products */}
          <div>
            <p style={labelSt}>Products <span style={{ fontFamily: 'inherit', fontWeight: 400, color: '#5b5b64', textTransform: 'none', letterSpacing: 0 }}>(optional — describe them)</span></p>
            <textarea
              value={gProducts}
              onChange={e => setGProducts(e.target.value)}
              rows={3}
              placeholder="e.g. 3 coffee blends, a brewing kit, and a monthly subscription box"
              style={{ ...inputSt, resize: 'none', lineHeight: 1.55 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
            />
          </div>

          {/* Brief preview */}
          {guidedComplete && (
            <div style={{ borderRadius: 8, border: '1px solid rgba(111,120,230,.2)', background: 'rgba(111,120,230,.05)', padding: '10px 14px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#6f78e6', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Preview brief</p>
              <p style={{ fontSize: 12, color: '#f4f4f6', lineHeight: 1.55, margin: 0 }}>
                {assembleBrief(gIndustry, gVibe, gPalette, gCurrency, gProducts)}
              </p>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
            <button
              type="button"
              onClick={applyGuidedBrief}
              disabled={!guidedComplete}
              style={{ fontSize: 12, color: guidedComplete ? '#6f78e6' : '#5b5b64', background: 'none', border: 'none', cursor: guidedComplete ? 'pointer' : 'not-allowed', padding: 0 }}
            >
              Edit brief manually →
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>10 cr</span>
              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={!guidedComplete}
                style={{
                  padding: '9px 22px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                  cursor: guidedComplete ? 'pointer' : 'not-allowed',
                  background: guidedComplete ? '#6f78e6' : 'rgba(255,255,255,.06)',
                  color: guidedComplete ? '#fff' : '#5b5b64',
                  transition: 'background 0.12s',
                }}
              >
                Generate store
              </button>
            </div>
          </div>
        </div>

      ) : (
        /* ── Free-form mode ────────────────────────────────────────────────── */
        <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p style={labelSt}>Brief <span style={{ color: '#e0564f' }}>*</span></p>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              required
              rows={9}
              placeholder={`Example:\n\nA premium coffee brand targeting urban professionals. Minimalist aesthetic — dark roasts, single-origin beans. Products: 3 coffee blends, a brewing kit, and a subscription. Palette should feel warm and sophisticated. Czech koruna (CZK).`}
              style={{ ...inputSt, resize: 'vertical', lineHeight: 1.6, minHeight: 180 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(111,120,230,.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)')}
            />
            <p style={{ fontSize: 11, color: '#5b5b64', marginTop: 6 }}>Include: brand vibe, products, target audience, currency, any specific colors or style.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>10 credits</span>
            <button
              type="submit"
              disabled={!brief.trim()}
              className={cn(
                'px-5 py-2 text-sm font-semibold rounded-lg transition-all',
                brief.trim()
                  ? 'bg-[#6f78e6] text-white hover:bg-[#5d66d4]'
                  : 'bg-white/[.06] text-[#5b5b64] cursor-not-allowed'
              )}
            >
              Generate store
            </button>
          </div>
        </form>
      )}

      {/* Example briefs — free-form only */}
      {mode === 'freeform' && (
        <div style={{ marginTop: 36, borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: 24 }}>
          <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Or try an example</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {EXAMPLE_BRIEFS.map(ex => (
              <button
                key={ex.name}
                type="button"
                onClick={() => { setProjectName(ex.name); setBrief(ex.brief) }}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.07)', background: 'transparent',
                  color: '#f4f4f6', cursor: 'pointer', transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.03)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
              >
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 3px' }}>{ex.name}</p>
                <p style={{ fontSize: 12, color: '#8a8a93', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.brief}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const EXAMPLE_BRIEFS = [
  {
    name: 'Aura Skincare',
    brief: 'A minimal skincare brand for women 25–40. Clean, clinical aesthetic. Products: vitamin C serum, hydrating moisturiser, gentle cleanser, night repair oil. Warm neutral palette, elegant serif headings. EUR currency.',
  },
  {
    name: 'Volta Coffee',
    brief: 'Premium specialty coffee roaster. Urban, sophisticated feel. Single-origin beans from Ethiopia, Colombia, and Guatemala. Dark, warm palette — near-black background with amber accents. Products: three coffee bags and a brewing kit. CZK.',
  },
  {
    name: 'Drift Surf Co.',
    brief: 'Surf gear and lifestyle brand. Relaxed, sun-bleached California aesthetic. Products: surfboards, wetsuits, board shorts, wax. Bright and airy — white backgrounds, ocean blue accents. USD.',
  },
]
