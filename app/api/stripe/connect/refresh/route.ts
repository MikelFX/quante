import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

// Stripe calls this URL if the onboarding link expires — regenerate and redirect
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) return NextResponse.redirect(`${origin}/dashboard`)

  const { data: secrets } = await supabaseAdmin
    .from('project_secrets')
    .select('stripe_connect_account_id')
    .eq('project_id', projectId)
    .maybeSingle()

  const accountId = secrets?.stripe_connect_account_id as string | undefined
  if (!accountId) return NextResponse.redirect(`${origin}/project/${projectId}?tab=hosting`)

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/stripe/connect/refresh?project_id=${projectId}`,
      return_url: `${appUrl}/api/stripe/connect/return?project_id=${projectId}`,
      type: 'account_onboarding',
    })
    return NextResponse.redirect(link.url)
  } catch {
    return NextResponse.redirect(`${origin}/project/${projectId}?tab=hosting`)
  }
}
