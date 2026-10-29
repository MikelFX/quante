// Qads Plan — the posting calendar as files the owner takes anywhere: CSV (Meta Business Suite,
// a spreadsheet, a scheduler's import) and iCalendar (.ics, all-day events in any calendar app).
// Pure. Day 1 is the start date the owner picks in the plan view.

import type { CalendarPost, Plan } from './model.ts'

const CHANNEL_LABEL: Record<CalendarPost['channel'], string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube Shorts',
  facebook: 'Facebook',
}

/** YYYY-MM-DD of plan day `day` (1-based) from a YYYY-MM-DD start, in UTC (no DST drift). */
export function postDate(start: string, day: number): string {
  const t = Date.parse(`${start}T00:00:00Z`)
  if (!Number.isFinite(t)) throw new Error('Invalid start date')
  return new Date(t + (day - 1) * 86_400_000).toISOString().slice(0, 10)
}

function postText(plan: Plan, p: CalendarPost): { title: string; body: string } {
  const ad = p.adIndex !== null ? plan.ads[p.adIndex] : null
  const title = `${CHANNEL_LABEL[p.channel]}: ${ad ? `Ad ${p.adIndex! + 1} — ${ad.hook || ad.angle}` : p.idea}`
  const tags = p.hashtags.map((h) => `#${h}`).join(' ')
  const body = [ad ? p.idea : null, p.caption, tags].filter(Boolean).join('\n\n')
  return { title, body }
}

function csvCell(v: string): string {
  // Quote everything; a leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return `"${safe.replace(/"/g, '""')}"`
}

export function calendarCsv(plan: Plan, start: string): string {
  const head = ['date', 'channel', 'type', 'ad', 'idea', 'caption', 'hashtags']
  const rows = plan.calendar.map((p) => [
    postDate(start, p.day),
    CHANNEL_LABEL[p.channel],
    p.adIndex !== null ? 'ad' : 'organic',
    p.adIndex !== null ? `Ad ${p.adIndex + 1}` : '',
    p.idea,
    p.caption,
    p.hashtags.map((h) => `#${h}`).join(' '),
  ])
  // BOM so Excel opens Czech characters correctly.
  return '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 folding: lines over 75 octets continue on the next line after one space. */
function fold(line: string): string {
  const bytes = new TextEncoder()
  if (bytes.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function calendarIcs(plan: Plan, start: string, opts: { planId: string; storeName: string; now?: Date }): string {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Quante//Qads Plan//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(`${opts.storeName || 'Store'} — Qads plan`)}`,
  ]
  plan.calendar.forEach((p, i) => {
    const day = postDate(start, p.day).replace(/-/g, '')
    const next = postDate(start, p.day + 1).replace(/-/g, '')
    const { title, body } = postText(plan, p)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${opts.planId}-${i}@quantecode.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText(body)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
