// Up-front charge for the Tiktoker routes (characters + talking videos). Server-only.
// Same rules as POST /api/qads/generate: Agency renders go through the daily fair-use cap and
// cost nothing; everyone else is debited atomically BEFORE any paid work, then rate-limited with
// counts that include our own debit (race-safe), refunding when over the limit.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAgencyUser } from '@/lib/tier'
import { reserveAgencyRenders } from './fair-use'
import {
  reserveGeneratorCredits,
  refundGeneratorCredits,
  countRecentReserves,
  QADS_RESERVES_PER_HOUR,
  QADS_GENERATIONS_PER_HOUR,
  QADS_BILLING_HOLD_MESSAGE,
} from './credits'

export type ChargeResult = { ok: true; agency: boolean } | { ok: false; response: NextResponse }

export async function chargeQadsGeneration(params: {
  userId: string
  generationId: string
  credits: number
  videos: number
  images: number
}): Promise<ChargeResult> {
  const { userId, generationId, credits, videos, images } = params
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const recentGenerations = async () => (await supabaseAdmin
    .from('qads_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)).count ?? 0
  const rateLimited = () => ({
    ok: false as const,
    response: NextResponse.json(
      { error: `Rate limit reached — max ${QADS_GENERATIONS_PER_HOUR} generations per hour.`, code: 'rate_limited' },
      { status: 429 },
    ),
  })

  if (await isAgencyUser(userId)) {
    if ((await recentGenerations()) >= QADS_GENERATIONS_PER_HOUR) return rateLimited()
    const fair = await reserveAgencyRenders(userId, generationId, videos, images)
    if (!fair.ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: fair.message, code: fair.error === 'fair_use' ? 'fair_use' : 'db_error' },
          { status: fair.error === 'fair_use' ? 429 : 503 },
        ),
      }
    }
    return { ok: true, agency: true }
  }

  const reserve = await reserveGeneratorCredits({ userId, amount: credits, generationId })
  if (!reserve.ok) {
    if (reserve.error === 'insufficient_credits') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'insufficient_credits', code: 'insufficient_credits', balance: reserve.balance, needed: reserve.needed },
          { status: 402 },
        ),
      }
    }
    if (reserve.error === 'billing_hold') {
      return { ok: false, response: NextResponse.json({ error: QADS_BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 }) }
    }
    return { ok: false, response: NextResponse.json({ error: 'Failed to reserve credits', code: 'db_error' }, { status: 500 }) }
  }
  if ((await countRecentReserves(userId)) > QADS_RESERVES_PER_HOUR || (await recentGenerations()) >= QADS_GENERATIONS_PER_HOUR) {
    await refundGeneratorCredits({ userId, generationId, reason: 'qads_rate_limited' })
    return rateLimited()
  }
  return { ok: true, agency: false }
}

/** Signs a finished output (e.g. a character sheet) for a model to fetch. */
export async function signOutput(bucket: string, path: string, ttlSeconds = 60 * 60 * 2): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttlSeconds)
  return data?.signedUrl ?? null
}

/** The caller's own finished character: its sheet's storage location and its trait summary. */
export async function loadOwnCharacter(userId: string, characterId: string): Promise<{ bucket: string; path: string; summary: string } | null> {
  const { data: gen } = await supabaseAdmin
    .from('qads_generations')
    .select('id, style, product_description')
    .eq('id', characterId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!gen || gen.style !== 'character') return null
  const { data: item } = await supabaseAdmin
    .from('qads_items')
    .select('status, storage_bucket, storage_path')
    .eq('generation_id', characterId)
    .eq('user_id', userId)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle()
  if (!item?.storage_bucket || !item.storage_path) return null
  return { bucket: item.storage_bucket as string, path: item.storage_path as string, summary: (gen.product_description as string) ?? '' }
}
