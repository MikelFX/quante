// GET /api/qads/experiments/[id] — live-computed results + confidence
// (lib/qads/experiments/significance.ts). Read-only against budgets/channels — the only
// side effect is flipping status 'running' -> 'evaluating' once every variant clears the
// minimum-sample floor (informational bookkeeping, not a money-moving action, so no
// confirmation gate). Concluding + applying a winner requires the separate, explicit
// apply-winner call.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { computeExperimentSignificance } from '@/lib/qads/experiments/significance'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const { id: experimentId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: experiment } = await supabaseAdmin
    .from('qads_experiments')
    .select('id, campaign_id, status, qads_campaigns!inner(user_id)')
    .eq('id', experimentId)
    .eq('qads_campaigns.user_id', userId)
    .maybeSingle()
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })

  const significance = await computeExperimentSignificance(experimentId)
  if ('error' in significance) return NextResponse.json({ error: significance.error }, { status: 422 })

  if (experiment.status === 'running' && significance.readyToEvaluate) {
    await supabaseAdmin
      .from('qads_experiments')
      .update({ status: 'evaluating', min_sample_note: significance.minSampleNote ?? null })
      .eq('id', experimentId)
  } else if (significance.minSampleNote) {
    await supabaseAdmin.from('qads_experiments').update({ min_sample_note: significance.minSampleNote }).eq('id', experimentId)
  }

  return NextResponse.json({
    experimentId,
    status: experiment.status,
    variantStats: significance.variantStats,
    metricSupportsZTest: significance.metricSupportsZTest,
    readyToEvaluate: significance.readyToEvaluate,
    minSampleNote: significance.minSampleNote,
    recommendation: significance.comparison ?? null,
  })
}
