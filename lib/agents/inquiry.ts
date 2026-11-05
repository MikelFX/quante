// An inquiry an AI agent sends for its person (owner 2026-11-05: agents act for people — let them
// ask us for a quote without a browser). It goes into the same `leads` table and notification as
// the website form, with source 'agent'. The agent must confirm the person asked for it
// (`consent: true`); we never e-mail the given contact, only AssetraDigital is notified, and the
// limits are tighter than the form's. Validation is the form's own (lib/assetra/lead.ts).

import { createHash } from 'node:crypto'
import { leadEmailHtml, leadSubject } from '@/lib/assetra/lead'
import { AGENT_INQUIRY_LIMITS, checkInquiry, type InquiryInput, type InquiryResult } from './inquiry-check'
import { isValidEmail, sendEmail } from '@/lib/email-templates'
import { rateLimit } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase/admin'

function hashIp(ip: string) {
  const salt = process.env.LEAD_IP_SALT || process.env.SECRETS_ENCRYPTION_KEY || 'assetra-leads'
  return createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32)
}

export async function submitInquiry(b: InquiryInput, ip: string, userAgent: string): Promise<InquiryResult> {
  const rl = rateLimit(`agent-inquiry:${ip}`, 2, 60 * 60_000)
  if (!rl.allowed) return { ok: false, status: 429, error: 'Too many inquiries from this address. Try again later.' }
  const c = checkInquiry(b)
  if (!c.ok) return { ok: false, status: 400, error: c.error }

  const ipHash = hashIp(ip)
  const now = Date.now()
  const [byIp, all] = await Promise.all([
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(now - 24 * 3600_000).toISOString()),
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('source', 'agent').gte('created_at', new Date(now - 3600_000).toISOString()),
  ])
  if (byIp.error || all.error) return { ok: false, status: 503, error: 'Inquiries are not available right now. Use the form at https://assetradigital.agency/#kontakt.' }
  if ((byIp.count ?? 0) >= AGENT_INQUIRY_LIMITS.perIpDay || (all.count ?? 0) >= AGENT_INQUIRY_LIMITS.allPerHour) {
    return { ok: false, status: 429, error: 'Too many inquiries right now. Try again later.' }
  }

  const { data, error } = await supabaseAdmin.from('leads').insert({
    source: 'agent', name: c.lead.jmeno, contact: c.lead.kontakt, need: c.lead.potreba, message: c.lead.zprava,
    ip_hash: ipHash, user_agent: userAgent.slice(0, 300),
  }).select('id').single()
  if (error) return { ok: false, status: 503, error: 'Inquiries are not available right now. Use the form at https://assetradigital.agency/#kontakt.' }
  const id = data.id as string

  const to = process.env.LEAD_NOTIFY_EMAIL?.trim() ?? ''
  if (isValidEmail(to)) {
    const sent = await sendEmail(to, `[agent] ${leadSubject(c.lead)}`, leadEmailHtml(c.lead, { id, stored: true, at: new Date() }),
      process.env.LEAD_NOTIFY_FROM || '"Assetra Digital web" <contact@quantecode.com>', { replyTo: c.contactEmail })
    if (sent) await supabaseAdmin.from('leads').update({ notified_at: new Date().toISOString() }).eq('id', id)
  }
  return { ok: true, id }
}
