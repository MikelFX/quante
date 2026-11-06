// The marketplace's public numbers — GET /api/qbox/v1/services/stats and the website's agent counter
// (lib/agents/stats.ts imports serviceStats()). Server-only. null until
// supabase/migration-qbox-services.sql has run.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { marketStats, type CallRow } from './model'

export interface ServiceStatsSummary {
  servicesLive: number
  sellers: number
  buyers: number
  paidCalls: number
  volumeUsd: string
  /** First paid call ever (ISO), or null before the first sale. */
  since: string | null
}

let cache: { at: number; value: ServiceStatsSummary } | null = null

export async function serviceStats(): Promise<ServiceStatsSummary | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value
  const [live, calls] = await Promise.all([
    supabaseAdmin.from('qbox_services').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    supabaseAdmin.from('qbox_service_calls').select('service_id, seller_id, payer, price_units, status, created_at')
      .eq('status', 'paid').order('created_at', { ascending: true }).limit(200_000),
  ])
  if (live.error || calls.error) return null
  const rows = (calls.data ?? []) as CallRow[]
  const value = { ...marketStats(live.count ?? 0, rows), since: rows[0]?.created_at ?? null }
  cache = { at: Date.now(), value }
  return value
}
