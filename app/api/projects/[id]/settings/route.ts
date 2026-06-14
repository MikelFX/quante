import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { setEnvVars } from '@/lib/hosting/vercel'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('zasilkovna_api_key, zasilkovna_api_password, dhl_api_key, dhl_api_secret, dhl_account_number')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    hasZasilkovnaKey: !!(secrets?.zasilkovna_api_key as string | null),
    hasZasilkovnaPassword: !!(secrets?.zasilkovna_api_password as string | null),
    hasDhlApiKey: !!(secrets?.dhl_api_key as string | null),
    hasDhlApiSecret: !!(secrets?.dhl_api_secret as string | null),
    hasDhlAccount: !!(secrets?.dhl_account_number as string | null),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const { stripePublishableKey, stripeSecretKey, zasilkovnaApiKey, zasilkovnaApiPassword, dhlApiKey, dhlApiSecret, dhlAccountNumber } = await request.json()

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Build upsert payload — only include fields that were sent
  const upsertPayload: Record<string, unknown> = {
    project_id: projectId,
    user_id: userId,
    updated_at: new Date().toISOString(),
  }
  if (stripePublishableKey !== undefined) upsertPayload.stripe_publishable_key = stripePublishableKey || null
  if (stripeSecretKey !== undefined) upsertPayload.stripe_secret_key = stripeSecretKey || null
  if (zasilkovnaApiKey !== undefined) upsertPayload.zasilkovna_api_key = zasilkovnaApiKey || null
  if (zasilkovnaApiPassword !== undefined) upsertPayload.zasilkovna_api_password = zasilkovnaApiPassword || null
  if (dhlApiKey !== undefined) upsertPayload.dhl_api_key = dhlApiKey || null
  if (dhlApiSecret !== undefined) upsertPayload.dhl_api_secret = dhlApiSecret || null
  if (dhlAccountNumber !== undefined) upsertPayload.dhl_account_number = dhlAccountNumber || null

  await supabaseAdmin.from('project_secrets').upsert(upsertPayload, { onConflict: 'project_id' })

  // If store is deployed, push Stripe keys to Vercel env vars
  if (project.vercel_project_id) {
    const envUpdate: Record<string, string> = {}
    if (stripePublishableKey) envUpdate['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] = stripePublishableKey
    if (stripeSecretKey) envUpdate['STRIPE_SECRET_KEY'] = stripeSecretKey
    if (zasilkovnaApiKey) envUpdate['NEXT_PUBLIC_ZASILKOVNA_API_KEY'] = zasilkovnaApiKey

    if (Object.keys(envUpdate).length > 0) {
      try {
        await setEnvVars(project.vercel_project_id as string, envUpdate, {
          encrypted: stripeSecretKey ? ['STRIPE_SECRET_KEY'] : [],
        })
      } catch (err) {
        console.warn('[settings] setEnvVars non-fatal:', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
