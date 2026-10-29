'use client'

// Brand kit of one store (Dashboard phase 2, lib/brand-kit): logo, photos and texts kept once and
// reused by Qads (photos + texts), Qgent (texts) and the visual editor (photos). Colours are only
// shown — they are the store's config.design and change in the Studio's Theme panel. Images are
// uploaded with the existing /api/upload (the store's own store-assets folder); saving is one PUT
// of the whole kit. Free: nothing here spends credits.
import { useRef, useState } from 'react'
import Link from 'next/link'
import { MAX_PHOTOS, TEXT_LIMITS, type BrandKit, type BrandTexts } from '@/lib/brand-kit/model'
import type { BrandTheme } from '@/lib/grideet/model'

interface Props {
  projectId: string
  name: string
  kit: BrandKit
  theme: BrandTheme | null | undefined
  /** Product photos of the store that are already Quante files — one tap adds them to the kit. */
  suggestions: string[]
  onSaved: (kit: BrandKit) => void
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

const FIELDS: Array<{ key: keyof BrandTexts; label: string; hint: string; area?: boolean }> = [
  { key: 'tagline', label: 'Tagline', hint: 'One line that says what the brand is.' },
  { key: 'description', label: 'About the brand', hint: 'What you sell, what makes it different, facts worth repeating.', area: true },
  { key: 'audience', label: 'Audience', hint: 'Who buys it and why.', area: true },
  { key: 'tone', label: 'Tone of voice', hint: 'For example: warm, plain-spoken, a little playful.' },
]

async function upload(file: File, projectId: string): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('projectId', projectId)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data.url !== 'string') throw new Error(data.error ?? 'Upload failed.')
  return data.url
}

export function BrandKitPanel({ projectId, name, kit, theme, suggestions, onSaved }: Props) {
  const [draft, setDraft] = useState<BrandKit>(kit)
  const [busy, setBusy] = useState<null | 'upload' | 'save'>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(kit)
  const room = MAX_PHOTOS - draft.photos.length
  const offer = suggestions.filter((u) => !draft.photos.includes(u)).slice(0, 8)
  const swatches = theme ? ([['Background', theme.bg], ['Surface', theme.surface], ['Text', theme.text], ['Accent', theme.accent]] as const).filter(([, c]) => !!c) : []

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setBusy('upload'); setMsg(null)
    const added: string[] = []
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, room))) added.push(await upload(f, projectId))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Upload failed.' })
    } finally {
      setDraft((d) => ({ ...d, photos: [...d.photos, ...added].slice(0, MAX_PHOTOS) }))
      setBusy(null)
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  async function setLogo(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setBusy('upload'); setMsg(null)
    try {
      const url = await upload(f, projectId)
      setDraft((d) => ({ ...d, logoUrl: url }))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Upload failed.' })
    } finally {
      setBusy(null)
      if (logoRef.current) logoRef.current.value = ''
    }
  }

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/brand`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.kit) { setMsg({ kind: 'error', text: data.error ?? 'Could not save.' }); return }
      setDraft(data.kit)
      onSaved(data.kit)
      setMsg({ kind: 'ok', text: 'Saved. Qads, Qgent and the visual editor use it from now on.' })
    } catch {
      setMsg({ kind: 'error', text: 'Could not save — check your connection.' })
    } finally {
      setBusy(null)
    }
  }

  const logo = draft.logoUrl ?? theme?.image ?? null

  return (
    <section className="gd-kit" aria-label={`Brand kit of ${name}`}>
      <p className="gd-kit-lead">Kept once for this brand. Qads uses the photos and texts, Qgent the texts, the visual editor the photos.</p>

      <div className="gd-kit-row">
        <div className="gd-kit-block">
          <h3>Logo</h3>
          <div className="gd-kit-logo">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={`${name} logo`} />
            ) : <span className="gd-quiet">No logo</span>}
          </div>
          {!draft.logoUrl && logo && <p className="gd-kit-hint">The store&apos;s own logo. Upload one to keep a separate one here.</p>}
          <div className="gd-kit-btns">
            <button type="button" className="q-btn q-btn-gl" disabled={!!busy} onClick={() => logoRef.current?.click()}>{draft.logoUrl ? 'Replace' : 'Upload'}</button>
            {draft.logoUrl && <button type="button" className="gd-link" disabled={!!busy} onClick={() => setDraft((d) => ({ ...d, logoUrl: null }))}>Remove</button>}
          </div>
          <input ref={logoRef} type="file" accept={ACCEPT} hidden onChange={(e) => void setLogo(e.target.files)} />
        </div>

        <div className="gd-kit-block">
          <h3>Colours</h3>
          {swatches.length > 0 ? (
            <ul className="gd-kit-sw">
              {swatches.map(([label, c]) => (
                <li key={label}><span className="gd-kit-chip" style={{ background: c }} aria-hidden="true" /><span>{label}</span><span className="gd-mono">{c}</span></li>
              ))}
            </ul>
          ) : <p className="gd-quiet">The colours appear once the store is generated.</p>}
          <Link href={`/project/${projectId}?tab=theme`} className="gd-link">Change colours in the Studio →</Link>
        </div>
      </div>

      <div className="gd-kit-block">
        <h3>Photos <span className="gd-mono">{draft.photos.length} / {MAX_PHOTOS}</span></h3>
        <div className="gd-kit-photos">
          {draft.photos.map((u, i) => (
            <div key={u} className="gd-kit-ph">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Brand photo ${i + 1}`} loading="lazy" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={!!busy} onClick={() => setDraft((d) => ({ ...d, photos: d.photos.filter((x) => x !== u) }))}>✕</button>
            </div>
          ))}
          {room > 0 && (
            <button type="button" className="gd-kit-add" disabled={!!busy} onClick={() => photoRef.current?.click()}>
              {busy === 'upload' ? 'Uploading…' : '+ Add photos'}
            </button>
          )}
        </div>
        <input ref={photoRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
        {offer.length > 0 && room > 0 && (
          <div className="gd-kit-offer">
            <span className="gd-kit-hint">From the store&apos;s products — tap to add:</span>
            <div className="gd-kit-photos">
              {offer.map((u) => (
                <button key={u} type="button" className="gd-kit-ph gd-kit-pick" disabled={!!busy} aria-label="Add this product photo to the brand kit"
                  onClick={() => setDraft((d) => ({ ...d, photos: [...d.photos, u].slice(0, MAX_PHOTOS) }))}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="gd-kit-texts">
        {FIELDS.map((f) => (
          <label key={f.key} className="gd-kit-field">
            <span>{f.label}</span>
            {f.area ? (
              <textarea rows={3} maxLength={TEXT_LIMITS[f.key]} value={draft.texts[f.key]} placeholder={f.hint}
                onChange={(e) => setDraft((d) => ({ ...d, texts: { ...d.texts, [f.key]: e.target.value } }))} />
            ) : (
              <input type="text" maxLength={TEXT_LIMITS[f.key]} value={draft.texts[f.key]} placeholder={f.hint}
                onChange={(e) => setDraft((d) => ({ ...d, texts: { ...d.texts, [f.key]: e.target.value } }))} />
            )}
          </label>
        ))}
      </div>

      {msg && <p role="status" className={msg.kind === 'error' ? 'gd-kit-err' : 'gd-kit-ok'}>{msg.text}</p>}
      <div className="gd-kit-btns">
        <button type="button" className="q-btn" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save brand kit'}</button>
        {dirty && <button type="button" className="gd-link" disabled={!!busy} onClick={() => { setDraft(kit); setMsg(null) }}>Discard changes</button>}
      </div>
    </section>
  )
}
