// GET /api/qads/campaigns/[id] — full campaign detail: status, strategy, angles, ad
// sets, and ads. Polled by components/qads/PipelineProgress.tsx / CampaignTree.tsx
// (Qads step j) — same "durable rows the client polls" model as generation_jobs, not a
// live stream (see docs/qads-proposal.md's architecture-deviation note).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: angles } = await supabaseAdmin
    .from('qads_angles')
    .select('id, label, hypothesis, sort_order')
    .eq('campaign_id', campaignId)
    .order('sort_order', { ascending: true })

  const { data: adSets } = await supabaseAdmin
    .from('qads_ad_sets')
    .select('id, angle_id, channel, name, audience, placements, budget_minor, budget_type, status, external_id, external_status')
    .eq('campaign_id', campaignId)

  const adSetIds = (adSets ?? []).map((s) => s.id as string)
  const { data: ads } = adSetIds.length
    ? await supabaseAdmin
        .from('qads_ads')
        .select('id, ad_set_id, format, texts, creative_id, approval_status, external_id, external_status')
        .in('ad_set_id', adSetIds)
    : { data: [] }

  return NextResponse.json({ campaign, angles: angles ?? [], adSets: adSets ?? [], ads: ads ?? [] })
}
