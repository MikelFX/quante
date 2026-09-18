// GET /api/qads/ad-accounts?project_id=... — list connected ad accounts for a project
// (Meta/TikTok), status only — access_token_enc is never returned to the client.
// DELETE is handled per-row at /api/qads/ad-accounts/[id] (see that route).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { data: accounts, error } = await supabaseAdmin
    .from('qads_ad_accounts')
    .select('id, channel, external_account_id, business_id, page_id, pixel_id, catalog_id, scopes, status, last_error, created_at, updated_at')
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ error: 'Failed to list ad accounts' }, { status: 500 })
  return NextResponse.json({ adAccounts: accounts ?? [] })
}
