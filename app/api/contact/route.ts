// POST /api/contact — public marketing site's "Get in touch" form
// (app/(marketing)/contact/page.tsx). Previously a stub that just faked a
// 600ms delay and showed "sent" without actually sending anything anywhere
// (found during the full-site audit, 2026-08-27). Raw fetch to Resend — no new
// dependency, no DB write, so this isn't a data-model change.
//
// Requires operator.contactEmail (lib/site-config.ts) to be filled in — that's
// the destination address. Until it's set, this intentionally 500s instead of
// silently pretending to succeed, same philosophy as SECRETS_ENCRYPTION_KEY in
// lib/crypto.ts: a form that reports "sent" but delivers nothing is worse than
// one that visibly fails.
//
// SECURITY (audit #58): public + unauthenticated, so every field is type- and
// length-checked, HTML-escaped before it goes into the operator's inbox, the
// reply-to must be a plain valid address, and each IP is rate-limited.

import { NextResponse } from 'next/server'
import { operator } from '@/lib/site-config'
import { escapeHtml } from '@/lib/html'
import { isValidEmail } from '@/lib/email-templates'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

interface ContactPayload {
  name?: unknown
  email?: unknown
  message?: unknown
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rl = rateLimit(`contact:${ip}`, 5, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many messages. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    })
  }

  const body = await request.json().catch(() => ({})) as ContactPayload
  const name = typeof body.name === 'string' ? body.name.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email, and message are required' }, { status: 400 })
  }
  if (name.length > 100 || message.length > 5000) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
  }

  // Placeholders like "TODO(michal): …" are not addresses — treat them as unset.
  const to = isValidEmail(operator.contactEmail) ? operator.contactEmail : null
  if (!to) {
    console.error('[contact] operator.contactEmail is not configured (lib/site-config.ts) — dropping a contact message')
    return NextResponse.json({ error: 'Contact inbox is not configured yet. Please try again later.' }, { status: 500 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.error('[contact] RESEND_API_KEY is not set — dropping a contact message')
    return NextResponse.json({ error: 'Email sending is not configured yet. Please try again later.' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'contact@quantecode.com',
        to,
        reply_to: email,
        subject: `Quante contact form — ${name.slice(0, 80)}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem">
            <h2 style="margin:0 0 1rem;font-size:20px">New contact form message</h2>
            <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Name</td>
                <td style="padding:0.75rem 1rem;font-size:14px;font-weight:600">${escapeHtml(name)}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Email</td>
                <td style="padding:0.75rem 1rem;font-size:14px">${escapeHtml(email)}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666">Message</td>
                <td style="padding:0.75rem 1rem;font-size:14px;white-space:pre-wrap">${escapeHtml(message)}</td></tr>
            </table>
            <p style="margin:1.5rem 0 0;font-size:12px;color:#aaa">Sent from the Quante contact form</p>
          </div>
        `,
      }),
    })
    if (!res.ok) {
      const errBody = await res.text()
      console.error('[contact] Resend error:', res.status, errBody)
      return NextResponse.json({ error: 'Failed to send message.' }, { status: 502 })
    }
  } catch (err) {
    console.error('[contact] email send failed:', err)
    return NextResponse.json({ error: 'Failed to send message.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
