import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, HOSTING_PRICE_ID, HOSTING_MONTHLY_PRICE_ID, isStripeConfigured } from '@/lib/stripe'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, interval } = await request.json() as { projectId?: string; interval?: 'month' | 'year' }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const priceId = interval === 'month' ? HOSTING_MONTHLY_PRICE_ID : HOSTING_PRICE_ID
  if (!isStripeConfigured() || !priceId) {
    return NextResponse.json({ error: 'Hosting billing not configured.' }, { status: 503 })
  }

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Check for existing active subscription
  const { data: existing } = await supabase
    .from('hosting_subscriptions')
    .select('status, stripe_subscription_id')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Already subscribed.' }, { status: 409 })
  }

  const origin = request.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId, projectId, type: 'hosting' },
    success_url: `${origin}/project/${projectId}?hosting=subscribed`,
    cancel_url: `${origin}/project/${projectId}`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId, projectId },
    },
  })

  return NextResponse.json({ url: session.url })
}
