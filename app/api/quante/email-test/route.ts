// POST /api/quante/email-test
// Sends a sample order confirmation email to the merchant's contact address.
// Used in the Studio to verify Resend integration before going live.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { orderConfirmationEmail, sendEmail, getProjectFromEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest?.merchant) {
    return NextResponse.json({ error: 'Merchant data not configured' }, { status: 422 })
  }

  const to = manifest.merchant.kontakt.email
  const { subject, html } = orderConfirmationEmail({
    orderNumber: `${new Date().getFullYear()}-TEST`,
    customerName: manifest.merchant.zodpovedna_osoba || manifest.merchant.obchodni_nazev,
    customerEmail: to,
    items: [{ name: 'Testovací produkt', quantity: 1, price: 499, currency: manifest.catalog.currency }],
    subtotal: 499,
    shippingCost: 79,
    dobirkaFee: 0,
    total: 578,
    currency: manifest.catalog.currency,
    paymentMethod: 'prevod',
    storeName: manifest.brand.name,
    accentColor: manifest.design.palette.accent,
    merchantEmail: to,
    merchantName: manifest.merchant.obchodni_nazev,
    bankovniUcet: manifest.merchant.bankovni_ucet,
  })

  const from = await getProjectFromEmail(projectId)
  const ok = await sendEmail(to, `[TEST] ${subject}`, html, from)

  if (!ok) return NextResponse.json({ error: 'E-mail se nepodařilo odeslat. Zkontrolujte RESEND_API_KEY.' }, { status: 500 })
  return NextResponse.json({ ok: true, sentTo: to })
}
