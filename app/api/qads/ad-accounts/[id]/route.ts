// DELETE /api/qads/ad-accounts/[id] — disconnect a connected ad account. This only
// removes Qads's stored token/row; it does NOT revoke the grant on Meta/TikTok's side
// (no documented single-call "revoke" endpoint verified for either during this
// implementation step — flagged as an open item) nor touch any already-created
// campaign/ad-set/ad objects on the channel (those stay exactly as they are, paused or
// otherwise, since QADS_LIVE_DEPLOY has never been on). The merchant can separately
// revoke Qads's app access from their own Meta Business Settings / TikTok Business
// Center if they want to fully cut the connection.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: account } = await supabaseAdmin
    .from('qads_ad_accounts')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!account) return NextResponse.json({ error: 'Ad account not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('qads_ad_accounts').delete().eq('id', id)
  if (error) {
    console.error('[qads/ad-accounts/delete] failed:', error.message)
    return NextResponse.json({ error: 'Failed to disconnect ad account' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
