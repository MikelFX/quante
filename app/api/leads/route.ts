// POST /api/leads — the AssetraDigital homepage contact form („Odeslat poptávku“).
//
// Public and unauthenticated, so: honeypot + minimum fill time (silently dropped), per-IP
// limits in memory and in the database, strict field validation (lib/assetra/lead.ts), every
// value HTML-escaped in the notification. The lead is stored first (table `leads`,
// supabase/migration-assetra-leads.sql) and then e-mailed to LEAD_NOTIFY_EMAIL. Either one is
// enough to keep the lead; only when both fail does the visitor see an error.

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkLead, leadEmailHtml, leadSubject } from '@/lib/assetra/lead'
import { isValidEmail, sendEmail } from '@/lib/email-templates'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase/admin'

const PER_IP_DAY = 10
const ALL_PER_HOUR = 100
const DEFAULT_FROM = '"Assetra Digital web" <contact@quantecode.com>'

const FAIL = 'Poptávku se nepodařilo odeslat. Zkuste to prosím za chvíli znovu.'

function hashIp(ip: string) {
  const salt = process.env.LEAD_IP_SALT || process.env.SECRETS_ENCRYPTION_KEY || 'assetra-leads'
  return createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32)
}

// "relation does not exist" / PostgREST "table not in schema cache": migration not run yet.
const missingTable = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rl = rateLimit(`lead:${ip}`, 5, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Poslali jste už několik poptávek za sebou. Zkuste to prosím později.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const body = await request.json().catch(() => null)
  const checked = checkLead(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  if (checked.spam) return NextResponse.json({ ok: true })
  const { lead, contactEmail } = checked

  const ipHash = hashIp(ip)
  const now = new Date()

  // Fleet-wide limits (the in-memory limiter above is per instance). If the check itself fails
  // (e.g. the table is not there yet) the lead is still taken — losing a real customer is worse.
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString()
  const [byIp, all] = await Promise.all([
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', dayAgo),
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', hourAgo),
  ])
  if (!byIp.error && !all.error && ((byIp.count ?? 0) >= PER_IP_DAY || (all.count ?? 0) >= ALL_PER_HOUR)) {
    if ((all.count ?? 0) >= ALL_PER_HOUR) console.error('[leads] global hourly cap reached')
    return NextResponse.json({ error: 'Poptávek je teď moc najednou. Zkuste to prosím později.' }, { status: 429 })
  }

  let id: string | null = null
  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      source: 'web',
      name: lead.jmeno,
      contact: lead.kontakt,
      need: lead.potreba,
      message: lead.zprava,
      ip_hash: ipHash,
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    })
    .select('id')
    .single()
  if (error) {
    console.error('[leads] insert failed:', error.code, error.message,
      missingTable(error) ? '— run supabase/migration-assetra-leads.sql' : '')
  } else {
    id = data.id as string
  }

  const to = process.env.LEAD_NOTIFY_EMAIL?.trim() ?? ''
  let notified = false
  if (isValidEmail(to)) {
    notified = await sendEmail(
      to,
      leadSubject(lead),
      leadEmailHtml(lead, { id, stored: !!id, at: now }),
      process.env.LEAD_NOTIFY_FROM || DEFAULT_FROM,
      { replyTo: contactEmail },
    )
    if (notified && id) {
      await supabaseAdmin.from('leads').update({ notified_at: new Date().toISOString() }).eq('id', id)
    }
  } else {
    console.error('[leads] LEAD_NOTIFY_EMAIL is not set — no notification sent', id ? `(lead ${id} stored)` : '(lead NOT stored either)')
  }

  if (!id && !notified) return NextResponse.json({ error: FAIL }, { status: 500 })
  return NextResponse.json({ ok: true })
}
