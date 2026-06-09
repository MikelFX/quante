import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) return NextResponse.redirect(`${origin}/dashboard`)

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('stripe_connect_account_id')
    .eq('project_id', projectId)
    .maybeSingle()

  if (secrets?.stripe_connect_account_id) {
    try {
      const account = await stripe.accounts.retrieve(secrets.stripe_connect_account_id as string)
      await supabaseAdmin.from('project_secrets').update({
        stripe_connect_onboarded: account.details_submitted,
        stripe_connect_charges_enabled: account.charges_enabled,
        updated_at: new Date().toISOString(),
      }).eq('project_id', projectId)
    } catch (err) {
      console.error('[connect/return] account retrieve failed:', err)
    }
  }

  return NextResponse.redirect(`${origin}/project/${projectId}?tab=hosting`)
}
