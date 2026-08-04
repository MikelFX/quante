// GET /changelog/rss.xml — RSS 2.0 feed for the product changelog.
// Pulls from changelog_entries; falls back to nothing on DB failure (better than a broken feed).

import { supabaseAdmin } from '@/lib/supabase/admin'

export const revalidate = 300

interface Row {
  id: string
  date: string
  title: string
  description: string
  slug: string | null
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const site = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'
  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .select('id, date, title, description, slug')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) console.error('[changelog/rss] query failed:', error)
  const rows = (data ?? []) as Row[]

  const items = rows.map((r) => {
    const link = `${site}/changelog#${r.slug ?? r.id}`
    const pubDate = new Date(`${r.date}T00:00:00Z`).toUTCString()
    return `    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="false">${r.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(r.description)}</description>
    </item>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Quante Changelog</title>
    <link>${site}/changelog</link>
    <description>Production updates to the Quante platform.</description>
    <language>en</language>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}
