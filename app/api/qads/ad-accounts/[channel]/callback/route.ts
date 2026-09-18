// GET /api/qads/ad-accounts/[channel]/callback — Meta/TikTok redirect back here with
// ?code=...&state=.... Verifies the signed state (see ../../oauth-state.ts), exchanges
// the code for a token, and upserts qads_ad_accounts. page_id/pixel_id/catalog_id are
// NOT resolved here — Meta/TikTok's OAuth grant doesn't hand those back directly, they
// need a follow-up "which Page/Pixel do you want to use" step, which is a step (j) UI
// concern (a settings form on the connected ad-account row) — left null here rather than
// guessed, and createMetaAdCreative already fails loudly if pageId is missing (see
// lib/qads/channels/providers/meta/mapper.ts) so this gap can't silently produce a wrong
// ad later.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { verifyOAuthState } from '@/lib/qads/channels/oauth-state'
import { encryptSecret } from '@/lib/crypto'
import type { AdChannelSlug } from '@/lib/qads/channels/types'

const VALID_CHANNELS: AdChannelSlug[] = ['meta', 'tiktok']

interface Params { params: Promise<{ channel: string }> }

function studioRedirect(projectId: string, query: Record<string, string>): NextResponse {
  // The ad-accounts connection UI lives on the Studio's dedicated Ads tab (step j:
  // app/(app)/project/[id]/ads/), not the Studio's main Builder/Admin surface — redirect
  // there so the merchant lands back exactly where they clicked "Connect".
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const url = new URL(`${appUrl}/project/${projectId}/ads`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return NextResponse.redirect(url.toString())
}

export async function GET(request: Request, { params }: Params) {
  const { channel } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!VALID_CHANNELS.includes(channel as AdChannelSlug)) {
    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 })
  }
  const slug = channel as AdChannelSlug

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error') || searchParams.get('error_message')

  const stateResult = state ? verifyOAuthState(state) : { ok: false as const, error: 'Missing state' }
  if (!stateResult.ok) {
    console.error(`[qads/ad-accounts/callback] ${slug} state verification failed:`, stateResult.error)
    return NextResponse.json({ error: 'Invalid or expired OAuth state — please retry connecting the ad account' }, { status: 400 })
  }
  const { userId: stateUserId, projectId, channel: stateChannel } = stateResult.payload

  // The signed state is the source of truth for which project this connection belongs
  // to (it can't be forged without SECRETS_ENCRYPTION_KEY) — but the session's userId
  // must also match who initiated it, so one signed-in user can't complete another's
  // pending OAuth flow if a callback URL leaked.
  if (stateUserId !== userId || stateChannel !== slug) {
    return NextResponse.json({ error: 'OAuth state does not match the current user/channel' }, { status: 403 })
  }

  if (oauthError || !code) {
    console.error(`[qads/ad-accounts/callback] ${slug} OAuth denied or missing code:`, oauthError)
    return studioRedirect(projectId, { qads_error: `${slug}_denied` })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const adChannel = createAdChannel(slug)
    const result = await adChannel.exchangeOAuthCode(code)

    const { error: upsertError } = await supabaseAdmin
      .from('qads_ad_accounts')
      .upsert(
        {
          user_id: userId,
          project_id: projectId,
          channel: slug,
          external_account_id: result.externalAccountId,
          business_id: result.businessId ?? null,
          access_token_enc: encryptSecret(result.accessToken),
          refresh_token_enc: result.refreshToken ? encryptSecret(result.refreshToken) : null,
          token_expires_at: result.expiresAt ?? null,
          scopes: result.scopes,
          status: 'connected',
          last_error: null,
        },
        { onConflict: 'project_id,channel' },
      )

    if (upsertError) {
      console.error(`[qads/ad-accounts/callback] ${slug} upsert failed:`, upsertError.message)
      return studioRedirect(projectId, { qads_error: `${slug}_save_failed` })
    }

    return studioRedirect(projectId, { qads_connected: slug })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qads/ad-accounts/callback] ${slug} token exchange failed:`, message)
    // Best-effort: record the failure against any existing row for this project+channel
    // so the Studio can surface "last connection attempt failed: ..." rather than
    // silence. Not fatal if this secondary write fails too.
    await supabaseAdmin
      .from('qads_ad_accounts')
      .update({ status: 'error', last_error: message })
      .eq('project_id', projectId)
      .eq('channel', slug)
    return studioRedirect(projectId, { qads_error: `${slug}_exchange_failed` })
  }
}
