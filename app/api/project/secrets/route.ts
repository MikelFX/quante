// PATCH /api/project/secrets — update per-project secrets/settings.
// Allowed fields: resend_from_email, payment_test_mode, zasilkovna_api_key, zasilkovna_api_password.
// All other fields are ignored to prevent privilege escalation.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const ALLOWED_FIELDS = [
  'resend_from_email',
  'payment_test_mode',
  'zasilkovna_api_key',
  'zasilkovna_api_password',
  'comgate_merchant_id',
  'comgate_secret',
  'gopay_client_id',
  'gopay_client_secret',
  'gopay_go_id',
] as const

type AllowedField = typeof ALLOWED_FIELDS[number]

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

  const updates: Partial<Record<AllowedField, unknown>> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field]
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
    .select('resend_from_email, payment_test_mode, zasilkovna_api_key, comgate_merchant_id, comgate_secret, gopay_client_id, gopay_client_secret, gopay_go_id')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    resendFromEmail: (data?.resend_from_email as string | null) ?? null,
    paymentTestMode: (data?.payment_test_mode as boolean | null) ?? true,
    hasZasilkovnaKey: !!(data?.zasilkovna_api_key as string | null),
    hasComgate: !!(data?.comgate_merchant_id as string | null) && !!(data?.comgate_secret as string | null),
    hasGopay: !!(data?.gopay_client_id as string | null) && !!(data?.gopay_go_id as string | null),
  })
}
