'use client'

// /qads → "Character": an AI character talks about the product to camera (lib/qads/tiktoker.ts).
// Two calm steps in the same glass box as the ad composer:
//   1. Character — pick one of yours or build a new one from a few chips (Higgsfield AI Influencer).
//   2. Product — a photo + its name; Generate writes the script and renders a 9:16 talking clip.
// Results go to the shared results grid of the page (onStarted). Arriving from the website's
// launch panel (/qads?mode=character&c=<traits>) opens the builder with those traits picked.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ImagePlus, Plus, Sparkles, X } from 'lucide-react'
import {
  CHARACTER_TRAITS,
  DEFAULT_TRAITS,
  describeTraits,
  traitsToParam,
  type CharacterTraits,
} from '@/lib/qads/tiktoker'
import { TIKTOKER_DURATIONS, TIKTOKER_LAUNCH, characterCredits, computeTiktokerCost, isTiktokerLaunch } from '@/lib/qads/pricing'

type Language = 'cs' | 'en' | 'sk' | 'de'

interface Character { id: string; summary: string; status: string; imageUrl: string | null; createdAt: string }
interface UploadedPhoto { storagePath: string; signedUrl: string }

const LANGS: Language[] = ['cs', 'en', 'sk', 'de']
const DRAFT_KEY = 'qads:tiktoker:v1'

export function QadsTiktoker({
  signedIn,
  agency,
  initialTraits,
  onSignIn,
  askShare,
  onStarted,
}: {
  signedIn: boolean
  agency: boolean
  /** From the website's launch panel; opens the builder when set. */
  initialTraits: CharacterTraits | null
  onSignIn: (returnTo: string) => void
  askShare: () => Promise<boolean | null>
  onStarted: (generationId: string, credits: number) => void
}) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [building, setBuilding] = useState<boolean>(!!initialTraits)
  const [traits, setTraits] = useState<CharacterTraits>(initialTraits && Object.keys(initialTraits).length ? { ...DEFAULT_TRAITS, ...initialTraits } : DEFAULT_TRAITS)
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null)
  const [uploading, setUploading] = useState(false)
  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [seconds, setSeconds] = useState<number>(15)
  const [variants, setVariants] = useState(1)
  const [language, setLanguage] = useState<Language>('cs')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const launch = isTiktokerLaunch()
  const charCost = characterCredits()
  const cost = useMemo(() => computeTiktokerCost(variants, seconds), [variants, seconds])
  const [daysLeft] = useState(() => Math.max(0, Math.ceil((Date.parse(TIKTOKER_LAUNCH.endsAt) - Date.now()) / 86_400_000)))

  // A draft survives the sign-in round trip (traits travel in the URL, the rest here).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      sessionStorage.removeItem(DRAFT_KEY)
      const d = JSON.parse(raw) as { note?: string; productName?: string; productDescription?: string }
      if (d.note) setNote(d.note)
      if (d.productName) setProductName(d.productName)
      if (d.productDescription) setProductDescription(d.productDescription)
    } catch {}
  }, [])

  const loadCharacters = useCallback(async () => {
    const res = await fetch('/api/qads/characters').catch(() => null)
    if (!res?.ok) return [] as Character[]
    const list = ((await res.json()).characters ?? []) as Character[]
    setCharacters(list)
    return list
  }, [])

  useEffect(() => {
    if (!signedIn) return
    void loadCharacters().then(list => {
      const ready = list.find(c => c.status === 'completed' && c.imageUrl)
      setSelected(s => s ?? ready?.id ?? null)
      if (!list.length) setBuilding(true)
    })
  }, [signedIn, loadCharacters])

  // While a character is being drawn, check every few seconds; select it when it lands.
  const pending = characters.some(c => c.status === 'queued' || c.status === 'generating')
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => {
      void loadCharacters().then(list => {
        const fresh = list[0]
        if (fresh?.status === 'completed' && fresh.imageUrl) setSelected(fresh.id)
      })
    }, 4000)
    return () => clearInterval(t)
  }, [pending, loadCharacters])

  const returnTo = () => `/qads?mode=character&c=${traitsToParam(traits)}`
  const requireSignIn = () => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ note, productName, productDescription })) } catch {}
    onSignIn(returnTo())
  }

  const createCharacter = async () => {
    if (!signedIn) return requireSignIn()
    setError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/qads/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits, note, photoStoragePath: photo?.storagePath ?? null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.code === 'insufficient_credits'
          ? `Not enough credits (${data.balance ?? '?'} / need ${data.needed ?? '?'}). Top up in Billing.`
          : String(data.error ?? 'Could not create the character.'))
        return
      }
      setBuilding(false)
      await loadCharacters()
    } finally {
      setCreating(false)
    }
  }

  const upload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!signedIn) return requireSignIn()
    setError(null)
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/qads/upload', { method: 'POST', body: fd }).catch(() => null)
    if (res?.ok) setPhoto(await res.json())
    else setError('Upload failed. Please try another photo.')
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedChar = characters.find(c => c.id === selected && c.status === 'completed' && c.imageUrl)
  const canGenerate = !!selectedChar && !!photo && productName.trim().length > 0 && !submitting && !uploading

  const generate = async () => {
    if (!signedIn) return requireSignIn()
    if (!selectedChar) return setError('Pick or create a character first.')
    if (!photo) return setError('Add a photo of the product.')
    if (!productName.trim()) return setError('Name the product.')
    const share = await askShare()
    if (share === null) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/qads/tiktoker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: productName.trim().slice(0, 120),
          productDescription: productDescription.trim().slice(0, 2000),
          photoStoragePaths: [photo.storagePath],
          characterId: selectedChar.id,
          durationSeconds: seconds,
          variants,
          language,
          shareCommunity: share,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.code === 'insufficient_credits'
          ? `Not enough credits (${data.balance ?? '?'} / need ${data.needed ?? '?'}). Top up in Billing.`
          : String(data.error ?? 'Generation failed. Please try again.'))
        return
      }
      onStarted(data.generationId as string, Number(data.totalCredits ?? 0))
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="qz-box qt" aria-label="Character video">
      <div className="qt-collab" aria-hidden="true">
        <span className="qt-collab-q">Qads</span>
        <span className="qt-collab-x">×</span>
        <span className="qt-collab-h">Higgsfield</span>
      </div>
      {launch && (
        <p className="qt-launch">
          <Sparkles aria-hidden="true" />
          Launch offer · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left at our cost — we earn nothing on it.
        </p>
      )}

      {/* ── Step 1: the character ── */}
      <div className="qt-step">
        <p className="qt-step-h"><span>1</span>Your character</p>
        <div className="qt-cast" role="listbox" aria-label="Your characters">
          {characters.map(c => {
            const ready = c.status === 'completed' && !!c.imageUrl
            const failed = ['failed', 'nsfw', 'canceled'].includes(c.status)
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={selected === c.id}
                className={'qt-card' + (ready ? '' : failed ? ' failed' : ' busy')}
                disabled={!ready}
                onClick={() => { setSelected(c.id); setBuilding(false) }}
                title={c.summary}
              >
                {ready
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.imageUrl!} alt={c.summary} />
                  : <span className="qt-card-s">{failed ? 'Failed' : 'Drawing…'}</span>}
                {selected === c.id && ready && <span className="qt-tick" aria-hidden="true"><Check /></span>}
              </button>
            )
          })}
          <button type="button" className={'qt-card qt-new' + (building ? ' on' : '')} aria-expanded={building} aria-controls="qt-builder" onClick={() => setBuilding(b => !b)}>
            <Plus aria-hidden="true" />
            <span>New character</span>
          </button>
        </div>

        <div id="qt-builder" className="qt-builder" data-open={building ? 'true' : 'false'} inert={!building}>
          <div className="qt-builder-in">
            {CHARACTER_TRAITS.map(g => (
              <div key={g.key} className="qz-row" role="group" aria-label={g.en}>
                <span className="qz-row-l" aria-hidden="true">{g.en}</span>
                <div className="qz-row-c">
                  {g.options.map(o => (
                    <button key={o.id} type="button" className="qz-b" aria-pressed={traits[g.key] === o.id} onClick={() => setTraits(t => ({ ...t, [g.key]: o.id }))}>
                      {o.en}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <label className="vh" htmlFor="qt-note">Anything else about the character (optional)</label>
            <input id="qt-note" className="qt-input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything else? e.g. freckles, warm smile, glasses (optional)" />
            <div className="qt-builder-go">
              <span className="qt-sum">{describeTraits(traits)}</span>
              <button type="button" className="qz-go" disabled={creating || pending} onClick={() => void createCharacter()}>
                {creating ? 'Starting…' : pending ? 'Drawing…' : 'Create character'}
                <span className="cr">{agency ? 'Included' : `${charCost} cr`}</span>
                <span className="ar" aria-hidden="true"><ArrowRight /></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step 2: the product ── */}
      <div className="qt-step">
        <p className="qt-step-h"><span>2</span>The product</p>
        <div className="qt-product">
          {photo ? (
            <div className="qz-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.signedUrl} alt="Product photo" />
              <button type="button" onClick={() => setPhoto(null)} aria-label="Remove the photo"><X /></button>
            </div>
          ) : (
            <button type="button" className="qz-add qt-photo" onClick={() => (signedIn ? fileRef.current?.click() : requireSignIn())} disabled={uploading} aria-label="Add a product photo">
              <ImagePlus aria-hidden="true" />
              {uploading && <span className="vh">Uploading…</span>}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => void upload(e.target.files)} />
          <div className="qt-fields">
            <label className="vh" htmlFor="qt-name">Product name</label>
            <input id="qt-name" className="qt-input" maxLength={120} value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name" />
            <label className="vh" htmlFor="qt-desc">What should the character mention? (optional)</label>
            <textarea id="qt-desc" className="qt-input qt-area" rows={2} maxLength={2000} value={productDescription} onChange={e => setProductDescription(e.target.value)} placeholder="What should they mention? (optional)" />
          </div>
        </div>
      </div>

      <div className="qz-bar qt-bar">
        <div className="qt-seg" role="group" aria-label="Length">
          {TIKTOKER_DURATIONS.map(s => (
            <button key={s} type="button" className="qz-b sm" aria-pressed={seconds === s} onClick={() => setSeconds(s)}>{s} s</button>
          ))}
        </div>
        <div className="qt-seg" role="group" aria-label="Variants">
          {[1, 2].map(n => (
            <button key={n} type="button" className="qz-b sm" aria-pressed={variants === n} onClick={() => setVariants(n)}>×{n}</button>
          ))}
        </div>
        <div className="qt-seg" role="group" aria-label="Spoken language">
          {LANGS.map(l => (
            <button key={l} type="button" className="qz-b sm" aria-pressed={language === l} onClick={() => setLanguage(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
        <button type="button" className="qz-go" disabled={(signedIn && !canGenerate) || submitting} onClick={() => void generate()}>
          {submitting ? 'Writing…' : 'Make the video'}
          <span className="cr">{agency ? 'Included' : `${cost.totalCredits} cr`}</span>
          <span className="ar" aria-hidden="true"><ArrowRight /></span>
        </button>
      </div>

      <p className="qt-fine">
        The character is AI-generated. Label the video as AI content when you post it (TikTok and Meta require it).
      </p>
      {error && <p className="qz-err" role="alert">{error}</p>}
    </section>
  )
}
