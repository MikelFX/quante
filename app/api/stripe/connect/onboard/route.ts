import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get or create connected account
  const { data: secrets } = await supabase
    .from('project_secrets')
    .select('stripe_connect_account_id')
    .eq('project_id', projectId)
    .maybeSingle()

  let accountId = secrets?.stripe_connect_account_id as string | null

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { project_id: projectId, quante_user_id: userId },
    })
    accountId = account.id

    await supabaseAdmin.from('project_secrets').upsert({
      project_id: projectId,
      user_id: userId,
      stripe_connect_account_id: accountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/api/stripe/connect/refresh?project_id=${projectId}`,
    return_url: `${appUrl}/api/stripe/connect/return?project_id=${projectId}`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url })
}
