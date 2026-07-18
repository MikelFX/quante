'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ChangelogEntry {
  id: string
  date: string
  title: string
  description: string
  tags: string[]
}

const mono = 'var(--font-geist-mono)'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  color: '#f4f4f6',
  outline: 'none',
}

export function ChangelogAdmin({ entries }: { entries: ChangelogEntry[] }) {
  const router = useRouter()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to save entry')
      return
    }
    setTitle('')
    setDescription('')
    setTags('')
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this changelog entry?')) return
    await fetch('/api/admin/changelog', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    router.refresh()
  }

  return (
    <section style={{ marginTop: '3rem' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', marginBottom: '1rem' }}>
        Changelog
      </h2>

      <form onSubmit={handleSubmit} style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 18,
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
          <input
            placeholder="Tags (comma-separated: feature, bugfix, platform, ai, design, domains, reliability)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={busy} style={{
            background: '#f4f4f6', color: '#0a0a0e', border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Saving…' : 'Publish'}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 && (
          <p style={{ fontSize: 12.5, color: '#5b5b64' }}>
            No entries in the database yet — run supabase/migration-changelog.sql to create the table and seed existing entries.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} style={{
            display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 14, alignItems: 'start',
            border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 16px',
          }}>
            <span style={{ fontFamily: mono, fontSize: 11.5, color: '#5b5b64', paddingTop: 2 }}>{entry.date}</span>
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: '#f4f4f6', margin: '0 0 3px' }}>{entry.title}</p>
              <p style={{ fontSize: 12.5, color: '#8a8a93', lineHeight: 1.55, margin: 0 }}>{entry.description}</p>
              {entry.tags.length > 0 && (
                <p style={{ fontFamily: mono, fontSize: 10.5, color: '#5b5b64', margin: '6px 0 0' }}>
                  {entry.tags.join(' · ')}
                </p>
              )}
            </div>
            <button onClick={() => handleDelete(entry.id)} style={{
              background: 'none', border: '1px solid rgba(248,113,113,.25)', color: '#f87171',
              borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: mono, cursor: 'pointer',
            }}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
