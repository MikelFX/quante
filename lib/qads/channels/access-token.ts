// Shared "load + decrypt a connected ad account's access token" helper — factored out of
// lib/qads/deploy/execute-deploy.ts so step (g)'s activate/pause/budget routes don't each
// duplicate the same connected-status check + decrypt call.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'

export interface ConnectedAccessToken {
  ok: true
  accessToken: string
  adAccountExternalId: string
}
export interface ConnectedAccessTokenError {
  ok: false
  error: string
}

export async function getConnectedAccessToken(adAccountRowId: string): Promise<ConnectedAccessToken | ConnectedAccessTokenError> {
  const { data: adAccount } = await supabaseAdmin
    .from('qads_ad_accounts')
    .select('access_token_enc, external_account_id, status')
    .eq('id', adAccountRowId)
    .maybeSingle()
  if (!adAccount) return { ok: false, error: 'Ad account not found' }
  if (adAccount.status !== 'connected') return { ok: false, error: `Ad account is '${adAccount.status}' — reconnect it first` }

  const accessToken = decryptSecret(adAccount.access_token_enc)
  if (!accessToken) return { ok: false, error: 'Failed to decrypt stored ad-account access token' }

  return { ok: true, accessToken, adAccountExternalId: adAccount.external_account_id }
}
