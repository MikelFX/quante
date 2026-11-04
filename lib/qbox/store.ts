// Qbox beta storage + API-key auth. Server-only, service role (supabase/migration-qbox-beta.sql).
// Every helper fails closed: without the migration nothing can be started.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { QBOX_BETA, apiKeyFrom, hashApiKey, monthStartUtc, type Limits, type SandboxRow } from './model'

export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export class QboxNotSetUpError extends Error {}

export interface BetaMember extends Limits {
  userId: string
}

/** The member's beta row, or null when not invited / disabled. Throws when the table is missing. */
export async function betaMember(userId: string): Promise<BetaMember | null> {
  const { data, error } = await supabaseAdmin
    .from('qbox_beta').select('user_id, max_concurrent, monthly_minutes, disabled').eq('user_id', userId).maybeSingle()
  if (error) {
    if (isMissingTable(error)) throw new QboxNotSetUpError('Qbox beta is not set up yet.')
    throw new Error(error.message)
  }
  if (!data || data.disabled) return null
  return {
    userId,
    maxConcurrent: data.max_concurrent ?? QBOX_BETA.maxConcurrent,
    monthlyMinutes: data.monthly_minutes ?? QBOX_BETA.monthlyMinutes,
  }
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
  if (!member) return apiError(403, 'This account is not in the Qbox beta (or its access was paused).')
  void supabaseAdmin.from('qbox_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})
  return { member, keyId: data.id }
}

export type FullRow = SandboxRow & { user_id: string; template: string; ports: number[] | null; metadata: Record<string, string> | null }

const COLS = 'id, user_id, status, created_at, expires_at, ended_at, template, ports, metadata'

/** This month's sandboxes of a member (plus any still running from last month). */
export async function memberSandboxes(userId: string, now: number): Promise<FullRow[]> {
  const since = new Date(Math.min(monthStartUtc(now), now - QBOX_BETA.maxTimeoutMs)).toISOString()
  const { data, error } = await supabaseAdmin
    .from('qbox_sandboxes').select(COLS).eq('user_id', userId).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as FullRow[]
}

export async function globalLiveCount(now: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('qbox_sandboxes').select('id', { count: 'exact', head: true })
    .eq('status', 'running').gt('expires_at', new Date(now).toISOString())
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** The member's own sandbox, or null (another member's id is "not found", never "forbidden"). */
export async function ownSandbox(userId: string, id: string): Promise<FullRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await supabaseAdmin.from('qbox_sandboxes').select(COLS).eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as FullRow | null) ?? null
}

export async function markEnded(id: string, status: 'stopped' | 'failed', error?: string) {
  await supabaseAdmin.from('qbox_sandboxes')
    .update({ status, ended_at: new Date().toISOString(), ...(error ? { error: error.slice(0, 500) } : {}) })
    .eq('id', id).eq('status', 'running')
}
