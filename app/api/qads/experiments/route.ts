// POST /api/qads/experiments — create an A/B test. Variants reference existing
// qads_creatives/qads_ads/qads_ad_sets rows by (refType, refId) rather than duplicating
// content (docs/qads-proposal.md §8) — this route only validates the refs exist and
// belong to the campaign, it never generates new creative/ad-set rows itself.
// GET /api/qads/experiments?campaign_id=... — list experiments for a campaign.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ExperimentType, ExperimentSuccessMetric } from '@/lib/qads/types'

const VALID_TYPES: ExperimentType[] = ['creative', 'copy', 'audience']
const VALID_METRICS: ExperimentSuccessMetric[] = ['ctr', 'cpa', 'roas', 'conversions']
const VALID_REF_TYPES = ['creative', 'ad', 'ad_set'] as const

interface VariantInput { refType: (typeof VALID_REF_TYPES)[number]; refId: string; trafficShare: number }
interface CreateExperimentBody {
  campaignId: string
  type: ExperimentType
  variants: VariantInput[]
  budgetSplit?: Record<string, number>
  successMetric: ExperimentSuccessMetric
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CreateExperimentBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
  if (!VALID_TYPES.includes(body.type)) return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
  if (!VALID_METRICS.includes(body.successMetric)) return NextResponse.json({ error: `successMetric must be one of: ${VALID_METRICS.join(', ')}` }, { status: 400 })
  if (!Array.isArray(body.variants) || body.variants.length < 2) {
    return NextResponse.json({ error: 'At least 2 variants are required to run a test' }, { status: 400 })
  }
  for (const v of body.variants) {
    if (!VALID_REF_TYPES.includes(v.refType) || !v.refId) {
      return NextResponse.json({ error: `Each variant needs a refType (${VALID_REF_TYPES.join('/')}) and refId` }, { status: 400 })
    }
  }

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id')
    .eq('id', body.campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Confirm every ref actually exists and belongs to this campaign — refuses to create
  // an experiment pointing at nothing (or worse, another user's row) rather than
  // silently accepting an unresolvable ref.
  for (const v of body.variants) {
    const exists = await refExistsInCampaign(v.refType, v.refId, body.campaignId)
    if (!exists) return NextResponse.json({ error: `${v.refType} ${v.refId} was not found in this campaign` }, { status: 422 })
  }

  const variants = body.variants.map((v) => ({ id: randomUUID(), refType: v.refType, refId: v.refId, trafficShare: v.trafficShare }))

  const { data: experiment, error } = await supabaseAdmin
    .from('qads_experiments')
    .insert({
      campaign_id: body.campaignId,
      type: body.type,
      variants,
      budget_split: body.budgetSplit ?? {},
      success_metric: body.successMetric,
      status: 'running',
    })
    .select('id')
    .single()

  if (error || !experiment) {
    console.error('[qads/experiments] insert failed:', error?.message)
    return NextResponse.json({ error: 'Failed to create experiment' }, { status: 500 })
  }

  return NextResponse.json({ experimentId: experiment.id })
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id')
  if (!campaignId) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: experiments, error } = await supabaseAdmin
    .from('qads_experiments')
    .select('id, type, variants, success_metric, status, min_sample_note, result, created_at, updated_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to list experiments' }, { status: 500 })
  return NextResponse.json({ experiments: experiments ?? [] })
}

async function refExistsInCampaign(refType: string, refId: string, campaignId: string): Promise<boolean> {
  if (refType === 'ad_set') {
    const { data } = await supabaseAdmin.from('qads_ad_sets').select('id').eq('id', refId).eq('campaign_id', campaignId).maybeSingle()
    return !!data
  }
  if (refType === 'ad') {
    const { data } = await supabaseAdmin
      .from('qads_ads')
      .select('id, qads_ad_sets!inner(campaign_id)')
      .eq('id', refId)
      .eq('qads_ad_sets.campaign_id', campaignId)
      .maybeSingle()
    return !!data
  }
  // 'creative'
  const { data } = await supabaseAdmin.from('qads_creatives').select('id').eq('id', refId).eq('campaign_id', campaignId).maybeSingle()
  return !!data
}
