// PATCH /api/project/secrets — update (or create) per-project secrets/settings.
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
import { isUuid } from '@/lib/auth/project'

// zasilkovna_api_password is deliberately NOT here: it is a carrier credential and is
// encrypted like the payment secrets (it used to be stored in plaintext via this route).
const PLAIN_FIELDS = [
  'resend_from_email',
  'payment_test_mode',
  'zasilkovna_api_key',
  'comgate_merchant_id',
  'gopay_client_id',
  'gopay_go_id',
  'paypal_client_id',
  'merchant_json',
  'payments_json',
  'shipping_json',
  'market_country',
  'market_language',
] as const

const JSON_FIELDS = new Set<string>(['merchant_json', 'payments_json', 'shipping_json'])
const MAX_STRING_LEN = 500
const MAX_JSON_BYTES = 64 * 1024

// Type/size check for plain fields — the service-role client would otherwise write
// whatever shape the caller sends into these columns.
function isValidPlainValue(field: string, value: unknown): boolean {
  if (value === null) return true
  if (field === 'payment_test_mode') return typeof value === 'boolean'
  if (JSON_FIELDS.has(field)) {
    if (typeof value !== 'object' || Array.isArray(value)) return false
    try {
      return JSON.stringify(value).length <= MAX_JSON_BYTES
    } catch {
      return false
    }
  }
  return typeof value === 'string' && value.length <= MAX_STRING_LEN
}

const ENCRYPTED_FIELDS = [
  'zasilkovna_api_password',
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
  if (!isUuid(projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  for (const field of PLAIN_FIELDS) {
    if (!(field in body)) continue
    if (!isValidPlainValue(field, body[field])) {
      return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 })
    }
    updates[field] = body[field]
  }
  for (const field of ENCRYPTED_FIELDS) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === null || value === '') {
      updates[field] = null
      continue
    }
    if (typeof value !== 'string' || value.length > MAX_STRING_LEN) continue
    if (!isEncryptionConfigured()) {
      return NextResponse.json({ error: 'Server misconfiguration: SECRETS_ENCRYPTION_KEY is not set.' }, { status: 500 })
    }
    updates[field] = encryptSecret(value)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Upsert, not update: a project that has never been deployed has no project_secrets
  // row yet, and a plain UPDATE would match 0 rows and silently drop the save.
  // Ownership was verified above, so the row is (re)stamped with the owner's id.
  const { error } = await supabaseAdmin
    .from('project_secrets')
    .upsert(
      { project_id: projectId, user_id: userId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'project_id' },
    )

  if (error) {
    console.error('[project/secrets] update failed:', error.message)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!isUuid(projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data } = await supabaseAdmin
    .from('project_secrets')
    .select('resend_from_email, payment_test_mode, zasilkovna_api_key, comgate_merchant_id, comgate_secret, gopay_client_id, gopay_client_secret, gopay_go_id, paypal_client_id, paypal_client_secret, merchant_json, payments_json, shipping_json, market_country, market_language')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    resendFromEmail: (data?.resend_from_email as string | null) ?? null,
    // Only an explicit `true` is test mode — matches lib/payments/project-providers.ts,
    // which treats null as LIVE (so the UI never shows "test" while real money moves).
    paymentTestMode: data?.payment_test_mode === true,
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
    marketCountry: (data?.market_country as string | null) ?? null,
    marketLanguage: (data?.market_language as string | null) ?? null,
  })
}
