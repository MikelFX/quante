'use client'

// /qads — ad videos and photos from a product photo. One composer box: product photos, a text box
// (type @ to pick a product from your Quante store) and a bar of options — output, formats, style,
// variants, video length, ad-copy language — with the exact credit price on the Generate button.
// Results and history follow below; under them the community wall (QadsCommunityWall.tsx). Every
// Generate asks whether the finished outputs may go on that public wall (ShareConsent).
//
// Auth flow: the box can be filled in signed out. Adding a photo or Generate saves the draft to
// sessionStorage and goes to /login?redirect_url=/qads; after sign-in the draft is restored and
// the visitor clicks once more. Qgent in the Studio hands over a partial draft the same way
// (product, description, store, language).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { ArrowRight, AtSign, Check, ChevronDown, Image as ImageIcon, Plus, RectangleVertical, Video, X } from 'lucide-react'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { QADS_STYLES, type QadsStyleId } from '@/lib/qads/styles'
import { computeGeneratorCost, type HiggsfieldOutputKind } from '@/lib/qads/pricing'
import { AGENCY_FAIR_USE, CREDIT_COSTS } from '@/lib/config'
import { QadsBackdrop } from './QadsBackdrop'
import { QadsCommunityWall } from './QadsCommunityWall'
import './qads.css'

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
  /** What the ad should show — the text box. */
  brief: string
  /** A product picked with @ (or handed over by Qgent); empty when none. */
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

interface StoreProduct { id: string; name: string; description: string; images: string[] }
interface StoreProject { projectId: string; projectName: string; products: StoreProduct[] }

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
  /** Finished outputs are on the public community wall. */
  shareCommunity?: boolean
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

// ─── Options ────────────────────────────────────────────────────────

const DEFAULT_FORM: FormState = {
  brief: '',
  productName: '',
  productDescription: '',
  photos: [],
  outputTypes: ['video', 'image'],
  formats: ['9:16'],
  style: 'lifestyle',
  variantsPerFormat: 1,
  videoDurationSeconds: 5,
  language: 'cs',
  projectId: null,
}

const DRAFT_KEY = 'qads:draft:v1'
const SHARE_KEY = 'qads:share-last'

const FORMATS: Array<{ id: Format; note: string }> = [
  { id: '9:16', note: 'Stories, Reels, TikTok' },
  { id: '4:5', note: 'Instagram and Facebook feed' },
  { id: '1:1', note: 'Feed, store listings' },
  { id: '16:9', note: 'YouTube, web banners' },
]
const LANGS: Array<{ id: Language; label: string }> = [
  { id: 'cs', label: 'Czech' },
  { id: 'en', label: 'English' },
  { id: 'sk', label: 'Slovak' },
  { id: 'de', label: 'German' },
]
const DURATIONS = [4, 5, 6, 7, 8, 9, 10]
const VARIANTS = [1, 2, 3, 4]

/** Small swatch per style on the Style button — the design palette, not product imagery. */
const SWATCH: Record<QadsStyleId, string> = {
  lifestyle: 'radial-gradient(circle at 75% 20%, rgb(var(--q-acc-rgb) / .7), transparent 70%), var(--q-s2)',
  packshot: 'radial-gradient(circle, rgb(var(--q-ink-rgb) / .28), var(--q-s2) 72%)',
  cinematic: 'linear-gradient(180deg, rgb(var(--q-acc2-rgb) / .65), var(--q-bg))',
  ugc: 'repeating-linear-gradient(0deg, var(--q-line2) 0 1px, transparent 1px 5px), var(--q-s2)',
  minimal: 'radial-gradient(circle at 68% 32%, rgb(var(--q-acc2-rgb) / .75) 0 28%, var(--q-s1) 30%)',
}

const styleLabel = (id: QadsStyleId) => QADS_STYLES.find((s) => s.id === id)?.label ?? id

/** Product name for the ad copy when no product was picked: the first phrase of the brief. */
function nameFromBrief(brief: string): string {
  const first = brief.split('\n')[0].split(/(?<=[.!?])\s|\s[–—-]\s|:\s/)[0].trim()
  if (first.length <= 80) return first
  const cut = first.slice(0, 80)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim()
}

type MenuId = 'formats' | 'style' | 'variants' | 'duration' | 'lang' | 'product'

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
  const [projects, setProjects] = useState<StoreProject[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  // Agency plan: Qads included (no credits), behind a daily fair-use cap.
  const [agency, setAgency] = useState(false)
  const [menu, setMenu] = useState<MenuId | null>(null)
  const [askShare, setAskShare] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const boxRef = useRef<HTMLElement | null>(null)
  const resultsRef = useRef<HTMLElement | null>(null)

  // Restore a draft: the form saved before login, or a partial one handed over by Qgent in the
  // Studio (product name, description, store, language) — merged over the defaults.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (raw) {
      try {
        const draft = JSON.parse(raw) as Partial<FormState>
        setForm({ ...DEFAULT_FORM, ...draft })
      } catch {}
      sessionStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // Load history, products and the credit balance once signed in
  useEffect(() => {
    if (!isSignedIn) return
    void (async () => {
      try {
        const [genRes, projRes, balRes] = await Promise.all([
          fetch('/api/qads/generations'),
          fetch('/api/qads/products'),
          fetch('/api/credits/balance'),
        ])
        if (genRes.ok) setHistory((await genRes.json()).generations ?? [])
        if (projRes.ok) setProjects((await projRes.json()).projects ?? [])
        if (balRes.ok) {
          const b = (await balRes.json()) as { balance?: number | null; tier?: string }
          if (typeof b.balance === 'number') setBalance(b.balance)
          setAgency(b.tier === 'agency')
        }
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

  // Open menus close on a click outside or Escape.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      // Clicks inside an open list or on a menu button are handled there.
      if (!(e.target instanceof Element) || !e.target.closest('.qz-pop, .qz-menu > button')) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // ── Derived ──
  const cost = useMemo(() => computeGeneratorCost({
    outputTypes: form.outputTypes,
    formats: form.formats,
    variantsPerFormat: form.variantsPerFormat,
    videoDurationSeconds: form.videoDurationSeconds,
  }), [form.outputTypes, form.formats, form.variantsPerFormat, form.videoDurationSeconds])
  // "Your first N credits are free — enough for a video and a photo" only while that is true.
  const starterCovers = useMemo(() => computeGeneratorCost({ outputTypes: ['video', 'image'], formats: ['9:16'], variantsPerFormat: 1, videoDurationSeconds: 5 }).totalCredits <= CREDIT_COSTS.welcome_grant, [])
  const wantsVideo = form.outputTypes.includes('video')
  const canSubmit = form.photos.length > 0 && form.formats.length > 0 && form.outputTypes.length > 0 && !uploading
  const pickedProject = form.projectId ? projects.find(p => p.projectId === form.projectId) : undefined

  const toggleMenu = (id: MenuId) => setMenu(m => (m === id ? null : id))

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

  const addPhoto = () => {
    if (isLoaded && !isSignedIn) {
      persistDraftAndSignIn(form)
      return
    }
    fileInputRef.current?.click()
  }

  // Generate asks first whether the results may go on the public community wall.
  const handleSubmit = () => {
    if (!isSignedIn) {
      persistDraftAndSignIn(form)
      return
    }
    if (form.photos.length === 0) {
      setSubmitError('Add at least one photo of the product.')
      return
    }
    if (!submitting) setAskShare(true)
  }

  const startGeneration = async (shareCommunity: boolean) => {
    setAskShare(false)
    try { localStorage.setItem(SHARE_KEY, shareCommunity ? '1' : '0') } catch {}
    // The ad copy needs a product name: the picked product, else the first phrase of the brief.
    const brief = form.brief.trim()
    const picked = form.productName.trim()
    const productName = (picked || nameFromBrief(brief) || 'Product').slice(0, 120)
    const productDescription = (picked ? [form.productDescription.trim(), brief].filter(Boolean).join('\n\n') : brief).slice(0, 2000)
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/qads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          productDescription,
          // Only storage paths are sent — the server signs them itself and ignores any
          // client-supplied URLs.
          photoStoragePaths: form.photos.map(p => p.storagePath),
          projectId: form.projectId,
          outputTypes: form.outputTypes,
          formats: form.formats,
          style: form.style,
          variantsPerFormat: form.variantsPerFormat,
          videoDurationSeconds: wantsVideo ? form.videoDurationSeconds : null,
          language: form.language,
          shareCommunity,
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
      // The backdrop's camera flash, from the Generate button (QadsBackdrop.tsx).
      const go = document.querySelector('.qz-go')?.getBoundingClientRect()
      if (go) window.dispatchEvent(new CustomEvent('qz:flash', { detail: { x: go.left + go.width / 2, y: go.top + go.height / 2 } }))
      setBalance(b => (b === null ? b : Math.max(0, b - cost.totalCredits)))
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const pickProduct = (product: StoreProduct, projectId: string) => {
    // Name + description carry over; the store's photos live in another bucket, so the
    // visitor adds their own photo of the product.
    setForm(prev => {
      // Drop the "@" that opened the picker, if it is still there.
      const brief = prev.brief.replace(/(^|\s)@(?=\s|$)/, '$1').replace(/\s{2,}/g, ' ')
      return { ...prev, brief, projectId, productName: product.name, productDescription: product.description }
    })
    setMenu(null)
    textRef.current?.focus()
  }

  const clearProduct = () => setForm(prev => ({ ...prev, productName: '', productDescription: '', projectId: null }))

  const removePhoto = (idx: number) => {
    setForm(prev => ({ ...prev, photos: prev.photos.filter((_, i) => i !== idx) }))
  }

  const toggleFormat = (f: Format) => {
    setForm(prev => {
      const has = prev.formats.includes(f)
      const next = has ? prev.formats.filter(x => x !== f) : [...prev.formats, f]
      // At least one format.
      return { ...prev, formats: next.length ? FORMATS.map(x => x.id).filter(x => next.includes(x)) : prev.formats }
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

  const onBriefChange = (el: HTMLTextAreaElement) => {
    const v = el.value
    setForm(prev => ({ ...prev, brief: v }))
    // Grow with the text.
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
    // "@" at the start or after a space opens the product picker.
    const at = (el.selectionStart ?? v.length) - 1
    if (v[at] === '@' && (at === 0 || /\s/.test(v[at - 1]))) setMenu('product')
  }

  const formatLabel = form.formats.length > 1 ? `${form.formats[0]} +${form.formats.length - 1}` : form.formats[0]

  // ─── Render ──
  return (
    <div className="qnt-public qp-dark qz" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <QadsBackdrop />
      <PublicNav />

      <main style={{ flex: 1, padding: '0 1.25rem', width: '100%' }}>
        <header className="qz-hero">
          <span className="qz-pill" data-qz-calm><b>Qads</b>Ad videos and photos to download</span>
          <h1 className="qz-h1" data-qz-calm>An ad from <em>one photo.</em></h1>
          <p className="qz-sub" data-qz-calm>Drop a product photo into the box and download finished videos and photos. Where you post them is up to you.</p>
        </header>

        {/* ── Composer ── */}
        <section
          ref={boxRef}
          className={'qz-box' + (dragOver ? ' drag' : '')}
          data-qz-subject
          aria-label="Create an ad"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false) }}
          onDrop={e => { e.preventDefault(); setDragOver(false); void handleUpload(e.dataTransfer?.files ?? null) }}
        >
          <div className="qz-att">
            {form.photos.map((p, i) => (
              <div key={p.storagePath} className="qz-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.signedUrl} alt={`Product photo ${i + 1}`} />
                <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}><X /></button>
              </div>
            ))}
            {form.photos.length < 4 && (
              <button type="button" className="qz-add" onClick={addPhoto} disabled={uploading}>
                <Plus aria-hidden="true" />
                {uploading ? 'Uploading…' : 'Photo'}
              </button>
            )}
            <span className="qz-att-hint">
              {form.photos.length === 0 ? <>JPG, PNG or WebP, up to 4 photos. Drag them here.<br />On a phone, snap the product straight away.</> : `${form.photos.length} of 4 photos`}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={e => void handleUpload(e.target.files)}
            />
          </div>

          {form.productName && (
            <span className="qz-tag">
              <AtSign aria-hidden="true" />
              <span>{form.productName}</span>
              {pickedProject && <small>· {pickedProject.projectName}</small>}
              <button type="button" onClick={clearProduct} aria-label="Remove the picked product"><X /></button>
            </span>
          )}

          <div className="qz-menu">
            <label htmlFor="qz-brief" className="vh">What should the ad show?</label>
            <textarea
              id="qz-brief"
              ref={textRef}
              className="qz-text"
              rows={2}
              maxLength={2000}
              value={form.brief}
              placeholder={form.productName ? 'Anything to add? Mood, audience, a line the ad should say… (optional)' : 'What should the ad show? Name the product and the mood — optional. Or type @ to pick a product from your store.'}
              onChange={e => onBriefChange(e.currentTarget)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (menu === 'product') return
                  void handleSubmit()
                }
              }}
            />
            {menu === 'product' && (
              <ProductMenu
                projects={projects}
                signedIn={!!isSignedIn}
                onPick={pickProduct}
                onSignIn={() => persistDraftAndSignIn(form)}
              />
            )}
          </div>

          <div className="qz-bar">
            <div className="qz-menu">
              <button type="button" className="qz-b ico" aria-label="Pick a product from your store" aria-haspopup="menu" aria-expanded={menu === 'product'} onClick={() => toggleMenu('product')}>
                <AtSign aria-hidden="true" />
              </button>
            </div>
            <span className="qz-sep" aria-hidden="true" />
            <button type="button" className="qz-b" aria-pressed={wantsVideo} onClick={() => toggleOutput('video')}>
              <Video aria-hidden="true" />Video
            </button>
            <button type="button" className="qz-b" aria-pressed={form.outputTypes.includes('image')} onClick={() => toggleOutput('image')}>
              <ImageIcon aria-hidden="true" />Photo
            </button>

            <Menu id="formats" open={menu === 'formats'} onToggle={toggleMenu} label={`Formats: ${form.formats.join(', ')}`} button={<><RectangleVertical aria-hidden="true" />{formatLabel}</>}>
              <p className="qz-pop-h">Formats</p>
              {FORMATS.map(f => (
                <button key={f.id} type="button" role="menuitemcheckbox" aria-checked={form.formats.includes(f.id)} className="qz-opt" onClick={() => toggleFormat(f.id)}>
                  <Check className="ck" aria-hidden="true" />
                  <span>{f.id}<small>{f.note}</small></span>
                </button>
              ))}
            </Menu>

            <Menu id="style" open={menu === 'style'} onToggle={toggleMenu} wide label={`Style: ${styleLabel(form.style)}`} button={<><span className="qz-sw" style={{ background: SWATCH[form.style] }} aria-hidden="true" /><span className="qz-pre">Style:</span>{styleLabel(form.style)}</>}>
              <p className="qz-pop-h">Style</p>
              {QADS_STYLES.map(s => (
                <button key={s.id} type="button" role="menuitemradio" aria-checked={form.style === s.id} className="qz-opt" onClick={() => { setForm(prev => ({ ...prev, style: s.id })); setMenu(null) }}>
                  <span className="qz-sw" style={{ background: SWATCH[s.id], marginTop: 1 }} aria-hidden="true" />
                  <span>{s.label}<small>{s.description}</small></span>
                </button>
              ))}
            </Menu>

            <Menu id="variants" open={menu === 'variants'} onToggle={toggleMenu} label={`${form.variantsPerFormat} variant${form.variantsPerFormat === 1 ? '' : 's'} per format`} plain button={<>×{form.variantsPerFormat}</>}>
              <p className="qz-pop-h">Variants per format</p>
              {VARIANTS.map(n => (
                <button key={n} type="button" role="menuitemradio" aria-checked={form.variantsPerFormat === n} className="qz-opt" onClick={() => { setForm(prev => ({ ...prev, variantsPerFormat: n })); setMenu(null) }}>
                  <Check className="ck" aria-hidden="true" />
                  <span>{n} variant{n === 1 ? '' : 's'}</span>
                </button>
              ))}
            </Menu>

            {wantsVideo && (
              <Menu id="duration" open={menu === 'duration'} onToggle={toggleMenu} label={`Video length: ${form.videoDurationSeconds} seconds`} plain button={<>{form.videoDurationSeconds} s</>}>
                <p className="qz-pop-h">Video length</p>
                {DURATIONS.map(s => (
                  <button key={s} type="button" role="menuitemradio" aria-checked={form.videoDurationSeconds === s} className="qz-opt" onClick={() => { setForm(prev => ({ ...prev, videoDurationSeconds: s })); setMenu(null) }}>
                    <Check className="ck" aria-hidden="true" />
                    <span>{s} seconds</span>
                  </button>
                ))}
              </Menu>
            )}

            <Menu id="lang" open={menu === 'lang'} onToggle={toggleMenu} label={`Ad copy language: ${LANGS.find(l => l.id === form.language)?.label}`} plain button={<>{form.language.toUpperCase()}</>}>
              <p className="qz-pop-h">Ad copy language</p>
              {LANGS.map(l => (
                <button key={l.id} type="button" role="menuitemradio" aria-checked={form.language === l.id} className="qz-opt" onClick={() => { setForm(prev => ({ ...prev, language: l.id })); setMenu(null) }}>
                  <Check className="ck" aria-hidden="true" />
                  <span>{l.label}</span>
                </button>
              ))}
            </Menu>

            <button type="button" className="qz-go" disabled={(isSignedIn && !canSubmit) || submitting} onClick={() => void handleSubmit()} title={isLoaded && !isSignedIn ? 'Sign in and generate' : undefined}>
              {submitting ? 'Starting…' : 'Generate'}
              {isLoaded && !isSignedIn && !submitting && <span className="vh"> (sign in first)</span>}
              <span className="cr">{agency ? 'Included' : `${cost.totalCredits} cr`}</span>
              <span className="ar" aria-hidden="true"><ArrowRight /></span>
            </button>
          </div>
        </section>

        <div className="qz-under" data-qz-calm>
          <span>
            <span className="dot" aria-hidden="true" />
            {agency
              ? `Included in your Agency plan — fair use ${AGENCY_FAIR_USE.qadsVideosPerDay} videos and ${AGENCY_FAIR_USE.qadsPhotosPerDay} photos a day.`
              : form.photos.length === 0 ? 'Add a photo and go.' : `${cost.imageCredits ? `Photos ${cost.imageCredits} cr · ` : ''}${cost.videoCredits ? `Videos ${cost.videoCredits} cr · ` : ''}Prompts and ad copy ${cost.strategyCredits} cr.`}
            {isLoaded && !isSignedIn && starterCovers && ` Your first ${CREDIT_COSTS.welcome_grant} credits are free — enough for a video and a photo.`}
            {isSignedIn && !agency && balance !== null && <> Balance {balance} cr · <Link href="/billing">Top up</Link></>}
          </span>
          <span className="qz-kbd">Send<kbd>Enter</kbd></span>
        </div>
        {(uploadError || submitError) && <p className="qz-err" role="alert">{uploadError ?? submitError}</p>}

        {/* ── Results ── */}
        <section ref={resultsRef} className="qz-results" aria-live="polite">
          {detail
            ? <ResultsPanel detail={detail} activeGenerationId={activeGenerationId} onItemRegenerated={() => setPollNonce(n => n + 1)} />
            : activeGenerationId
              ? <div style={pendingCard}>Writing the prompts and ad copy, then generating. Results appear here as they finish.</div>
              : null}
          {isSignedIn && history.length > 0 && (
            <HistoryPanel
              history={history}
              activeGenerationId={activeGenerationId}
              onSelect={setActiveGenerationId}
              onShared={(id, share) => setHistory(h => h.map(g => (g.id === id ? { ...g, shareCommunity: share } : g)))}
            />
          )}
        </section>

      </main>

      <QadsCommunityWall />

      {askShare && <ShareConsent onAnswer={(share) => void startGeneration(share)} onCancel={() => setAskShare(false)} />}

      <SiteFooter />
    </div>
  )
}

const pendingCard: CSSProperties = {
  padding: 18, borderRadius: 18, border: '1px solid var(--q-glass-border)',
  background: 'linear-gradient(180deg, var(--q-glass1), var(--q-glass2))', color: 'var(--q-fg2)', fontSize: 14,
}

// ─── Sub-components ─────────────────────────────────────────────────

/** A pill in the option bar that opens a menu; `plain` pills (×1, 5 s, CS) skip the chevron. */
function Menu({ id, open, onToggle, label, button, wide, plain, children }: { id: MenuId; open: boolean; onToggle: (id: MenuId) => void; label: string; button: ReactNode; wide?: boolean; plain?: boolean; children: ReactNode }) {
  return (
    <div className="qz-menu">
      <button type="button" className={'qz-b' + (plain ? ' sm' : '')} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => onToggle(id)}>
        {button}
        {!plain && <ChevronDown className="dn" aria-hidden="true" />}
      </button>
      {open && <div className={'qz-pop' + (wide ? ' wide' : '')} role="menu" aria-label={label}>{children}</div>}
    </div>
  )
}

function ProductMenu({ projects, signedIn, onPick, onSignIn }: { projects: StoreProject[]; signedIn: boolean; onPick: (p: StoreProduct, projectId: string) => void; onSignIn: () => void }) {
  return (
    <div className="qz-pop wide" role="menu" aria-label="Products from your stores" style={{ top: 'calc(100% - 6px)', left: 12 }}>
      {!signedIn ? (
        <div className="qz-pop-note">
          Sign in to pick a product from your Quante store.
          <br />
          <button type="button" className="qz-b" onClick={onSignIn}>Sign in</button>
        </div>
      ) : projects.length === 0 ? (
        <div className="qz-pop-note">No products in your stores yet. Name the product in the text instead.</div>
      ) : (
        projects.map(proj => (
          <div key={proj.projectId}>
            <p className="qz-pop-h">{proj.projectName}</p>
            {proj.products.map(prod => (
              <button key={prod.id} type="button" role="menuitem" className="qz-opt" onClick={() => onPick(prod, proj.projectId)}>
                <AtSign className="ck" aria-hidden="true" style={{ opacity: 0.6 }} />
                <span>{prod.name}{prod.description && <small>{prod.description.length > 90 ? prod.description.slice(0, 88) + '…' : prod.description}</small>}</span>
              </button>
            ))}
          </div>
        ))
      )}
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
            color: canZip ? 'var(--q-acc-ink)' : 'var(--qp-mut)',
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
        <div style={{ fontSize: 11, color: 'var(--q-danger-text)' }}>{item.errorMessage ?? 'Failed'}</div>
      )}
      {(item.status === 'failed' || item.status === 'nsfw') && (
        <button type="button" onClick={regenerate} disabled={regenerating} style={btnSmallPrimary()}>{regenerating ? '…' : 'Try again'}</button>
      )}
      {regenError && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--q-danger-text)' }}>{regenError}</div>
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
        background: copied ? 'rgb(var(--q-ok-rgb) / 0.10)' : 'transparent',
        color: 'var(--qp-ink)', cursor: 'pointer', fontSize: 11,
      }}
    >
      <span style={{ fontFamily: 'var(--qp-mono)', fontSize: 9.5, color: 'var(--qp-mut)', textTransform: 'uppercase', letterSpacing: '.06em', minWidth: 48 }}>{label}</span>
      <span style={{ flex: 1 }}>{text}</span>
      <span style={{ fontSize: 10, color: copied ? 'var(--q-ok-text)' : 'var(--qp-mut)' }}>{copied ? '✓' : '⧉'}</span>
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
    generating: 'var(--q-warn)',
    completed: 'var(--q-ok)',
    failed: 'var(--q-danger)',
    nsfw: 'var(--q-danger)',
    canceled: 'var(--qp-mut)',
  }
  return (
    <div style={{ fontSize: 11, color: color[status], fontFamily: 'var(--qp-mono)', letterSpacing: '.06em' }}>{label[status]}</div>
  )
}

function HistoryPanel({ history, activeGenerationId, onSelect, onShared }: { history: GenerationSummary[]; activeGenerationId: string | null; onSelect: (id: string) => void; onShared: (id: string, share: boolean) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const toggleShare = async (g: GenerationSummary) => {
    if (busy) return
    setBusy(g.id)
    const share = !g.shareCommunity
    const res = await fetch(`/api/qads/generations/${g.id}/share`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share }),
    }).catch(() => null)
    if (res?.ok) onShared(g.id, share)
    setBusy(null)
  }
  return (
    <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--qp-line)', background: 'var(--qp-surface)' }}>
      <div style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', textTransform: 'uppercase', letterSpacing: '.10em', marginBottom: 12 }}>
        History
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map(g => {
          const active = g.id === activeGenerationId
          return (
            <div
              key={g.id}
              style={{
                borderRadius: 8,
                border: `1px solid ${active ? 'var(--qp-accent)' : 'var(--qp-line)'}`,
                background: active ? 'rgb(var(--q-acc-rgb) / 0.06)' : 'var(--qp-bg-alt)',
                display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(g.id)}
                style={{
                  flex: 1, minWidth: 0, padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                  border: 0, background: 'transparent', color: 'var(--qp-ink)',
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
              <button
                type="button"
                className="qz-share-toggle"
                aria-pressed={!!g.shareCommunity}
                disabled={busy === g.id}
                onClick={() => void toggleShare(g)}
                title={g.shareCommunity ? 'On the community wall — click to take it down' : 'Private — click to share on the community wall'}
              >
                {g.shareCommunity ? 'Shared' : 'Private'}
              </button>
            </div>
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
    background: 'var(--qp-accent)', color: 'var(--q-acc-ink)', border: 'none', cursor: 'pointer',
    textDecoration: 'none',
  }
}
function btnSmallGhost(): React.CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
    background: 'transparent', color: 'var(--qp-sub)', border: '1px solid var(--qp-line)', cursor: 'pointer',
  }
}

/** Asked on every Generate: may the finished photos and videos go on the community wall? */
function ShareConsent({ onAnswer, onCancel }: { onAnswer: (share: boolean) => void; onCancel: () => void }) {
  const firstRef = useRef<HTMLButtonElement | null>(null)
  // The last answer is offered first; the question is still asked every time.
  const [lastShared] = useState(() => {
    try { return localStorage.getItem(SHARE_KEY) === '1' } catch { return false }
  })
  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const share = <button ref={lastShared ? firstRef : undefined} type="button" className="qz-go qz-consent-yes" onClick={() => onAnswer(true)}>Share to community</button>
  const keep = <button ref={lastShared ? undefined : firstRef} type="button" className="qz-b qz-consent-no" onClick={() => onAnswer(false)}>Keep private</button>
  return (
    <div className="qz-consent" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="qz-consent-box" role="dialog" aria-modal="true" aria-labelledby="qz-consent-h" aria-describedby="qz-consent-p">
        <button type="button" className="qz-consent-x" onClick={onCancel} aria-label="Cancel"><X aria-hidden="true" /></button>
        <p className="qz-consent-k">Community library</p>
        <h2 id="qz-consent-h">Share this ad with the Qads community?</h2>
        <p id="qz-consent-p">
          The finished photos and videos from this generation would appear on the public wall on this page.
          Your uploaded product photos are never shown. You can take them down anytime in your history.
        </p>
        <div className="qz-consent-actions">{lastShared ? <>{share}{keep}</> : <>{keep}{share}</>}</div>
      </div>
    </div>
  )
}

// ─── Persistence helpers ────────────────────────────────────────────

function persistDraftAndSignIn(form: FormState) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form))
  window.location.href = `/login?redirect_url=${encodeURIComponent('/qads')}`
}
