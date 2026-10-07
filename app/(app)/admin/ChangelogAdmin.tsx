'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CHANGELOG_TAGS, TAG_BG, TAG_FG, type ChangelogTag } from '@/lib/changelog'

export interface ChangelogEntry {
  id: string
  date: string
  title: string
  description: string
  tags: string[]
  // V3: entries auto-created by app/api/webhooks/vercel-deploy start as
  // published=false drafts; deployment_id is set only on those (never on
  // entries typed by hand here). Both are undefined until
  // supabase/migration-changelog-v3.sql has been run — treat missing as
  // "published" so existing rows/UI don't regress before that migration runs.
  published?: boolean
  deployment_id?: string | null
}

const mono = 'var(--q-mono)'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgb(var(--q-ink-rgb) / .04)',
  border: '1px solid rgb(var(--q-ink-rgb) / .09)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--q-fg)',
  outline: 'none',
}

const today = () => new Date().toISOString().slice(0, 10)

export function ChangelogAdmin({ entries }: { entries: ChangelogEntry[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState(today)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<ChangelogTag[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setDate(today())
    setTitle('')
    setDescription('')
    setTags([])
    setError(null)
  }

  function startEdit(entry: ChangelogEntry) {
    setEditingId(entry.id)
    setDate(entry.date)
    setTitle(entry.title)
    setDescription(entry.description)
    setTags(entry.tags.filter((t): t is ChangelogTag => (CHANGELOG_TAGS as readonly string[]).includes(t)))
    setError(null)
  }

  function toggleTag(tag: ChangelogTag) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = { date, title, description, tags, ...(editingId ? { id: editingId } : {}) }
    const res = await fetch('/api/admin/changelog', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Failed (${res.status})`)
      return
    }
    resetForm()
    router.refresh()
  }

  // V3: publish a draft entry (auto-created by the Vercel deploy webhook) as-is.
  // Reuses the PATCH endpoint's existing full-entry validation — sends the
  // entry's current fields back unchanged plus published: true, rather than
  // adding a separate lightweight endpoint. Admin can also just click Edit
  // first to rewrite the AI draft, then Update (which does NOT flip
  // published — only this button, or an explicit save from the edit form
  // with published already true, does).
  async function handlePublish(entry: ChangelogEntry) {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/changelog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: entry.id,
        date: entry.date,
        title: entry.title,
        description: entry.description,
        tags: entry.tags,
        published: true,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Publish failed (${res.status})`)
      return
    }
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this changelog entry?')) return
    const res = await fetch(`/api/admin/changelog?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Delete failed (${res.status})`)
      return
    }
    if (editingId === id) resetForm()
    router.refresh()
  }

  return (
    <section style={{ marginTop: '3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', margin: 0 }}>
          Changelog {editingId && <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--q-warn-text)', marginLeft: 8 }}>editing</span>}
        </h2>
      </div>

      <form onSubmit={handleSubmit} style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        border: '1px solid rgb(var(--q-ink-rgb) / .07)', borderRadius: 12, padding: 18,
        marginBottom: '1.25rem',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle} />
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />
        </div>
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CHANGELOG_TAGS.map((tag) => {
            const on = tags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                style={{
                  fontFamily: mono, fontSize: 11, letterSpacing: '.04em',
                  padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  background: on ? TAG_BG[tag] : 'transparent',
                  color: on ? TAG_FG[tag] : 'var(--q-fg3)',
                  border: `1px solid ${on ? TAG_FG[tag] + '55' : 'rgb(var(--q-ink-rgb) / .09)'}`,
                }}
              >
                {tag}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {editingId && (
            <button type="button" onClick={resetForm} style={{
              background: 'none', border: '1px solid rgb(var(--q-ink-rgb) / .12)', color: 'var(--q-fg3)',
              borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            }}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={busy} style={{
            background: 'var(--q-acc)', color: 'var(--q-acc-ink)', border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Saving…' : editingId ? 'Update' : 'Publish'}
          </button>
        </div>

        {error && <p style={{ fontSize: 12, color: 'var(--q-danger-text)', margin: 0 }}>{error}</p>}
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--q-fg4)' }}>
            No entries in the database yet — run supabase/migration-changelog.sql (and migration-changelog-v2.sql) to seed.
          </p>
        )}
        {entries.map((entry) => {
          const isEditing = editingId === entry.id
          // `published` is undefined for rows read before migration-changelog-v3.sql
          // ran (column doesn't exist in the select yet) — treat as published so
          // nothing looks like a phantom draft pre-migration.
          const isDraft = entry.published === false
          return (
            <div key={entry.id} style={{
              display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 10, alignItems: 'start',
              border: `1px solid ${isDraft ? 'rgb(var(--q-warn-rgb) / .4)' : isEditing ? 'rgb(var(--q-warn-rgb) / .35)' : 'rgb(var(--q-ink-rgb) / .06)'}`,
              background: isDraft ? 'rgb(var(--q-warn-rgb) / .05)' : isEditing ? 'rgb(var(--q-warn-rgb) / .04)' : 'transparent',
              borderRadius: 10, padding: '12px 16px',
            }}>
              <span style={{ fontFamily: mono, fontSize: 11.5, color: 'var(--q-fg4)', paddingTop: 2 }}>{entry.date}</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--q-fg)', margin: 0 }}>{entry.title}</p>
                  {isDraft && (
                    <span style={{
                      fontFamily: mono, fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--q-warn-text)', border: '1px solid rgb(var(--q-warn-rgb) / .4)', borderRadius: 4, padding: '1px 6px',
                    }}>
                      Draft{entry.deployment_id ? ' · auto' : ''}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--q-fg3)', lineHeight: 1.55, margin: 0 }}>{entry.description}</p>
                {entry.tags.length > 0 && (
                  <p style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--q-fg4)', margin: '6px 0 0' }}>
                    {entry.tags.join(' · ')}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {isDraft && (
                  <button onClick={() => handlePublish(entry)} disabled={busy} style={{
                    background: 'rgb(var(--q-warn-rgb) / .12)', border: '1px solid rgb(var(--q-warn-rgb) / .4)', color: 'var(--q-warn-text)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: mono,
                    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                  }}>
                    Publish
                  </button>
                )}
                <button onClick={() => startEdit(entry)} style={{
                  background: 'none', border: '1px solid rgb(var(--q-ink-rgb) / .12)', color: 'var(--q-fg3)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: mono, cursor: 'pointer',
                }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(entry.id)} style={{
                  background: 'none', border: '1px solid rgb(var(--q-danger-rgb) / .25)', color: 'var(--q-danger-text)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: mono, cursor: 'pointer',
                }}>
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
