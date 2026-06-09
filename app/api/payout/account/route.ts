import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data } = await supabaseAdmin
    .from('store_payout_accounts')
    .select('iban, account_holder_name, bank_name')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json(data ?? { iban: null, account_holder_name: null, bank_name: null })
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, iban, accountHolderName, bankName } = await request.json()
  if (!projectId || !iban || !accountHolderName) {
    return NextResponse.json({ error: 'projectId, iban, and accountHolderName required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  await supabaseAdmin.from('store_payout_accounts').upsert({
    project_id: projectId,
    user_id: userId,
    iban: iban.trim().replace(/\s+/g, ''),
    account_holder_name: accountHolderName.trim(),
    bank_name: bankName?.trim() ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' })

  return NextResponse.json({ ok: true })
}
