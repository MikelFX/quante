// GET /api/qads/ad-accounts/[channel]/connect?project_id=... — starts the OAuth flow for
// a Meta or TikTok ad account connection. Redirects the browser straight to the
// channel's consent screen; the signed `state` param round-trips through it and is
// verified on the way back in ../[channel]/callback/route.ts.
//
// This is a real OAuth *authorization* redirect (the merchant granting Qads read/write
// access to their own ad account), not a payment or destructive action — no separate
// "explicit permission" confirmation dialog is needed beyond what Meta/TikTok's own
// consent screen already requires, consistent with how /api/stripe/checkout redirects
// straight to Stripe's hosted page elsewhere in this codebase.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { createOAuthState } from '@/lib/qads/channels/oauth-state'
import type { AdChannelSlug } from '@/lib/qads/channels/types'

const VALID_CHANNELS: AdChannelSlug[] = ['meta', 'tiktok']

interface Params { params: Promise<{ channel: string }> }

export async function GET(request: Request, { params }: Params) {
  const { channel } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!VALID_CHANNELS.includes(channel as AdChannelSlug)) {
    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const slug = channel as AdChannelSlug
  const state = createOAuthState(userId, projectId, slug)

  let authorizeUrl: string
  try {
    const adChannel = createAdChannel(slug)
    authorizeUrl = adChannel.getOAuthUrl(state)
  } catch (err) {
    // Missing META_APP_ID/TIKTOK_APP_ID etc. surfaces here rather than a raw 500 from
    // inside the provider, so the Studio UI (step j) can show a clear "not configured"
    // message instead of a generic error.
    console.error(`[qads/ad-accounts/connect] ${slug} OAuth URL build failed:`, err)
    return NextResponse.json({ error: `${slug} ad connection is not configured on this deployment` }, { status: 503 })
  }

  return NextResponse.redirect(authorizeUrl)
}
