// POST /api/notify/waitlist — "Notify me" form on the /api (marketing) page,
// which announces the not-yet-shipped programmatic API. Previously a stub
// that just flipped local state to "done" without recording the email
// anywhere (found during the full-site audit, 2026-08-27). This forwards
// each signup as an email to the operator inbox rather than a DB table —
// a new table would be a data-model change, out of scope for a cosmetic-bug
// sweep; email is enough to not lose signups until there's real demand to
// justify a proper waitlist table.
//
// SECURITY (audit #58): public, so the address must be a plain valid email, is
// HTML-escaped in the operator mail, never logged, and each IP is rate-limited.
import { NextResponse } from 'next/server'
import { operator } from '@/lib/site-config'
import { escapeHtml } from '@/lib/html'
import { isValidEmail } from '@/lib/email-templates'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const rl = rateLimit(`waitlist:${getClientIp(request)}`, 5, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    })
  }

  const { email: rawEmail } = await request.json().catch(() => ({})) as { email?: unknown }
  const email = typeof rawEmail === 'string' ? rawEmail.trim() : ''
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  // Placeholders like "TODO(michal): …" are not addresses — treat them as unset.
  const to = isValidEmail(operator.contactEmail) ? operator.contactEmail : null
  const resendKey = process.env.RESEND_API_KEY

  if (!to || !resendKey) {
    console.error('[notify/waitlist] not configured (contactEmail or RESEND_API_KEY missing) — dropping a signup')
    // Don't fail the user's signup over an operator misconfiguration; the
    // console.error above is the audit trail. Contact page has the same gap
    // and is intentionally stricter (500s) since a lost contact-form message
    // is worse for the sender than a lost waitlist signup.
    return NextResponse.json({ ok: true })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'contact@quantecode.com',
        to,
        subject: 'Quante API waitlist signup',
        html: `<p style="font-family:-apple-system,sans-serif;font-size:14px">New API-launch waitlist signup: <strong>${escapeHtml(email)}</strong></p>`,
      }),
    })
    if (!res.ok) console.error('[notify/waitlist] Resend error:', res.status, await res.text())
  } catch (err) {
    console.error('[notify/waitlist] email send failed:', err)
  }

  return NextResponse.json({ ok: true })
}
