// POST /api/notify/waitlist — "Notify me" form on the /api (marketing) page,
// which announces the not-yet-shipped programmatic API. Previously a stub
// that just flipped local state to "done" without recording the email
// anywhere (found during the full-site audit, 2026-08-27). This forwards
// each signup as an email to the operator inbox rather than a DB table —
// a new table would be a data-model change, out of scope for a cosmetic-bug
// sweep; email is enough to not lose signups until there's real demand to
// justify a proper waitlist table.
import { NextResponse } from 'next/server'
import { operator } from '@/lib/site-config'

export async function POST(request: Request) {
  const { email } = await request.json().catch(() => ({})) as { email?: string }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const to = operator.contactEmail && !operator.contactEmail.includes('[TO')
    ? operator.contactEmail
    : null
  const resendKey = process.env.RESEND_API_KEY

  if (!to || !resendKey) {
    console.error('[notify/waitlist] not configured (contactEmail or RESEND_API_KEY missing) — dropping signup:', email)
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
        html: `<p style="font-family:-apple-system,sans-serif;font-size:14px">New API-launch waitlist signup: <strong>${email}</strong></p>`,
      }),
    })
    if (!res.ok) console.error('[notify/waitlist] Resend error:', res.status, await res.text())
  } catch (err) {
    console.error('[notify/waitlist] email send failed:', err)
  }

  return NextResponse.json({ ok: true })
}
