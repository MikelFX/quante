'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type Stage = 'form' | 'generating' | 'error'

export default function NewProjectPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('form')
  const [projectName, setProjectName] = useState('')
  const [brief, setBrief] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!brief.trim()) return

    setStage('generating')
    setStatusText('Starting…')
    setError('')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const response = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), projectName: projectName.trim() || undefined }),
        signal: abort.signal,
      })

      if (!response.body) throw new Error('No stream received')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n').filter((l) => l.trim())) {
          let event: { type: string; text?: string; message?: string; projectId?: string }
          try { event = JSON.parse(line) } catch { continue }

          if (event.type === 'status' && event.text) {
            setStatusText(event.text)
          } else if (event.type === 'error' && event.message) {
            setError(event.message)
            setStage('error')
            return
          } else if (event.type === 'done' && event.projectId) {
            router.push(`/project/${event.projectId}`)
            return
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError('Something went wrong. Please try again.')
      setStage('error')
    }
  }

  if (stage === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-8">
        <div className="relative w-12 h-12">
          <div
            className="absolute inset-0 rounded-full border-2 border-accent/30 border-t-accent"
            style={{ animation: 'spin 0.9s linear infinite' }}
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-mono text-muted-foreground">{statusText}</p>
          <p className="text-xs text-muted-foreground mt-1">This takes 20–40 seconds.</p>
        </div>
        <button
          onClick={() => {
            abortRef.current?.abort()
            setStage('form')
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="px-8 py-10 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1">New project</h1>
        <p className="text-sm text-muted-foreground">
          Describe the store you want to build. Be specific — Quante will design everything.
        </p>
      </div>

      {stage === 'error' && (
        <div className="mb-6 px-4 py-3 rounded border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleGenerate} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Project name <span className="normal-case">(optional)</span>
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My coffee shop"
            className="px-3 py-2 text-sm rounded border border-border bg-secondary/50 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Brief <span className="text-destructive">*</span>
          </label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            required
            rows={8}
            placeholder={`Example:\n\nA premium coffee brand targeting urban professionals. Minimalist aesthetic — dark roasts, single-origin beans. Products: 3 coffee blends, a brewing kit, and a subscription. Palette should feel warm and sophisticated. Czech koruna (CZK).`}
            className="px-3 py-2 text-sm rounded border border-border bg-secondary/50 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">
            Include: brand vibe, products, target audience, currency, any specific colors or style.
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground font-mono">10 credits</p>
          <button
            type="submit"
            disabled={!brief.trim()}
            className={cn(
              'px-5 py-2 text-sm font-semibold rounded bg-primary text-primary-foreground transition-opacity',
              !brief.trim() && 'opacity-40 cursor-not-allowed'
            )}
          >
            Generate store
          </button>
        </div>
      </form>

      <div className="mt-10 border-t border-border pt-6">
        <p className="text-xs font-medium text-muted-foreground mb-3">Or try an example brief:</p>
        <div className="grid gap-2">
          {EXAMPLE_BRIEFS.map((ex) => (
            <button
              key={ex.name}
              onClick={() => {
                setProjectName(ex.name)
                setBrief(ex.brief)
              }}
              className="text-left px-4 py-3 rounded border border-border hover:border-border/60 hover:bg-secondary/50 transition-colors"
            >
              <p className="text-sm font-medium">{ex.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ex.brief}</p>
            </button>
          ))}
        </div>
      </div>
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
