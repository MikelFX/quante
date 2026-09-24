'use client'

// /qads — celostránkový generátor reklamních videí + fotek. Levý panel
// (30 %) sbírá vstupy, pravý panel (70 %) drží průběžné výsledky a historii.
// Na mobilu se sloupce skládají pod sebe (levý → pravý).
//
// Auth flow: formulář je vyplnitelný nepřihlášeným. Klik na Vygenerovat
// uloží kompletní draft do sessionStorage a redirectne na /login s
// ?redirect_url=/qads. Po přihlášení client vyzvedne draft ze
// sessionStorage a obnoví ho na formulář; zbývá jen kliknout znovu.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useUser, SignInButton } from '@clerk/nextjs'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { QADS_STYLES, type QadsStyleId } from '@/lib/qads/styles'
import { computeGeneratorCost, type HiggsfieldOutputKind } from '@/lib/qads/pricing'

// ─── Types ──────────────────────────────────────────────────────────

type Format = '9:16' | '4:5' | '1:1' | '16:9'
type Language = 'cs' | 'en' | 'sk' | 'de'

interface UploadedPhoto {
  storagePath: string
  signedUrl: string
  mimeType: string
  bytes: number
}

interface FormState {
  productName: string
  productDescription: string
  photos: UploadedPhoto[]
  outputTypes: HiggsfieldOutputKind[]
  formats: Format[]
  style: QadsStyleId
  variantsPerFormat: number
  videoDurationSeconds: number
  language: Language
  projectId: string | null
}

interface GenerationSummary {
  id: string
  productName: string
  outputTypes: string[]
  formats: string[]
  style: string
  variantsPerFormat: number
  totalCredits: number
  status: string
  createdAt: string
  completedAt: string | null
  itemCounts: { total: number; completed: number; failed: number }
}

interface GenerationItem {
  id: string
  kind: 'image' | 'video'
  format: Format
  variantIdx: number
  status: 'queued' | 'generating' | 'completed' | 'failed' | 'nsfw' | 'canceled'
  mimeType: string | null
  errorMessage: string | null
  creditsCharged: number
  downloadUrl: string | null
}

interface AdCopy {
  format: Format
  variantIdx: number
  language: Language
  hook: string
  primaryText: string
  headline: string
  cta: string
  videoScript: string | null
  subtitles: Array<{ startMs: number; endMs: number; text: string }> | null
}

interface GenerationDetail {
  generation: {
    id: string
    productName: string
    status: string
    totalCredits: number
    createdAt: string
  }
  items: GenerationItem[]
  adCopy: AdCopy[]
}

// ─── Defaults + storage key ─────────────────────────────────────────

const DEFAULT_FORM: FormState = {
  productName: '',
  productDescription: '',
  photos: [],
  outputTypes: ['image', 'video'],
  formats: ['1:1', '9:16'],
  style: 'lifestyle',
  variantsPerFormat: 2,
  videoDurationSeconds: 5,
  language: 'cs',
  projectId: null,
}

const DRAFT_KEY = 'qads:draft:v1'

// ─── Component ──────────────────────────────────────────────────────

export function QadsGeneratorClient() {
  const { isSignedIn, isLoaded } = useUser()
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeGenerationId, setActiveGenerationId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GenerationDetail | null>(null)
  // Bumped after a successful per-item regenerate so polling restarts even when the
  // generation itself had already reached a terminal status.
  const [pollNonce, setPollNonce] = useState(0)
  const [history, setHistory] = useState<GenerationSummary[]>([])
  const [projects, setProjects] = useState<Array<{ projectId: string; projectName: string; products: Array<{ id: string; name: string; description: string; images: string[] }> }>>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Restore draft after login
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (raw) {
      try {
        const draft = JSON.parse(raw) as FormState
        setForm(draft)
      } catch {}
      sessionStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // Load history + projects once signed in
  useEffect(() => {
    if (!isSignedIn) return
    void (async () => {
      try {
        const [genRes, projRes] = await Promise.all([
          fetch('/api/qads/generations'),
          fetch('/api/qads/products'),
        ])
        if (genRes.ok) setHistory((await genRes.json()).generations ?? [])
        if (projRes.ok) setProjects((await projRes.json()).projects ?? [])
      } catch {}
    })()
  }, [isSignedIn])

  // Poll active generation
  useEffect(() => {
    if (!activeGenerationId) return
    let stop = false
    let ticks = 0
    const tick = async () => {
      try {
        const res = await fetch(`/api/qads/generations/${activeGenerationId}`)
        if (!res.ok) return
        const data = (await res.json()) as GenerationDetail
        if (stop) return
        setDetail(data)
        ticks++
        // A regenerated item can be in flight while the generation row is already terminal —
        // keep polling for it, but bounded (~12 min) so a stuck item can't poll forever.
        const itemsPending = data.items.some(i => i.status === 'queued' || i.status === 'generating')
        const done = ['completed', 'partial', 'failed'].includes(data.generation.status) && (!itemsPending || ticks > 200)
        if (done) {
          // Refresh history so the row shows as done
          const listRes = await fetch('/api/qads/generations')
          if (listRes.ok) setHistory((await listRes.json()).generations ?? [])
          return
        }
        setTimeout(() => { if (!stop) void tick() }, 3500)
      } catch {}
    }
    void tick()
    return () => { stop = true }
  }, [activeGenerationId, pollNonce])

  // ── Derived cost ──
  const cost = useMemo(() => computeGeneratorCost({
    outputTypes: form.outputTypes,
    formats: form.formats,
    variantsPerFormat: form.variantsPerFormat,
    videoDurationSeconds: form.videoDurationSeconds,
  }), [form.outputTypes, form.formats, form.variantsPerFormat, form.videoDurationSeconds])

  // ── Handlers ──
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!isSignedIn) {
      persistDraftAndSignIn(form)
      return
    }
    setUploadError(null)
    setUploading(true)
    const room = 4 - form.photos.length
    const list = Array.from(files).slice(0, Math.max(0, room))
    const newPhotos: UploadedPhoto[] = []
    for (const file of list) {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/qads/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'upload_failed' }))
        setUploadError(String(data.error ?? 'Upload failed'))
        break
      }
      newPhotos.push(await res.json())
    }
    setForm(prev => ({ ...prev, photos: [...prev.photos, ...newPhotos].slice(0, 4) }))
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (!isSignedIn) {
      persistDraftAndSignIn(form)
      return
    }
    if (form.photos.length === 0) {
      setSubmitError('Upload at least one product photo.')
      return
    }
    if (!form.productName.trim()) {
      setSubmitError('Add a product name.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/qads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: form.productName,
          productDescription: form.productDescription,
          // Only storage paths are sent — the server signs them itself and ignores any
          // client-supplied URLs.
          photoStoragePaths: form.photos.map(p => p.storagePath),
          projectId: form.projectId,
          outputTypes: form.outputTypes,
          formats: form.formats,
          style: form.style,
          variantsPerFormat: form.variantsPerFormat,
          videoDurationSeconds: form.outputTypes.includes('video') ? form.videoDurationSeconds : null,
          language: form.language,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'insufficient_credits') {
          setSubmitError(`Not enough credits (${data.balance ?? '?'} / need ${data.needed ?? '?'}). Top up in Billing.`)
        } else {
          setSubmitError(String(data.error ?? 'Generation failed. Please try again.'))
        }
        return
      }
      setActiveGenerationId(data.generationId as string)
      setDetail(null)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const pickProduct = (product: { id: string; name: string; description: string; images: string[] }, projectId: string) => {
    // Best-effort — we take up to 4 remote image URLs, but we can't stuff them
    // into our upload flow client-side (they live in a different Storage
    // bucket); leave photos empty and prompt the user to re-upload if needed.
    // Product name + description carry over immediately.
    setForm(prev => ({
      ...prev,
      projectId,
      productName: product.name,
      productDescription: product.description,
    }))
  }

  const removePhoto = (idx: number) => {
    setForm(prev => ({ ...prev, photos: prev.photos.filter((_, i) => i !== idx) }))
  }

  const toggleFormat = (f: Format) => {
    setForm(prev => {
      const has = prev.formats.includes(f)
      return {
        ...prev,
        formats: has ? prev.formats.filter(x => x !== f) : [...prev.formats, f],
      }
    })
  }

  const toggleOutput = (o: HiggsfieldOutputKind) => {
    setForm(prev => {
      const has = prev.outputTypes.includes(o)
      const next = has ? prev.outputTypes.filter(x => x !== o) : [...prev.outputTypes, o]
      // Never let the user empty the array — keep at least one.
      return { ...prev, outputTypes: next.length ? next : prev.outputTypes }
    })
  }

  // ─── Render ──
  return (
    <div className="qnt-public qp-dark" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      <main style={{ flex: 1, padding: 'clamp(2rem,4vw,4rem) 1.5rem', maxWidth: 1440, margin: '0 auto', width: '100%' }}>
        {/* Header */}
        <header style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 12, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--qp-mut)', margin: '0 0 8px' }}>
            Qads — generator
          </p>
          <h1 style={{ fontSize: 'clamp(28px,3.6vw,44px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 0 8px' }}>
            Ad <span style={{ color: 'var(--qp-accent)' }}>videos and photos</span> from one product shot.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--qp-sub)', maxWidth: 600, margin: 0 }}>
            Upload a photo, pick a style and formats. Download the finished creatives — where you post them is up to you.
          </p>
        </header>

        {/* Two-column layout */}
        <div className="qads-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 380px) 1fr',
          gap: 32,
          alignItems: 'start',
        }}>
          {/* Left — form */}
          <aside style={{
            position: 'sticky',
            top: 'calc(var(--banner-h,0px) + 76px)',
            display: 'flex', flexDirection: 'column', gap: 20,
          }} className="qads-form-col">
            <FormPanel
              form={form}
              setForm={setForm}
              cost={cost}
              projects={projects}
              onPickProduct={pickProduct}
              onUpload={handleUpload}
              onRemovePhoto={removePhoto}
              onToggleFormat={toggleFormat}
              onToggleOutput={toggleOutput}
              uploading={uploading}
              uploadError={uploadError}
              submitting={submitting}
              submitError={submitError}
              isSignedIn={!!isSignedIn}
              isLoaded={isLoaded}
              onSubmit={handleSubmit}
              onSignInPersist={() => persistDraftAndSignIn(form)}
              fileInputRef={fileInputRef}
            />
          </aside>

          {/* Right — results + history */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="qads-results-col">
            {detail
              ? <ResultsPanel detail={detail} activeGenerationId={activeGenerationId} onItemRegenerated={() => setPollNonce(n => n + 1)} />
              : <EmptyStatePanel isSignedIn={!!isSignedIn} />}
            {isSignedIn && history.length > 0 && (
              <HistoryPanel history={history} activeGenerationId={activeGenerationId} onSelect={setActiveGenerationId} />
            )}
          </section>
        </div>
      </main>

      <SiteFooter />

      <style>{`
        @media (max-width: 900px) {
          .qads-grid { grid-template-columns: 1fr !important; }
          .qads-form-col { position: static !important; }
        }
      `}</style>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function FormPanel(props: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  cost: ReturnType<typeof computeGeneratorCost>
  projects: Array<{ projectId: string; projectName: string; products: Array<{ id: string; name: string; description: string; images: string[] }> }>
  onPickProduct: (product: { id: string; name: string; description: string; images: string[] }, projectId: string) => void
  onUpload: (files: FileList | null) => void
  onRemovePhoto: (idx: number) => void
  onToggleFormat: (f: Format) => void
  onToggleOutput: (o: HiggsfieldOutputKind) => void
  uploading: boolean
  uploadError: string | null
  submitting: boolean
  submitError: string | null
  isSignedIn: boolean
  isLoaded: boolean
  onSubmit: () => void
  onSignInPersist: () => void
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>
}) {
  const { form, setForm, cost, projects, onPickProduct, onUpload, onRemovePhoto, onToggleFormat, onToggleOutput, uploading, uploadError, submitting, submitError, isSignedIn, isLoaded, onSubmit, fileInputRef } = props

  const canSubmit = form.photos.length > 0 && form.productName.trim().length > 0 && form.outputTypes.length > 0 && form.formats.length > 0
  return (
    <div style={{
      padding: 20, borderRadius: 12,
      border: '1px solid var(--qp-line)', background: 'var(--qp-surface)',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <FormSection label="Product photos">
        <PhotoUploader
          photos={form.photos}
          onUpload={onUpload}
          onRemove={onRemovePhoto}
          uploading={uploading}
          error={uploadError}
          fileInputRef={fileInputRef}
        />
      </FormSection>

      {isSignedIn && projects.length > 0 && (
        <FormSection label="Or pick from your Quante store">
          <ProductPicker projects={projects} onPick={onPickProduct} />
        </FormSection>
      )}

      <FormSection label="Product name">
        <input
          type="text"
          value={form.productName}
          onChange={e => setForm(prev => ({ ...prev, productName: e.target.value }))}
          placeholder="Slow Roast · Dark"
          className="qads-input"
        />
      </FormSection>

      <FormSection label="Description / USP (optional)">
        <textarea
          rows={3}
          value={form.productDescription}
          onChange={e => setForm(prev => ({ ...prev, productDescription: e.target.value }))}
          placeholder="Hand-roasted, premium 100% arabica from Colombia."
          className="qads-input"
          style={{ resize: 'vertical' }}
        />
      </FormSection>

      <FormSection label="Output type">
        <ChipRow>
          <Chip active={form.outputTypes.includes('image')} onClick={() => onToggleOutput('image')}>Photos</Chip>
          <Chip active={form.outputTypes.includes('video')} onClick={() => onToggleOutput('video')}>Videos</Chip>
        </ChipRow>
      </FormSection>

      <FormSection label="Formats">
        <ChipRow>
          {(['9:16', '4:5', '1:1', '16:9'] as Format[]).map(f => (
            <Chip key={f} active={form.formats.includes(f)} onClick={() => onToggleFormat(f)}>{f}</Chip>
          ))}
        </ChipRow>
      </FormSection>

      <FormSection label="Style">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          {QADS_STYLES.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setForm(prev => ({ ...prev, style: s.id }))}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${form.style === s.id ? 'var(--qp-accent)' : 'var(--qp-line)'}`,
                background: form.style === s.id ? 'rgba(212,255,63,0.06)' : 'var(--qp-bg-alt)',
                cursor: 'pointer', color: 'var(--qp-ink)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--qp-mut)', marginTop: 2 }}>{s.description}</div>
            </button>
          ))}
        </div>
      </FormSection>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormSection label="Variants / format">
          <NumberStepper value={form.variantsPerFormat} min={1} max={4} onChange={v => setForm(prev => ({ ...prev, variantsPerFormat: v }))} />
        </FormSection>
        {form.outputTypes.includes('video') && (
          <FormSection label="Video length (s)">
            <NumberStepper value={form.videoDurationSeconds} min={4} max={10} onChange={v => setForm(prev => ({ ...prev, videoDurationSeconds: v }))} />
          </FormSection>
        )}
      </div>

      <FormSection label="Ad copy language">
        <ChipRow>
          {(['en','cs','sk','de'] as Language[]).map(l => (
            <Chip key={l} active={form.language === l} onClick={() => setForm(prev => ({ ...prev, language: l }))}>{l.toUpperCase()}</Chip>
          ))}
        </ChipRow>
      </FormSection>

      {/* Cost summary + submit */}
      <div style={{
        padding: 12, borderRadius: 8, background: 'var(--qp-bg-alt)',
        border: '1px solid var(--qp-line)', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--qp-sub)' }}>
          <span>Photos ({cost.imageCredits} cr.)</span>
          <span>Videos ({cost.videoCredits} cr.)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--qp-ink)', fontWeight: 700 }}>
          <span>Total</span>
          <span>{cost.totalCredits} cr.</span>
        </div>
      </div>

      {submitError && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(224,86,79,0.08)', border: '1px solid rgba(224,86,79,0.3)', fontSize: 12, color: '#e0564f' }}>
          {submitError}
        </div>
      )}

      {isLoaded && !isSignedIn ? (
        <SignInButton mode="modal" forceRedirectUrl="/qads">
          <button
            type="button"
            onClick={() => { if (typeof window !== 'undefined') sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)) }}
            disabled={!canSubmit}
            style={submitButtonStyle(canSubmit)}
          >
            Sign in and generate →
          </button>
        </SignInButton>
      ) : (
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
          style={submitButtonStyle(canSubmit && !submitting)}
        >
          {submitting ? 'Starting generation…' : `Generate for ${cost.totalCredits} cr. →`}
        </button>
      )}

      {isLoaded && !isSignedIn && (
        <p style={{ fontSize: 11, color: 'var(--qp-mut)', margin: 0, textAlign: 'center' }}>
          Your form stays filled in — we bring you back here after sign in.
        </p>
      )}
    </div>
  )
}

function submitButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '12px 18px', borderRadius: 8,
    fontSize: 14, fontWeight: 700, letterSpacing: '.02em',
    background: enabled ? 'var(--qp-accent)' : 'var(--qp-line)',
    color: enabled ? '#08080a' : 'var(--qp-mut)',
    border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
    boxShadow: enabled ? '0 0 20px rgba(212,255,63,0.25)' : 'none',
  }
}

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: 'var(--qp-mono)', fontSize: 10.5, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--qp-mut)' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 99, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--qp-accent)' : 'var(--qp-line)'}`,
        background: active ? 'rgba(212,255,63,0.10)' : 'var(--qp-bg-alt)',
        color: active ? 'var(--qp-accent-deep)' : 'var(--qp-sub)',
        fontSize: 12, fontFamily: 'var(--qp-mono)', letterSpacing: '.02em',
      }}
    >
      {children}
    </button>
  )
}

function NumberStepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
      padding: '4px 6px', borderRadius: 8, border: '1px solid var(--qp-line)', background: 'var(--qp-bg-alt)',
    }}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} style={stepBtnStyle()}>−</button>
      <span style={{ minWidth: 22, textAlign: 'center', fontFamily: 'var(--qp-mono)', fontSize: 13, color: 'var(--qp-ink)' }}>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} style={stepBtnStyle()}>+</button>
    </div>
  )
}

function stepBtnStyle(): React.CSSProperties {
  return {
    width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
    background: 'var(--qp-surface)', color: 'var(--qp-ink)', border: '1px solid var(--qp-line)',
    fontSize: 14, lineHeight: 1,
  }
}

function PhotoUploader(props: {
  photos: UploadedPhoto[]
  onUpload: (files: FileList | null) => void
  onRemove: (idx: number) => void
  uploading: boolean
  error: string | null
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>
}) {
  const { photos, onUpload, onRemove, uploading, error, fileInputRef } = props
  const canAdd = photos.length < 4
  const [dragOver, setDragOver] = useState(false)
  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          onUpload(e.dataTransfer?.files ?? null)
        }}
        onClick={() => canAdd && fileInputRef.current?.click()}
        style={{
          padding: 20, borderRadius: 8, textAlign: 'center', cursor: canAdd ? 'pointer' : 'default',
          border: `1px dashed ${dragOver ? 'var(--qp-accent)' : 'var(--qp-line)'}`,
          background: dragOver ? 'rgba(212,255,63,0.06)' : 'var(--qp-bg-alt)',
          color: 'var(--qp-sub)', fontSize: 12,
        }}
      >
        {uploading ? 'Uploading…' : canAdd ? 'Drop a photo here or click to browse (max 4).' : 'Maximum 4 photos.'}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={e => onUpload(e.target.files)}
      />
      {error && (
        <p style={{ marginTop: 6, fontSize: 11, color: '#e0564f' }}>{error}</p>
      )}
      {photos.length > 0 && (
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {photos.map((p, i) => (
            <div key={p.storagePath} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--qp-bg-alt)', border: '1px solid var(--qp-line)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.signedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onRemove(i) }}
                aria-label="Remove photo"
                style={{
                  position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer',
                  fontSize: 12, lineHeight: 1,
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductPicker(props: {
  projects: Array<{ projectId: string; projectName: string; products: Array<{ id: string; name: string; description: string; images: string[] }> }>
  onPick: (product: { id: string; name: string; description: string; images: string[] }, projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--qp-line)', background: 'var(--qp-bg-alt)',
          color: 'var(--qp-sub)', fontSize: 12, textAlign: 'left', cursor: 'pointer',
        }}
      >
        {open ? '× Close' : '↳ Pick a product'}
      </button>
      {open && (
        <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {props.projects.map(proj => (
            <div key={proj.projectId}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--qp-mut)', fontFamily: 'var(--qp-mono)', padding: '4px 0' }}>{proj.projectName}</div>
              {proj.products.map(prod => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => { props.onPick(prod, proj.projectId); setOpen(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                    borderRadius: 6, background: 'transparent', border: '1px solid transparent',
                    color: 'var(--qp-ink)', fontSize: 12, cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--qp-bg-alt)'; e.currentTarget.style.borderColor = 'var(--qp-line)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                >
                  {prod.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyStatePanel({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <div style={{
      padding: 32, borderRadius: 12, border: '1px dashed var(--qp-line)',
      background: 'var(--qp-surface)', textAlign: 'center', color: 'var(--qp-sub)',
    }}>
      <p style={{ fontSize: 14, margin: '0 0 6px', color: 'var(--qp-ink)', fontWeight: 600 }}>
        Nothing here yet.
      </p>
      <p style={{ fontSize: 12.5, margin: 0 }}>
        {isSignedIn
          ? 'Fill the form on the left and click Generate. Results will show up here.'
          : 'Fill the form on the left. You\'ll sign in before submitting — your inputs stay.'}
      </p>
    </div>
  )
}

function ResultsPanel({ detail, activeGenerationId, onItemRegenerated }: { detail: GenerationDetail; activeGenerationId: string | null; onItemRegenerated: () => void }) {
  const completedCount = detail.items.filter(i => i.status === 'completed').length
  const canZip = completedCount > 0
  const zipHref = activeGenerationId ? `/api/qads/generations/${activeGenerationId}/zip` : '#'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        padding: 18, borderRadius: 12, border: '1px solid var(--qp-line)',
        background: 'var(--qp-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--qp-ink)' }}>{detail.generation.productName}</div>
          <div style={{ fontSize: 12, color: 'var(--qp-sub)', marginTop: 4 }}>
            {completedCount} / {detail.items.length} done · {detail.generation.status}
          </div>
        </div>
        <a
          href={canZip ? zipHref : undefined}
          onClick={e => { if (!canZip) e.preventDefault() }}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: canZip ? 'var(--qp-accent)' : 'var(--qp-line)',
            color: canZip ? '#08080a' : 'var(--qp-mut)',
            textDecoration: 'none', cursor: canZip ? 'pointer' : 'not-allowed',
          }}
        >
          Download all (ZIP)
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {detail.items.map(item => {
          const copy = detail.adCopy.find(c => c.format === item.format && c.variantIdx === item.variantIdx)
          return <ItemCard key={item.id} item={item} copy={copy} generationId={activeGenerationId} onRegenerated={onItemRegenerated} />
        })}
      </div>
    </div>
  )
}

function ItemCard({ item, copy, generationId, onRegenerated }: { item: GenerationItem; copy?: AdCopy; generationId: string | null; onRegenerated: () => void }) {
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const regenerate = async () => {
    if (!generationId) return
    if (!confirm(`Regenerate this variant? ${item.creditsCharged} credits will be charged.`)) return
    setRegenerating(true)
    setRegenError(null)
    try {
      const res = await fetch(`/api/qads/generations/${generationId}/regenerate-item`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; code?: string; balance?: number; needed?: number }
        if (data.error === 'billing_hold' || data.code === 'billing_hold') {
          setRegenError('Your account is on a billing hold — contact support.')
        } else if (res.status === 402 || data.error === 'insufficient_credits') {
          setRegenError(`Not enough credits (${data.balance ?? '?'} / need ${data.needed ?? '?'}). Top up in Billing.`)
        } else if (res.status === 409) {
          setRegenError(data.error ?? 'This variant is already generating.')
        } else if (res.status === 429) {
          setRegenError(data.error ?? 'Rate limit reached — please try again later.')
        } else if (data.error === 'reserve_failed') {
          setRegenError('Could not reserve credits. Please try again.')
        } else {
          setRegenError(data.error ?? 'Regenerate failed. Please try again.')
        }
        return
      }
      onRegenerated()
    } catch {
      setRegenError('Could not reach the server. Please try again.')
    } finally {
      setRegenerating(false)
    }
  }
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
      setTimeout(() => setCopiedText(null), 1500)
    } catch {}
  }
  return (
    <div style={{
      padding: 12, borderRadius: 10, border: '1px solid var(--qp-line)', background: 'var(--qp-surface)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ position: 'relative', aspectRatio: item.format.replace(':', '/'), background: 'var(--qp-bg-alt)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {item.status === 'completed' && item.downloadUrl ? (
          item.kind === 'video'
            ? <video src={item.downloadUrl} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            /* eslint-disable-next-line @next/next/no-img-element */
            : <img src={item.downloadUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <StatusPill status={item.status} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--qp-mut)', fontFamily: 'var(--qp-mono)' }}>
        <span>{item.kind === 'image' ? 'PHOTO' : 'VIDEO'} · {item.format} · v{item.variantIdx + 1}</span>
        <span>{item.creditsCharged} cr.</span>
      </div>
      {item.status === 'completed' && item.downloadUrl && (
        <div style={{ display: 'flex', gap: 6 }}>
          <a href={item.downloadUrl} download style={btnSmallPrimary()}>Download</a>
          <button type="button" onClick={regenerate} disabled={regenerating} style={btnSmallGhost()}>{regenerating ? '…' : 'Regenerate'}</button>
        </div>
      )}
      {(item.status === 'failed' || item.status === 'nsfw') && (
        <div style={{ fontSize: 11, color: '#e0564f' }}>{item.errorMessage ?? 'Failed'}</div>
      )}
      {(item.status === 'failed' || item.status === 'nsfw') && (
        <button type="button" onClick={regenerate} disabled={regenerating} style={btnSmallPrimary()}>{regenerating ? '…' : 'Try again'}</button>
      )}
      {regenError && (
        <div role="alert" style={{ fontSize: 11, color: '#e0564f' }}>{regenError}</div>
      )}
      {copy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, borderTop: '1px solid var(--qp-line-soft)', paddingTop: 8 }}>
          <CopyRow label="Hook" text={copy.hook} copiedText={copiedText} onCopy={copyText} />
          <CopyRow label="Headline" text={copy.headline} copiedText={copiedText} onCopy={copyText} />
          <CopyRow label="Body" text={copy.primaryText} copiedText={copiedText} onCopy={copyText} />
          <CopyRow label="CTA" text={copy.cta} copiedText={copiedText} onCopy={copyText} />
        </div>
      )}
    </div>
  )
}

function CopyRow({ label, text, copiedText, onCopy }: { label: string; text: string; copiedText: string | null; onCopy: (t: string) => void }) {
  const copied = copiedText === text
  return (
    <button
      type="button"
      onClick={() => onCopy(text)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, textAlign: 'left',
        padding: '4px 6px', borderRadius: 4, border: '1px solid transparent',
        background: copied ? 'rgba(62,207,142,0.10)' : 'transparent',
        color: 'var(--qp-ink)', cursor: 'pointer', fontSize: 11,
      }}
    >
      <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 9.5, color: 'var(--qp-mut)', textTransform: 'uppercase', letterSpacing: '.06em', minWidth: 48 }}>{label}</span>
      <span style={{ flex: 1 }}>{text}</span>
      <span style={{ fontSize: 10, color: copied ? '#3ecf8e' : 'var(--qp-mut)' }}>{copied ? '✓' : '⧉'}</span>
    </button>
  )
}

function StatusPill({ status }: { status: GenerationItem['status'] }) {
  const label: Record<GenerationItem['status'], string> = {
    queued: 'Queued',
    generating: 'Generating',
    completed: 'Done',
    failed: 'Failed',
    nsfw: 'Rejected',
    canceled: 'Canceled',
  }
  const color: Record<GenerationItem['status'], string> = {
    queued: 'var(--qp-mut)',
    generating: '#e0a04f',
    completed: '#3ecf8e',
    failed: '#e0564f',
    nsfw: '#e0564f',
    canceled: 'var(--qp-mut)',
  }
  return (
    <div style={{ fontSize: 11, color: color[status], fontFamily: 'var(--qp-mono)', letterSpacing: '.06em' }}>{label[status]}</div>
  )
}

function HistoryPanel({ history, activeGenerationId, onSelect }: { history: GenerationSummary[]; activeGenerationId: string | null; onSelect: (id: string) => void }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--qp-line)', background: 'var(--qp-surface)' }}>
      <div style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', textTransform: 'uppercase', letterSpacing: '.10em', marginBottom: 12 }}>
        History
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map(g => {
          const active = g.id === activeGenerationId
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              style={{
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${active ? 'var(--qp-accent)' : 'var(--qp-line)'}`,
                background: active ? 'rgba(212,255,63,0.06)' : 'var(--qp-bg-alt)',
                color: 'var(--qp-ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{g.productName}</div>
                <div style={{ fontSize: 11, color: 'var(--qp-mut)', marginTop: 3 }}>
                  {new Date(g.createdAt).toLocaleDateString('en-US')} · {g.itemCounts.completed}/{g.itemCounts.total} · {g.status}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--qp-mut)', fontFamily: 'var(--qp-mono)' }}>{g.totalCredits} cr.</span>
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--qp-mut)', margin: '12px 0 0' }}>
        Older campaigns from the Studio (before the new generator) live in the <Link href="/dashboard" style={{ color: 'var(--qp-accent-deep)' }}>Dashboard</Link>.
      </p>
    </div>
  )
}

function btnSmallPrimary(): React.CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
    background: 'var(--qp-accent)', color: '#08080a', border: 'none', cursor: 'pointer',
    textDecoration: 'none',
  }
}
function btnSmallGhost(): React.CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
    background: 'transparent', color: 'var(--qp-sub)', border: '1px solid var(--qp-line)', cursor: 'pointer',
  }
}

// ─── Persistence helpers ────────────────────────────────────────────

function persistDraftAndSignIn(form: FormState) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form))
  window.location.href = `/login?redirect_url=${encodeURIComponent('/qads')}`
}
