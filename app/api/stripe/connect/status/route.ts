import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = await createClient()

  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('stripe_connect_account_id, stripe_connect_onboarded, stripe_connect_charges_enabled')
    .eq('project_id', projectId)
    .maybeSingle()

  return NextResponse.json({
    accountId: secrets?.stripe_connect_account_id ?? null,
    onboarded: secrets?.stripe_connect_onboarded ?? false,
    chargesEnabled: secrets?.stripe_connect_charges_enabled ?? false,
  })
}
