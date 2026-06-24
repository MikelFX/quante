import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain, projectId, price, includeProtection } = (await request.json()) as {
    domain?: string
    projectId?: string
    price?: number
    includeProtection?: boolean
  }

  if (!domain || !price) {
    return Response.json({ error: 'domain and price required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Check user doesn't already own this domain
  const { data: existing } = await supabase
    .from('user_domains')
    .select('id')
    .eq('domain', domain)
    .maybeSingle()

  if (existing) return Response.json({ error: 'Domain already registered' }, { status: 409 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quantecode.com'
  const successBase = projectId
    ? `${appUrl}/project/${projectId}`
    : `${appUrl}/dashboard`

  const session = await stripe.checkout.sessions.create({
    // Always use payment mode. When includeProtection is true, the webhook
    // creates a separate protection subscription after payment succeeds.
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Domain: ${domain}`,
            description: '1-year registration',
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'domain_purchase',
      userId,
      domain,
      projectId: projectId ?? '',
      includeProtection: includeProtection ? 'true' : 'false',
    },
    success_url: `${successBase}?domain_purchased=${encodeURIComponent(domain)}`,
    cancel_url: successBase,
  })

  return Response.json({ url: session.url })
}
