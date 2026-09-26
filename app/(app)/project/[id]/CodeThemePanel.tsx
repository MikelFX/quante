'use client'

// Theme panel for code-gen stores (2026-09-26). Edits only config.design in the store's
// data/config.ts (GET/PUT /api/projects/[id]/theme). Every change is shown instantly in
// the preview iframe through the store's ThemeBridge (postMessage — no build), and saved
// a moment later as a draft code version. It reaches shoppers with the next Publish.

import { useEffect, useRef, useState } from 'react'
import {
  THEME_COLOR_KEYS,
  THEME_COLOR_RE,
  THEME_RADIUS_RE,
  sanitizeTheme,
  themeFirstFamily,
  themePreviewPayload,
  type StoreTheme,
  type ThemeColorKey,
} from '@/lib/store-theme-shared'

interface FontOption { name: string; stack: string; kind: 'sans' | 'serif' | 'mono' }

interface Props {
  projectId: string
  /** Sends a theme to the preview iframe (and remembers it for iframe reloads). */
  onPreview: (payload: ReturnType<typeof themePreviewPayload>) => void
  /** A draft version with the new theme was saved. */
  onSaved: (versionNo: number) => void
  /** Short explanation shown under the panel title (publish state). */
  publishHint: string
}

const COLOR_LABELS: Record<ThemeColorKey, string> = {
  bg: 'Background',
  surface: 'Surface',
  text: 'Text',
  muted: 'Muted text',
  accent: 'Accent',
  accentText: 'Text on accent',
  border: 'Borders',
}

const SAVE_DEBOUNCE_MS = 900

/** #rgb → #rrggbb for <input type="color">; anything that isn't a hex color → null. */
function toPickerHex(value: string): string | null {
  const v = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase()
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7).toLowerCase()
  return null
}

function radiusPx(value: string): number | null {
  const m = value.trim().match(/^(\d{1,3}(?:\.\d+)?)px$/)
  if (m) return Math.round(Number(m[1]))
  return value.trim() === '0' ? 0 : null
}

const label: React.CSSProperties = {
  fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '.06em', color: '#5b5b64', margin: '0 0 8px',
}
const inputBase: React.CSSProperties = {
  background: '#0d0d11', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
  color: '#f4f4f6', fontSize: 12, padding: '6px 8px', outline: 'none',
}

export function CodeThemePanel({ projectId, onPreview, onSaved, publishHint }: Props) {
  const [theme, setTheme] = useState<StoreTheme | null>(null)
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [editable, setEditable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' })
  const [hexDrafts, setHexDrafts] = useState<Partial<Record<ThemeColorKey, string>>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<StoreTheme | null>(null)
  const saving = useRef(false)
  // Callbacks change identity on every Studio render; the save/unmount logic reads the latest.
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/theme`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) { setLoadError(d.error ?? 'Could not load the theme.'); return }
        setFonts(Array.isArray(d.fonts) ? d.fonts : [])
        setEditable(!!d.editable)
        const t = sanitizeTheme(d.theme)
        if (t) setTheme(t)
        else setLoadError("This store's theme can't be edited here — describe the change in Chat instead.")
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load the theme.') })
    return () => { cancelled = true }
  }, [projectId])

  async function save(): Promise<void> {
    if (saving.current || !pending.current) return
    const toSave = pending.current
    pending.current = null
    saving.current = true
    setSaveState({ kind: 'saving' })
    try {
      const res = await fetch(`/api/projects/${projectId}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: toSave }),
        keepalive: true,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Keep the unsaved values queued so the next change (or a retry) saves them.
        if (!pending.current) pending.current = toSave
        setSaveState({ kind: 'error', text: d.error ?? `Could not save (${res.status}).` })
      } else {
        if (!d.unchanged && typeof d.versionNo === 'number') onSavedRef.current(d.versionNo)
        setSaveState(pending.current ? { kind: 'dirty' } : { kind: 'saved', text: d.unchanged ? 'No changes' : `Saved as draft v${d.versionNo}` })
      }
    } catch {
      if (!pending.current) pending.current = toSave
      setSaveState({ kind: 'error', text: 'Could not save — check your connection.' })
    } finally {
      saving.current = false
      if (pending.current && saveTimer.current === null) void save()
    }
  }

  // Flush an unsaved change when the panel closes (e.g. switching to Chat), so the next
  // chat edit builds on top of it.
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (pending.current) void save()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(next: StoreTheme) {
    setTheme(next)
    onPreview(themePreviewPayload(next))
    pending.current = next
    setSaveState({ kind: 'dirty' })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void save() }, SAVE_DEBOUNCE_MS)
  }

  function setColor(key: ThemeColorKey, value: string) {
    if (!theme) return
    update({ ...theme, colors: { ...theme.colors, [key]: value } })
  }

  if (loadError) {
    return <div style={{ padding: 16, fontSize: 12, color: '#8a8a93', lineHeight: 1.6 }}>{loadError}</div>
  }
  if (!theme) {
    return <div style={{ padding: 16, fontSize: 12, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)' }}>loading theme…</div>
  }

  const fontGroups: Array<{ kind: FontOption['kind']; title: string }> = [
    { kind: 'sans', title: 'Sans serif' },
    { kind: 'serif', title: 'Serif' },
    { kind: 'mono', title: 'Monospace' },
  ]
  const fontSelect = (which: 'heading' | 'body') => {
    const current = theme.fonts[which]
    const known = fonts.some((f) => f.stack === current)
    return (
      <select
        value={current}
        disabled={!editable}
        onChange={(e) => update({ ...theme, fonts: { ...theme.fonts, [which]: e.target.value } })}
        style={{ ...inputBase, width: '100%', cursor: editable ? 'pointer' : 'not-allowed' }}
      >
        {!known && <option value={current}>{themeFirstFamily(current)} (current)</option>}
        {fontGroups.map((g) => (
          <optgroup key={g.kind} label={g.title}>
            {fonts.filter((f) => f.kind === g.kind).map((f) => (
              <option key={f.name} value={f.stack}>{f.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    )
  }
  const px = radiusPx(theme.radius)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <p style={{ fontSize: 12, color: '#8a8a93', margin: 0, lineHeight: 1.6 }}>{publishHint}</p>
        {!editable && (
          <p style={{ fontSize: 12, color: '#e0a04f', margin: '8px 0 0', lineHeight: 1.6 }}>
            This store&apos;s config can&apos;t be edited by the panel — describe theme changes in Chat instead.
          </p>
        )}
        <p style={{
          fontSize: 11, margin: '8px 0 0', fontFamily: 'var(--font-geist-mono)',
          color: saveState.kind === 'error' ? '#f87171' : saveState.kind === 'saved' ? '#3ecf8e' : '#5b5b64',
        }}>
          {saveState.kind === 'dirty' ? 'Unsaved changes…'
            : saveState.kind === 'saving' ? 'Saving…'
              : saveState.text ?? ' '}
        </p>
      </div>

      <section>
        <p style={label}>Colors</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {THEME_COLOR_KEYS.map((key) => {
            const value = theme.colors[key]
            const picker = toPickerHex(value)
            const draft = hexDrafts[key] ?? value
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={picker ?? '#000000'}
                  disabled={!editable}
                  onChange={(e) => { setHexDrafts((d) => ({ ...d, [key]: undefined })); setColor(key, e.target.value) }}
                  aria-label={COLOR_LABELS[key]}
                  style={{ width: 30, height: 30, padding: 0, border: '1px solid rgba(255,255,255,.12)', borderRadius: 7, background: 'none', cursor: editable ? 'pointer' : 'not-allowed', flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 12, color: '#c9c9d1' }}>{COLOR_LABELS[key]}</span>
                <input
                  type="text"
                  value={draft}
                  disabled={!editable}
                  spellCheck={false}
                  onChange={(e) => {
                    const v = e.target.value
                    setHexDrafts((d) => ({ ...d, [key]: v }))
                    if (THEME_COLOR_RE.test(v.trim())) setColor(key, v.trim())
                  }}
                  onBlur={() => setHexDrafts((d) => ({ ...d, [key]: undefined }))}
                  style={{
                    ...inputBase, width: 96, fontFamily: 'var(--font-geist-mono)', fontSize: 11,
                    borderColor: THEME_COLOR_RE.test(draft.trim()) ? 'rgba(255,255,255,.1)' : 'rgba(248,113,113,.6)',
                  }}
                />
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <p style={label}>Fonts</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: '0 0 5px' }}>Headings</p>
            {fontSelect('heading')}
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: '0 0 5px' }}>Body text</p>
            {fontSelect('body')}
          </div>
        </div>
      </section>

      <section>
        <p style={label}>Corner radius</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={0}
            max={32}
            step={1}
            value={px ?? 8}
            disabled={!editable}
            onChange={(e) => {
              const v = `${e.target.value}px`
              if (THEME_RADIUS_RE.test(v)) update({ ...theme, radius: v })
            }}
            style={{ flex: 1, accentColor: '#D4FF3F' }}
          />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#c9c9d1', width: 44, textAlign: 'right' }}>
            {theme.radius}
          </span>
        </div>
      </section>
    </div>
  )
}
