import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clerkClient } from '@clerk/nextjs/server'

interface OrderPayload {
  sessionId: string
  customerEmail: string | null
  customerName: string | null
  amount: number
  currency: string
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '').trim()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('project_id, user_id')
    .eq('notification_token', token)
    .maybeSingle()

  if (!secret) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const order = await request.json() as OrderPayload
  console.log('[notify/order] project', secret.project_id, order)

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ ok: true })

  let ownerEmail: string | null = null
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(secret.user_id)
    ownerEmail = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null
  } catch (err) {
    console.error('[notify/order] failed to get user email:', err)
  }

  if (!ownerEmail) return NextResponse.json({ ok: true })

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'orders@quante.io',
        to: ownerEmail,
        subject: `New order — ${order.currency} ${order.amount.toFixed(2)}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem">
            <h2 style="margin:0 0 1rem;font-size:20px">New order received!</h2>
            <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Customer</td>
                <td style="padding:0.75rem 1rem;font-size:14px;font-weight:600">${order.customerName ?? '—'}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Email</td>
                <td style="padding:0.75rem 1rem;font-size:14px">${order.customerEmail ?? '—'}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666;border-bottom:1px solid #eee">Amount</td>
                <td style="padding:0.75rem 1rem;font-size:16px;font-weight:700">${order.currency} ${order.amount.toFixed(2)}</td></tr>
              <tr><td style="padding:0.75rem 1rem;font-size:13px;color:#666">Order ID</td>
                <td style="padding:0.75rem 1rem;font-size:12px;color:#999;font-family:monospace">${order.sessionId}</td></tr>
            </table>
            <p style="margin:1.5rem 0 0;font-size:12px;color:#aaa">Sent by Quante</p>
          </div>
        `,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[notify/order] Resend error:', res.status, body)
    }
  } catch (err) {
    console.error('[notify/order] email send failed:', err)
  }

  return NextResponse.json({ ok: true })
}
