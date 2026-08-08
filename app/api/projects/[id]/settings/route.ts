import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { setEnvVars } from '@/lib/hosting/vercel'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'

// Fix (2026-08-07): the shipping/fulfillment secret fields below (dhl_api_key/secret,
// gls_password, byrd_api_key/secret, zasilkovna_api_password) used to be written here in
// plaintext — lib/crypto.ts (AES-256-GCM) already existed and was already used for the
// Comgate/GoPay/PayPal secrets in /api/project/secrets/route.ts, just never wired up here.
// zasilkovna_api_key, dhl_account_number, gls_username/gls_client_number/gls_country are
// left as plaintext identifiers, matching the existing convention (see ENCRYPTED_FIELDS
// vs plain fields in /api/project/secrets/route.ts) — zasilkovna_api_key is additionally
// pushed to the deployed store's public NEXT_PUBLIC_ZASILKOVNA_API_KEY env var below, so
// encrypting it at rest would be no-op security theater.
// decryptSecret() passes plaintext values through unchanged (see lib/crypto.ts), so this
// is backward compatible with rows saved before this fix without any migration/backfill.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('zasilkovna_api_key, zasilkovna_api_password, dhl_api_key, dhl_api_secret, dhl_account_number, gls_username, gls_password, gls_client_number, gls_country, byrd_api_key, byrd_api_secret')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    hasZasilkovnaKey: !!(secrets?.zasilkovna_api_key as string | null),
    hasZasilkovnaPassword: !!(secrets?.zasilkovna_api_password as string | null),
    hasDhlApiKey: !!(secrets?.dhl_api_key as string | null),
    hasDhlApiSecret: !!(secrets?.dhl_api_secret as string | null),
    hasDhlAccount: !!(secrets?.dhl_account_number as string | null),
    hasGlsUsername: !!(secrets?.gls_username as string | null),
    hasGlsPassword: !!(secrets?.gls_password as string | null),
    hasGlsClientNumber: !!(secrets?.gls_client_number as string | null),
    glsCountry: (secrets?.gls_country as string | null) ?? 'cz',
    hasByrdApiKey: !!(secrets?.byrd_api_key as string | null),
    hasByrdApiSecret: !!(secrets?.byrd_api_secret as string | null),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  // Stripe/Comgate/GoPay keys are intentionally NOT accepted here.
  // Hosted stores always process payments through Quante's platform credentials.
  // Users configure their own keys only in self-hosted exports (via .env.local).
  const { zasilkovnaApiKey, zasilkovnaApiPassword, dhlApiKey, dhlApiSecret, dhlAccountNumber, glsUsername, glsPassword, glsClientNumber, glsCountry, byrdApiKey, byrdApiSecret } = await request.json()

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Any of the encrypted fields present in this request? Fail fast with a clear error
  // instead of silently storing plaintext if the server key isn't configured.
  const hasSecretToEncrypt = [zasilkovnaApiPassword, dhlApiKey, dhlApiSecret, glsPassword, byrdApiKey, byrdApiSecret]
    .some((v) => typeof v === 'string' && v.length > 0)
  if (hasSecretToEncrypt && !isEncryptionConfigured()) {
    return NextResponse.json({ error: 'Server misconfiguration: SECRETS_ENCRYPTION_KEY is not set.' }, { status: 500 })
  }
  const encOrNull = (v: unknown): string | null =>
    (typeof v === 'string' && v.length > 0) ? encryptSecret(v) : null

  // Build upsert payload — only shipping API keys
  const upsertPayload: Record<string, unknown> = {
    project_id: projectId,
    user_id: userId,
    updated_at: new Date().toISOString(),
  }
  if (zasilkovnaApiKey !== undefined) upsertPayload.zasilkovna_api_key = zasilkovnaApiKey || null
  if (zasilkovnaApiPassword !== undefined) upsertPayload.zasilkovna_api_password = encOrNull(zasilkovnaApiPassword)
  if (dhlApiKey !== undefined) upsertPayload.dhl_api_key = encOrNull(dhlApiKey)
  if (dhlApiSecret !== undefined) upsertPayload.dhl_api_secret = encOrNull(dhlApiSecret)
  if (dhlAccountNumber !== undefined) upsertPayload.dhl_account_number = dhlAccountNumber || null
  if (glsUsername !== undefined) upsertPayload.gls_username = glsUsername || null
  if (glsPassword !== undefined) upsertPayload.gls_password = encOrNull(glsPassword)
  if (glsClientNumber !== undefined) upsertPayload.gls_client_number = glsClientNumber || null
  if (glsCountry !== undefined) upsertPayload.gls_country = (typeof glsCountry === 'string' && glsCountry.trim()) ? glsCountry.trim().toLowerCase() : 'cz'
  if (byrdApiKey !== undefined) upsertPayload.byrd_api_key = encOrNull(byrdApiKey)
  if (byrdApiSecret !== undefined) upsertPayload.byrd_api_secret = encOrNull(byrdApiSecret)

  await supabaseAdmin.from('project_secrets').upsert(upsertPayload, { onConflict: 'project_id' })

  // Push Zásilkovna widget key to the deployed Vercel project env vars
  if (project.vercel_project_id) {
    const envUpdate: Record<string, string> = {}
    if (zasilkovnaApiKey) envUpdate['NEXT_PUBLIC_ZASILKOVNA_API_KEY'] = zasilkovnaApiKey

    if (Object.keys(envUpdate).length > 0) {
      try {
        await setEnvVars(project.vercel_project_id as string, envUpdate, { encrypted: [] })
      } catch (err) {
        console.warn('[settings] setEnvVars non-fatal:', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
