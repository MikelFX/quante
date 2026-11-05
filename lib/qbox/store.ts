// Qbox storage + API-key auth. Server-only, service role (supabase/migration-qbox-beta.sql, and
// supabase/migration-qbox-open.sql for the open paid tier). Every helper fails closed: without the
// migration nothing can be started.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { QBOX_BETA, apiKeyFrom, dayStartUtc, hashApiKey, isOpenAccess, monthStartUtc, paidBalance, tierLimits, vcpuMinutesToday, type GlobalLoad, type Limits, type SandboxRow } from './model'

export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export class QboxNotSetUpError extends Error {}

export interface BetaMember extends Limits {
  userId: string
}

/**
 * The account's Qbox access. QBOX_ACCESS=open: everyone is on the paid tier (a `qbox_beta` row
 * only raises concurrency). Otherwise only invited accounts, on the free beta. null when not let in, or paused (a disabled row also blocks the
 * paid tier, so the operator can stop an abuser). Throws when the table is missing.
 */
export async function betaMember(userId: string): Promise<BetaMember | null> {
  const { data, error } = await supabaseAdmin
    .from('qbox_beta').select('user_id, max_concurrent, monthly_minutes, disabled').eq('user_id', userId).maybeSingle()
  if (error) {
    if (isMissingTable(error)) throw new QboxNotSetUpError('Qbox beta is not set up yet.')
    throw new Error(error.message)
  }
  if (data?.disabled) return null
  if (isOpenAccess(process.env)) return { userId, ...tierLimits('paid', { maxConcurrent: data?.max_concurrent ?? null }) }
  if (data) return { userId, ...tierLimits('beta', { maxConcurrent: data.max_concurrent, monthlyMinutes: data.monthly_minutes }) }
  return null
}

export interface KeyAuth { member: BetaMember; keyId: string }

export const apiError = (status: number, error: string) => NextResponse.json({ error }, { status })

/** Authenticates an API request by its key. Returns the member or a ready error response. */
export async function authenticate(request: Request): Promise<KeyAuth | NextResponse> {
  if (process.env.QBOX_DISABLED === '1') return apiError(503, 'Qbox is paused. Try again later.')
  const key = apiKeyFrom(request.headers)
  if (!key) return apiError(401, 'Send your API key: Authorization: Bearer qbx_…')
  const { data, error } = await supabaseAdmin
    .from('qbox_api_keys').select('id, user_id, revoked_at').eq('key_hash', hashApiKey(key)).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return apiError(503, 'Qbox beta is not set up yet.')
    return apiError(500, 'Could not check the API key.')
  }
  if (!data || data.revoked_at) return apiError(401, 'Unknown or revoked API key.')
  let member: BetaMember | null
  try {
    member = await betaMember(data.user_id)
  } catch {
    return apiError(503, 'Qbox beta is not set up yet.')
  }
  if (!member) return apiError(403, 'This account has no Qbox access (not invited, or paused).')
  void supabaseAdmin.from('qbox_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})
  return { member, keyId: data.id }
}

export type FullRow = SandboxRow & { user_id: string; template: string; ports: number[] | null; metadata: Record<string, string> | null }

const COLS = 'id, user_id, status, created_at, expires_at, ended_at, template, ports, metadata'

const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || /column .*vcpus/i.test(error.message ?? ''))

/** Selects with the `vcpus` column, or without it before supabase/migration-qbox-open.sql ran. */
async function selectRows<T>(build: (cols: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, cols: string): Promise<T[]> {
  let r = await build(`${cols}, vcpus`)
  if (isMissingColumn(r.error)) r = await build(cols)
  if (r.error) throw new Error(r.error.message)
  return (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []) as T[]
}

/** This month's sandboxes of a member (plus any still running from last month). */
export async function memberSandboxes(userId: string, now: number): Promise<FullRow[]> {
  const since = new Date(Math.min(monthStartUtc(now), now - QBOX_BETA.maxTimeoutMs)).toISOString()
  return selectRows<FullRow>((cols) => supabaseAdmin
    .from('qbox_sandboxes').select(cols).eq('user_id', userId).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(2000), COLS)
}

/** Load across the whole service: sandboxes running now, and vCPU-minutes reserved today (UTC). */
export async function globalLoad(now: number): Promise<GlobalLoad> {
  const since = new Date(dayStartUtc(now) - QBOX_BETA.maxTimeoutMs).toISOString()
  const rows = await selectRows<SandboxRow>((cols) => supabaseAdmin
    .from('qbox_sandboxes').select(cols).gte('created_at', since).limit(20_000), 'id, status, created_at, expires_at, ended_at')
  return {
    live: rows.filter((r) => r.status === 'running' && Date.parse(r.expires_at) > now).length,
    vcpuMinutesToday: vcpuMinutesToday(rows, now),
  }
}

/** The member's own sandbox, or null (another member's id is "not found", never "forbidden"). */
export async function ownSandbox(userId: string, id: string): Promise<FullRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const rows = await selectRows<FullRow>((cols) => supabaseAdmin.from('qbox_sandboxes').select(cols).eq('id', id).eq('user_id', userId).maybeSingle(), COLS)
  return rows[0] ?? null
}

export async function markEnded(id: string, status: 'stopped' | 'failed', error?: string) {
  await supabaseAdmin.from('qbox_sandboxes')
    .update({ status, ended_at: new Date().toISOString(), ...(error ? { error: error.slice(0, 500) } : {}) })
    .eq('id', id).eq('status', 'running')
}

/** Top-ups and billed sandboxes of a paid account → its prepaid balance in vCPU-minutes. */
export async function paidAccount(userId: string, now: number): Promise<{ balance: number; topups: number }> {
  const [t, b] = await Promise.all([
    supabaseAdmin.from('qbox_topups').select('vcpu_minutes').eq('user_id', userId).limit(10_000),
    supabaseAdmin.from('qbox_sandboxes').select('id, status, created_at, expires_at, ended_at, vcpus')
      .eq('user_id', userId).eq('billed', true).limit(50_000),
  ])
  if (t.error || b.error) throw new QboxNotSetUpError('Qbox paid access is not set up yet.')
  return { balance: paidBalance(t.data ?? [], (b.data ?? []) as SandboxRow[], now), topups: (t.data ?? []).length }
}

/** Has this account ever paid real money for credits? Welcome credits alone can't buy Qbox time. */
export async function hasPaidPurchase(userId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin.from('purchases').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  return !error && (count ?? 0) > 0
}
