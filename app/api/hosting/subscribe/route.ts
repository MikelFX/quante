import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/auth/project'
import { stripe, HOSTING_PRICE_ID, HOSTING_MONTHLY_PRICE_ID, isStripeConfigured } from '@/lib/stripe'

// Stripe redirect base. Built only from the configured NEXT_PUBLIC_APP_URL — never from
// the request's Origin header, which is client-controlled. Fails closed (null) when the
// variable is missing or not an absolute http(s) URL.
function configuredAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; interval?: unknown }
  try {
    body = (await request.json()) as { projectId?: unknown; interval?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const { projectId, interval } = body
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (typeof projectId !== 'string' || !isUuid(projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const priceId = interval === 'month' ? HOSTING_MONTHLY_PRICE_ID : HOSTING_PRICE_ID
  if (!isStripeConfigured() || !priceId) {
    return NextResponse.json({ error: 'Hosting billing not configured.' }, { status: 503 })
  }

  const origin = configuredAppOrigin()
  if (!origin) {
    console.error('[hosting/subscribe] NEXT_PUBLIC_APP_URL is missing or invalid')
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

  // Check for existing active subscription. `.limit(1)` + an error check: with
  // `.maybeSingle()` alone, 2+ rows (or a failed query) read as "none" and let the
  // user open yet another paid subscription for the same store.
  const { data: existingRows, error: existingErr } = await supabase
    .from('hosting_subscriptions')
    .select('status, stripe_subscription_id')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing'])
    .limit(1)
  if (existingErr) {
    console.error('[hosting/subscribe] subscription lookup failed:', existingErr)
    return NextResponse.json({ error: 'Could not check your hosting plan. Please try again.' }, { status: 503 })
  }

  if (existingRows && existingRows.length > 0) {
    return NextResponse.json({ error: 'Already subscribed.' }, { status: 409 })
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  try {
    session = await stripe.checkout.sessions.create({
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
  } catch (err) {
    console.error('[hosting/subscribe] Stripe session create failed:', err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
