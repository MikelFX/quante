// To add a new entry: append one object to content/changelog.json.
// Fields: date (YYYY-MM-DD), title (string), description (string), tags (string[]).
// Entries are displayed newest-first, grouped by month.
//
// PHASE 4b stub — future automation via Vercel REST API:
// Instead of (or in addition to) manual entries, production deployments could be
// fetched automatically:
//   GET https://api.vercel.com/v6/deployments
//     ?projectId=<VERCEL_PROJECT_ID>&target=production&limit=50
//   Authorization: Bearer <VERCEL_TOKEN>
// This would surface each production deploy as a changelog entry.
// Add VERCEL_TOKEN and VERCEL_PROJECT_ID to env vars, then replace the static
// import below with a server-side fetch call.

import type { Metadata } from 'next'
import entries from '@/content/changelog.json'

export const metadata: Metadata = {
  title: 'Changelog — Quante',
  description: 'What\'s new in Quante — release notes and product updates.',
}

const mono = 'var(--font-geist-mono)'

function groupByMonth(items: typeof entries) {
  const groups: Record<string, typeof entries> = {}
  for (const item of [...items].sort((a, b) => b.date.localeCompare(a.date))) {
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

const TAG_COLORS: Record<string, string> = {
  feature:     'rgba(52,211,153,.18)',
  bugfix:      'rgba(248,113,113,.15)',
  platform:    'rgba(111,120,230,.18)',
  ai:          'rgba(99,102,241,.18)',
  design:      'rgba(251,191,36,.15)',
  domains:     'rgba(34,211,238,.15)',
  reliability: 'rgba(52,211,153,.15)',
}

const TAG_TEXT: Record<string, string> = {
  feature:     '#34d399',
  bugfix:      '#f87171',
  platform:    '#7a82e8',
  ai:          '#a5b4fc',
  design:      '#fbbf24',
  domains:     '#22d3ee',
  reliability: '#34d399',
}

export default function ChangelogPage() {
  const groups = groupByMonth(entries)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
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
              <div key={entry.date + entry.title} style={{
                display: 'grid',
                gridTemplateColumns: '48px 1fr',
                gap: '0 20px',
                alignItems: 'start',
              }}>
                {/* Day */}
                <div style={{
                  fontFamily: mono, fontSize: 22, fontWeight: 700, color: '#383845',
                  textAlign: 'right', paddingTop: 2,
                }}>
                  {formatDay(entry.date)}
                </div>

                {/* Entry */}
                <div style={{
                  background: '#0d0d12',
                  border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 12,
                  padding: '18px 20px',
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {entry.tags.map(tag => (
                      <span key={tag} style={{
                        fontFamily: mono, fontSize: 10, letterSpacing: '.06em',
                        background: TAG_COLORS[tag] ?? 'rgba(255,255,255,.08)',
                        color: TAG_TEXT[tag] ?? '#8a8a93',
                        padding: '2px 7px', borderRadius: 4,
                      }}>
                        {tag}
                      </span>
                    ))}
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
