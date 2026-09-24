// POST /api/quante/email-test
// Sends a sample order confirmation email to the merchant's own (verified) address.
// Used in the Studio to verify Resend integration before going live.
//
// Security (audit 2026-09-23): this used to send to manifest.merchant.kontakt.email —
// a free-text field the user controls — with unescaped manifest values in the body, no
// rate limit and no cost. That made it a phishing relay ("order confirmation, pay to
// this IBAN") from Quante's DKIM-signed domain. Now:
//   - the recipient is always one of the signed-in user's VERIFIED Clerk addresses;
//   - every manifest value in the HTML is escaped (centrally, in lib/email-templates.ts);
//   - per-user / per-project hourly limits + a DB-backed cooldown per project.

import { NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { orderConfirmationEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

const USER_LIMIT_PER_HOUR = 5
const PROJECT_LIMIT_PER_HOUR = 5
// Persisted across serverless instances (the in-memory limiter is per instance).
const PROJECT_COOLDOWN_MS = 60_000
const DEFAULT_ACCENT = '#111111'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let projectId: unknown
  try { ({ projectId } = await request.json()) }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const userLimit = rateLimit(`email-test:${userId}`, USER_LIMIT_PER_HOUR, 3_600_000)
  const projectLimit = rateLimit(`email-test-project:${project.id}`, PROJECT_LIMIT_PER_HOUR, 3_600_000)
  if (!userLimit.allowed || !projectLimit.allowed) {
    return NextResponse.json({ error: 'Too many test e-mails — try again later.' }, { status: 429 })
  }

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('email_test_sent_at')
    .eq('project_id', project.id)
    .maybeSingle()
  const lastSent = secrets?.email_test_sent_at ? Date.parse(secrets.email_test_sent_at as string) : NaN
  if (Number.isFinite(lastSent) && Date.now() - lastSent < PROJECT_COOLDOWN_MS) {
    return NextResponse.json({ error: 'A test e-mail was just sent — wait a minute and try again.' }, { status: 429 })
  }

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', project.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest?.merchant) {
    return NextResponse.json({ error: 'Merchant data not configured' }, { status: 422 })
  }

  // Recipient: only an address the signed-in user has verified with Clerk. Prefer the
  // manifest's merchant contact e-mail when it IS one of those, else the primary one.
  const to = await resolveVerifiedRecipient(userId, manifest.merchant.kontakt?.email)
  if (!to) {
    return NextResponse.json({ error: 'Your account has no verified e-mail address to send the test to.' }, { status: 400 })
  }

  const accent = typeof manifest.design?.palette?.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(manifest.design.palette.accent)
    ? manifest.design.palette.accent
    : DEFAULT_ACCENT
  const rawCurrency = manifest.catalog?.currency
  const currency = typeof rawCurrency === 'string' && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'CZK'

  // Raw (plain-text) values only: lib/email-templates.ts escapes every interpolated value
  // itself, so escaping here too would double-encode ("Káva &amp;amp; Čaj") and would also
  // leak entities into the plain-text subject and break the template's isValidEmail().
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const { subject, html } = orderConfirmationEmail({
    orderNumber: `${new Date().getFullYear()}-TEST`,
    customerName: str(manifest.merchant.zodpovedna_osoba) || str(manifest.merchant.obchodni_nazev),
    customerEmail: to,
    items: [{ name: 'Testovací produkt', quantity: 1, price: 499, currency }],
    subtotal: 499,
    shippingCost: 79,
    dobirkaFee: 0,
    total: 578,
    currency,
    paymentMethod: 'prevod',
    storeName: str(manifest.brand?.name),
    accentColor: accent,
    merchantEmail: to,
    merchantName: str(manifest.merchant.obchodni_nazev),
    bankovniUcet: str(manifest.merchant.bankovni_ucet) || undefined,
  })

  const from = await getProjectFromEmail(project.id)
  const ok = await sendEmail(to, `[TEST] ${subject}`, html, from)

  if (!ok) return NextResponse.json({ error: 'E-mail se nepodařilo odeslat. Zkontrolujte RESEND_API_KEY.' }, { status: 500 })

  // Record the send for the Store Health Score checklist (lib/store-health.ts) — also
  // the persistent cooldown above. See supabase/migration-store-health.sql.
  await supabaseAdmin
    .from('project_secrets')
    .upsert({ project_id: project.id, user_id: userId, email_test_sent_at: new Date().toISOString() }, { onConflict: 'project_id' })

  return NextResponse.json({ ok: true, sentTo: to })
}

async function resolveVerifiedRecipient(userId: string, preferred: unknown): Promise<string | null> {
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const verified = user.emailAddresses.filter((e) => e.verification?.status === 'verified')
    if (verified.length === 0) return null
    if (typeof preferred === 'string') {
      const match = verified.find((e) => e.emailAddress.toLowerCase() === preferred.trim().toLowerCase())
      if (match) return match.emailAddress
    }
    const primary = verified.find((e) => e.id === user.primaryEmailAddressId)
    return (primary ?? verified[0]).emailAddress
  } catch (err) {
    console.error('[email-test] Clerk user lookup failed:', err)
    return null
  }
}
