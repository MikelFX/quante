// POST /api/contact — public marketing site's "Get in touch" form
// (app/(marketing)/contact/page.tsx). Previously a stub that just faked a
// 600ms delay and showed "sent" without actually sending anything anywhere
// (found during the full-site audit, 2026-08-27). Mirrors the raw-fetch-to-
// Resend pattern already used in app/api/notify/order/route.ts — no new
// dependency, no DB write, so this isn't a data-model change.
//
// Requires operator.contactEmail (lib/site-config.ts) to be filled in — that's
// the destination address. Until it's set, this intentionally 500s instead of
// silently pretending to succeed, same philosophy as SECRETS_ENCRYPTION_KEY in
// lib/crypto.ts: a form that reports "sent" but delivers nothing is worse than
// one that visibly fails.
import { NextResponse } from 'next/server'
import { operator } from '@/lib/site-config'

interface ContactPayload {
  name?: string
  email?: string
  message?: string
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as ContactPayload
  const { name, email, message } = body

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email, and message are required' }, { status: 400 })
  }

  const to = operator.contactEmail && !operator.contactEmail.includes('[TO')
    ? operator.contactEmail
    : null
  if (!to) {
    console.error('[contact] operator.contactEmail is not configured (lib/site-config.ts) — dropping message from', email)
    return NextResponse.json({ error: 'Contact inbox is not configured yet. Please try again later.' }, { status: 500 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.error('[contact] RESEND_API_KEY is not set — dropping message from', email)
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
        subject: `Quante contact form — ${name}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem">
            <h2 style="margin:0 0 1rem;font-size:20px">New contact form message</h2>
            <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Name</td>
                <td style="padding:0.75rem 1rem;font-size:14px;font-weight:600">${name}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Email</td>
                <td style="padding:0.75rem 1rem;font-size:14px">${email}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666">Message</td>
                <td style="padding:0.75rem 1rem;font-size:14px;white-space:pre-wrap">${message}</td></tr>
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
