// PATCH /api/project/secrets — update per-project secrets/settings.
// Payment gateway secrets (Comgate/GoPay/PayPal) are AES-256-GCM encrypted
// at rest via lib/crypto.ts. All other fields are ignored to prevent
// privilege escalation. GET never returns secret values — only has-flags.
//
// merchant_json/payments_json/shipping_json (added 2026-08-21, see
// supabase/migration-business-info.sql) hold the Publish panel's business
// details / payment methods / shipping methods for code-gen mode stores.
// Not secret data (no API keys), so stored as plain jsonb, not encrypted —
// they live here rather than on the legacy manifest_versions table because
// code-gen stores never have a ShopManifest row to attach them to.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'

const PLAIN_FIELDS = [
  'resend_from_email',
  'payment_test_mode',
  'zasilkovna_api_key',
  'zasilkovna_api_password',
  'comgate_merchant_id',
  'gopay_client_id',
  'gopay_go_id',
  'paypal_client_id',
  'merchant_json',
  'payments_json',
  'shipping_json',
] as const

const ENCRYPTED_FIELDS = [
  'comgate_secret',
  'gopay_client_secret',
  'paypal_client_secret',
] as const

export async function PATCH(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const { projectId } = body

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  for (const field of PLAIN_FIELDS) {
    if (field in body) updates[field] = body[field]
  }
  for (const field of ENCRYPTED_FIELDS) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === null || value === '') {
      updates[field] = null
      continue
    }
    if (typeof value !== 'string') continue
    if (!isEncryptionConfigured()) {
      return NextResponse.json({ error: 'Server misconfiguration: SECRETS_ENCRYPTION_KEY is not set.' }, { status: 500 })
    }
    updates[field] = encryptSecret(value)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('project_secrets')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data } = await supabaseAdmin
    .from('project_secrets')
    .select('resend_from_email, payment_test_mode, zasilkovna_api_key, comgate_merchant_id, comgate_secret, gopay_client_id, gopay_client_secret, gopay_go_id, paypal_client_id, paypal_client_secret, merchant_json, payments_json, shipping_json')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    resendFromEmail: (data?.resend_from_email as string | null) ?? null,
    paymentTestMode: (data?.payment_test_mode as boolean | null) ?? true,
    hasZasilkovnaKey: !!data?.zasilkovna_api_key,
    comgateMerchantId: (data?.comgate_merchant_id as string | null) ?? null,
    hasComgateSecret: !!data?.comgate_secret,
    gopayClientId: (data?.gopay_client_id as string | null) ?? null,
    gopayGoId: (data?.gopay_go_id as string | null) ?? null,
    hasGopaySecret: !!data?.gopay_client_secret,
    paypalClientId: (data?.paypal_client_id as string | null) ?? null,
    hasPaypalSecret: !!data?.paypal_client_secret,
    merchant: (data?.merchant_json as Record<string, unknown> | null) ?? null,
    payments: (data?.payments_json as Record<string, unknown> | null) ?? null,
    shipping: (data?.shipping_json as Record<string, unknown> | null) ?? null,
  })
}
