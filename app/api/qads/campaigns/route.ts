// POST /api/qads/campaigns — brief -> brand context -> generated strategy/angles/ad-sets/
// copy, in one request. Phase 1 only implements the text/structure side of the pipeline
// (see lib/qads/pipeline/graph.ts); image/video generation credits are reserved and
// spent separately once those steps (Qads c/d) exist, so this route only ever reserves
// QADS_CREDIT_COSTS.strategy_generation.
//
// GET /api/qads/campaigns — list campaigns for a project.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { deriveBrandContext } from '@/lib/qads/claude/brand-context'
import { runCampaignGeneration } from '@/lib/qads/pipeline/runner'
import { reserveCredits, QADS_CREDIT_COSTS } from '@/lib/qads/credits'
import type { CampaignGoal, QadsChannel } from '@/lib/qads/types'

const VALID_GOALS: CampaignGoal[] = ['launch', 'sale', 'black_friday', 'awareness', 'custom']
const VALID_CHANNELS: QadsChannel[] = ['meta', 'tiktok']

interface CreateCampaignBody {
  projectId: string
  name: string
  goal: CampaignGoal
  channels: QadsChannel[]
  budgetMinor: number
  currency?: string
  durationDays: number
  productIds?: string[]
  brief: string
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CreateCampaignBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { projectId, name, goal, channels, budgetMinor, currency = 'usd', durationDays, productIds, brief } = body

  if (!projectId || !name?.trim() || !brief?.trim()) {
    return NextResponse.json({ error: 'projectId, name, and brief are required' }, { status: 400 })
  }
  if (!VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: `goal must be one of: ${VALID_GOALS.join(', ')}` }, { status: 400 })
  }
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((c) => !VALID_CHANNELS.includes(c))) {
    return NextResponse.json({ error: `channels must be a non-empty array of: ${VALID_CHANNELS.join(', ')}` }, { status: 400 })
  }
  if (!Number.isFinite(budgetMinor) || budgetMinor <= 0) {
    return NextResponse.json({ error: 'budgetMinor must be a positive number' }, { status: 400 })
  }
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return NextResponse.json({ error: 'durationDays must be a positive number' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const brandContextResult = await deriveBrandContext({ projectId, productIds })
  if (!brandContextResult.ok) {
    return NextResponse.json({ error: brandContextResult.error }, { status: 422 })
  }

  const cost = QADS_CREDIT_COSTS.strategy_generation
  const { data: campaign, error: insertError } = await supabaseAdmin
    .from('qads_campaigns')
    .insert({
      user_id: userId,
      project_id: projectId,
      name: name.trim(),
      goal,
      channels,
      budget_minor: budgetMinor,
      currency,
      duration_days: durationDays,
      product_ids: productIds ?? [],
      brief: brief.trim(),
      brand_context: brandContextResult.context,
      status: 'generating',
      pipeline_state: { brand_context: 'completed', strategy: 'running' },
    })
    .select('id')
    .single()

  if (insertError || !campaign) {
    console.error('[qads/campaigns] insert failed:', insertError?.message)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }

  const reserveResult = await reserveCredits({ userId, amount: cost, campaignId: campaign.id })
  if (!reserveResult.ok) {
    await supabaseAdmin.from('qads_campaigns').update({ status: 'failed' }).eq('id', campaign.id)
    return NextResponse.json(
      { error: 'Insufficient credits', needed: reserveResult.needed, balance: reserveResult.balance },
      { status: 402 },
    )
  }

  await supabaseAdmin.from('qads_campaigns').update({ credits_reserved: cost }).eq('id', campaign.id)

  const runResult = await runCampaignGeneration({
    campaignId: campaign.id,
    userId,
    brandContext: brandContextResult.context,
    goal,
    channels,
    budgetMinor,
    currency,
    durationDays,
    brief: brief.trim(),
    creditsReserved: cost,
  })

  if (!runResult.ok) {
    return NextResponse.json({ error: runResult.error, campaignId: campaign.id }, { status: 500 })
  }

  return NextResponse.json({ campaignId: campaign.id, status: 'ready_for_review', creditsUsed: cost, balanceAfter: reserveResult.balance })
}

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

  const { data: campaigns, error } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, name, goal, channels, budget_minor, currency, status, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to list campaigns' }, { status: 500 })
  return NextResponse.json({ campaigns: campaigns ?? [] })
}
