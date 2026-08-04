// Entries live in the changelog_entries table (managed from /admin).
// Falls back to content/changelog.json ONLY if the query succeeds but the table is empty.
// If the query fails, we log loudly and (in dev) render a visible banner.

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fallbackEntries from '@/content/changelog.json'
import { TAG_BG, TAG_FG, isChangelogTag } from '@/lib/changelog'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Changelog — Quante',
  description: 'What\'s new in Quante — release notes and product updates.',
}

interface Entry {
  id?: string
  date: string
  title: string
  description: string
  tags: string[]
  slug?: string | null
}

const mono = 'var(--font-geist-mono)'

function groupByMonth(items: Entry[]) {
  const groups: Record<string, Entry[]> = {}
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
  for (const item of sorted) {
    const [year, month] = item.date.split('-')
    const key = `${year}-${month}`
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

function formatMonthKey(key: string) {
  const [year, month] = key.split('-')
  return new Date(Number(year), Number(month) - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function formatDay(date: string) {
  const [, , day] = date.split('-')
  return Number(day)
}

export default async function ChangelogPage() {
  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .select('id, date, title, description, tags, slug')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  let entries: Entry[]
  let queryFailed = false

  if (error) {
    console.error('[changelog] query failed:', error)
    queryFailed = true
    entries = fallbackEntries as Entry[]
  } else if (!data || data.length === 0) {
    entries = fallbackEntries as Entry[]
  } else {
    entries = data as Entry[]
  }

  const groups = groupByMonth(entries)
  const showDbWarning = queryFailed && process.env.NODE_ENV !== 'production'

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      {showDbWarning && (
        <div style={{
          background: 'rgba(248,113,113,.08)',
          border: '1px solid rgba(248,113,113,.35)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 24,
          color: '#f87171',
          fontFamily: mono,
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          Changelog DB unavailable — showing static fallback. Check server logs and
          run <code>npx tsx scripts/check-changelog.ts</code>.
        </div>
      )}

      <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', color: '#5b5b64', textTransform: 'uppercase', marginBottom: 12 }}>
        Changelog
      </p>
      <h1 style={{ fontSize: 'clamp(28px,5vw,44px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 12, color: '#f4f4f6' }}>
        What&apos;s new
      </h1>
      <p style={{ fontSize: 15, color: '#8a8a93', lineHeight: 1.6, marginBottom: 56 }}>
        Production updates to the Quante platform, newest first.
      </p>

      {Object.entries(groups).map(([monthKey, items]) => (
        <div key={monthKey} style={{ marginBottom: 52 }}>
          <p style={{ fontFamily: mono, fontSize: 11.5, color: '#5b5b64', letterSpacing: '.06em', marginBottom: 24, textTransform: 'uppercase' }}>
            {formatMonthKey(monthKey)}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {items.map(entry => (
              <div
                key={entry.id ?? entry.date + entry.title}
                id={entry.slug ?? undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 1fr',
                  gap: '0 20px',
                  alignItems: 'start',
                  scrollMarginTop: 80,
                }}
              >
                <div style={{
                  fontFamily: mono, fontSize: 22, fontWeight: 700, color: '#383845',
                  textAlign: 'right', paddingTop: 2,
                }}>
                  {formatDay(entry.date)}
                </div>

                <div style={{
                  background: '#0d0d12',
                  border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 12,
                  padding: '18px 20px',
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {entry.tags.map(tag => {
                      const known = isChangelogTag(tag)
                      return (
                        <span key={tag} style={{
                          fontFamily: mono, fontSize: 10, letterSpacing: '.06em',
                          background: known ? TAG_BG[tag] : 'rgba(255,255,255,.06)',
                          color: known ? TAG_FG[tag] : '#8a8a93',
                          padding: '2px 7px', borderRadius: 4,
                        }}>
                          {tag}
                        </span>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f6', marginBottom: 6, lineHeight: 1.3 }}>
                    {entry.title}
                  </p>
                  <p style={{ fontSize: 13.5, color: '#8a8a93', lineHeight: 1.6, margin: 0 }}>
                    {entry.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
