// Resolves each experiment variant (a ref into existing qads_ads/qads_ad_sets/
// qads_creatives rows — never duplicated content, per docs/qads-proposal.md §8) to its
// accumulated qads_metrics, and runs the significance check from stats.ts. Read-only —
// never mutates budgets or channel state. Concluding + applying a winner is a separate,
// explicit action (app/api/qads/experiments/[id]/apply-winner/route.ts).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { twoProportionZTest, minSampleNote, MIN_SUCCESSES_PER_VARIANT } from './stats'
import type { ExperimentSuccessMetric } from '../types'

export interface ExperimentVariant {
  id: string
  refType: 'creative' | 'ad' | 'ad_set'
  refId: string
  trafficShare: number
}

export interface VariantStat {
  variantId: string
  refType: ExperimentVariant['refType']
  refId: string
  impressions: number
  clicks: number
  conversions: number
  spendMinor: number
  conversionValueMinor: number
  trials: number // denominator for the chosen success_metric
  successes: number // numerator for the chosen success_metric
  rate: number | null
}

export interface SignificanceResult {
  variantStats: VariantStat[]
  metricSupportsZTest: boolean // false for 'cpa'/'roas' — see the note below
  comparison?: { winnerVariantId: string; runnerUpVariantId: string; pValue: number; confidence: number } // confidence = 1 - pValue, only present when significantAt95
  minSampleNote?: string
  readyToEvaluate: boolean // every variant has cleared MIN_SUCCESSES_PER_VARIANT
}

export async function computeExperimentSignificance(experimentId: string): Promise<SignificanceResult | { error: string }> {
  const { data: experiment } = await supabaseAdmin
    .from('qads_experiments')
    .select('id, campaign_id, variants, success_metric, created_at')
    .eq('id', experimentId)
    .maybeSingle()
  if (!experiment) return { error: 'Experiment not found' }

  const variants = (experiment.variants as ExperimentVariant[]) ?? []
  if (!variants.length) return { error: 'Experiment has no variants' }

  const successMetric = experiment.success_metric as ExperimentSuccessMetric
  const variantStats: VariantStat[] = []

  for (const variant of variants) {
    const externalIds = await resolveVariantExternalIds(variant)
    const agg = await aggregateMetrics(externalIds, variant.refType, experiment.created_at as string)
    const { trials, successes, rate } = deriveTrialsAndSuccesses(agg, successMetric)
    variantStats.push({ variantId: variant.id, refType: variant.refType, refId: variant.refId, ...agg, trials, successes, rate })
  }

  // 'cpa' and 'roas' are cost/value ratios, not binomial proportions — a two-proportion
  // z-test doesn't apply to them honestly. Rather than misapply the test, this is
  // surfaced as an explicit unsupported case (docs/qads-proposal.md §9 leaves the exact
  // stats approach open; this is the boundary of what's implemented here).
  const metricSupportsZTest = successMetric === 'ctr' || successMetric === 'conversions'
  if (!metricSupportsZTest) {
    return { variantStats, metricSupportsZTest, readyToEvaluate: false, minSampleNote: `Significance testing for '${successMetric}' is not implemented yet — only ctr/conversions run a z-test today (cost and value ratios need a different test, open item).` }
  }

  const readyToEvaluate = variantStats.every((v) => v.successes >= MIN_SUCCESSES_PER_VARIANT)
  if (!readyToEvaluate) {
    const laggard = variantStats.reduce((min, v) => (v.successes < min.successes ? v : min))
    return { variantStats, metricSupportsZTest, readyToEvaluate, minSampleNote: minSampleNote(laggard.successes) ?? undefined }
  }

  const ranked = [...variantStats].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
  const [best, runnerUp] = ranked
  const test = twoProportionZTest(best.successes, best.trials, runnerUp.successes, runnerUp.trials)
  if (!test) return { variantStats, metricSupportsZTest, readyToEvaluate, minSampleNote: 'Not enough trials to compute a z-test' }

  if (!test.significantAt95) {
    return { variantStats, metricSupportsZTest, readyToEvaluate, minSampleNote: `Difference between top variants is not statistically significant yet (p=${test.pValue.toFixed(3)}) — keep running` }
  }

  return {
    variantStats,
    metricSupportsZTest,
    readyToEvaluate,
    comparison: { winnerVariantId: best.variantId, runnerUpVariantId: runnerUp.variantId, pValue: test.pValue, confidence: 1 - test.pValue },
  }
}

export async function resolveVariantExternalIds(variant: ExperimentVariant): Promise<string[]> {
  if (variant.refType === 'ad_set') {
    const { data } = await supabaseAdmin.from('qads_ad_sets').select('external_id').eq('id', variant.refId).maybeSingle()
    return data?.external_id ? [data.external_id] : []
  }
  if (variant.refType === 'ad') {
    const { data } = await supabaseAdmin.from('qads_ads').select('external_id').eq('id', variant.refId).maybeSingle()
    return data?.external_id ? [data.external_id] : []
  }
  // 'creative' — a creative can back more than one ad (e.g. reused across ad sets); sum
  // across every ad currently using it.
  const { data } = await supabaseAdmin.from('qads_ads').select('external_id').eq('creative_id', variant.refId).not('external_id', 'is', null)
  return (data ?? []).map((r) => r.external_id as string)
}

async function aggregateMetrics(
  externalIds: string[],
  refType: ExperimentVariant['refType'],
  sinceIso: string,
): Promise<{ impressions: number; clicks: number; conversions: number; spendMinor: number; conversionValueMinor: number }> {
  const empty = { impressions: 0, clicks: 0, conversions: 0, spendMinor: 0, conversionValueMinor: 0 }
  if (!externalIds.length) return empty

  const level = refType === 'ad_set' ? 'ad_set' : 'ad' // 'creative' variants aggregate at ad level too, across every resolved ad id
  const { data } = await supabaseAdmin
    .from('qads_metrics')
    .select('impressions, clicks, conversions, spend_minor, conversion_value_minor')
    .eq('level', level)
    .in('entity_id', externalIds)
    .gte('day', sinceIso.slice(0, 10))

  return (data ?? []).reduce(
    (acc, r) => ({
      impressions: acc.impressions + (r.impressions as number),
      clicks: acc.clicks + (r.clicks as number),
      conversions: acc.conversions + (r.conversions as number),
      spendMinor: acc.spendMinor + (r.spend_minor as number),
      conversionValueMinor: acc.conversionValueMinor + (r.conversion_value_minor as number),
    }),
    empty,
  )
}

function deriveTrialsAndSuccesses(
  agg: { impressions: number; clicks: number; conversions: number },
  successMetric: ExperimentSuccessMetric,
): { trials: number; successes: number; rate: number | null } {
  if (successMetric === 'ctr') {
    return { trials: agg.impressions, successes: agg.clicks, rate: agg.impressions > 0 ? agg.clicks / agg.impressions : null }
  }
  if (successMetric === 'conversions') {
    return { trials: agg.clicks, successes: agg.conversions, rate: agg.clicks > 0 ? agg.conversions / agg.clicks : null }
  }
  return { trials: 0, successes: 0, rate: null }
}
