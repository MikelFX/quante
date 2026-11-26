// Plnolet storage + API-key auth. Server-only, service role (supabase/migration-plnolet.sql).
// Every helper fails closed: without the tables nothing is verified.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/qbox/store'
import { PLNOLET, hashKey, keyFrom, type Mode } from './model'
import { liveAvailable } from './providers'

export class PlnoletNotSetUpError extends Error {}

export interface Merchant {
  id: string
  user_id: string
  name: string
  domains: string[]
  live_enabled: boolean
  disabled: boolean
  created_at: string
}

export const apiError = (status: number, error: string, code?: string) =>
  NextResponse.json({ error: { message: error, code: code ?? String(status) } }, { status })

function fail(error: { code?: string; message?: string } | null): never {
  if (isMissingTable(error)) throw new PlnoletNotSetUpError('Plnolet is not set up yet.')
  throw new Error(error?.message ?? 'database error')
}

export async function merchantForUser(userId: string): Promise<Merchant | null> {
  const { data, error } = await supabaseAdmin.from('plnolet_merchants').select('*').eq('user_id', userId).maybeSingle()
  if (error) fail(error)
  return (data as Merchant | null) ?? null
}

export async function merchantById(id: string): Promise<Merchant | null> {
  const { data, error } = await supabaseAdmin.from('plnolet_merchants').select('*').eq('id', id).maybeSingle()
  if (error) fail(error)
  return (data as Merchant | null) ?? null
}

export interface KeyAuth {
  merchant: Merchant
  keyId: string
  mode: Mode
}

/** Authenticates a merchant API call by its key. Returns the merchant or a ready error response. */
export async function authenticate(request: Request): Promise<KeyAuth | NextResponse> {
  if (process.env.PLNOLET_DISABLED === '1') return apiError(503, 'Plnolet is paused. Try again later.', 'paused')
  const parsed = keyFrom(request.headers)
  if (!parsed) return apiError(401, 'Send your API key: Authorization: Bearer plt_test_… or plt_live_…', 'unauthorized')
  const { data, error } = await supabaseAdmin
    .from('plnolet_keys').select('id, merchant_id, mode, revoked_at').eq('key_hash', hashKey(parsed.key)).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return apiError(503, 'Plnolet is not set up yet.', 'not_set_up')
    return apiError(500, 'Could not check the key.')
  }
  if (!data || data.revoked_at || data.mode !== parsed.mode) return apiError(401, 'Unknown or revoked API key.', 'unauthorized')
  const merchant = await merchantById(data.merchant_id).catch(() => null)
  if (!merchant || merchant.disabled) return apiError(403, 'This Plnolet account is paused.', 'paused')
  if (parsed.mode === 'live' && !(merchant.live_enabled && liveAvailable(process.env))) {
    return apiError(403, 'Live verification is not switched on for this account yet. Use a test key.', 'live_off')
  }
  void supabaseAdmin.from('plnolet_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})
  return { merchant, keyId: data.id, mode: parsed.mode }
}

/** Sessions this key opened in the last hour (runaway guard). */
export async function sessionsLastHour(keyId: string): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count, error } = await supabaseAdmin
    .from('plnolet_sessions').select('id', { count: 'exact', head: true }).eq('key_id', keyId).gte('created_at', since)
  if (error) fail(error)
  return count ?? 0
}

export interface Session {
  id: string
  merchant_id: string
  mode: Mode
  threshold: number
  status: 'pending' | 'verified' | 'failed' | 'expired'
  method: 'test' | 'pass' | 'mojeid' | 'bankid' | null
  return_url: string
  reference: string | null
  attempts: number
  pass_issued: boolean
  created_at: string
  expires_at: string
  verified_at: string | null
}

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabaseAdmin.from('plnolet_sessions').select('*').eq('id', id).maybeSingle()
  if (error) fail(error)
  return (data as Session | null) ?? null
}

/**
 * Counts one attempt on a pending session; false when it is no longer pending or out of attempts.
 * The update is conditional on the attempts seen, so parallel requests cannot both slip through.
 */
export async function takeAttempt(s: Session): Promise<boolean> {
  if (s.status !== 'pending' || Date.parse(s.expires_at) <= Date.now()) return false
  if (s.attempts >= PLNOLET.attemptsPerSession) return false
  const { data, error } = await supabaseAdmin
    .from('plnolet_sessions').update({ attempts: s.attempts + 1 })
    .eq('id', s.id).eq('status', 'pending').eq('attempts', s.attempts).select('id')
  if (error) fail(error)
  if (!data?.length) return false
  s.attempts += 1
  return true
}

/** Settles a pending session once (verified or failed). False if it was already settled. */
export async function settle(id: string, ok: boolean, method: Session['method']): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('plnolet_sessions')
    .update({ status: ok ? 'verified' : 'failed', method, verified_at: ok ? now : null })
    .eq('id', id).eq('status', 'pending').gt('expires_at', now).select('id')
  if (error) fail(error)
  return !!data?.length
}

/** What the merchant API returns for a session. No shopper data exists to return. */
export function sessionJson(s: Session, now: number) {
  const status = s.status === 'pending' && Date.parse(s.expires_at) <= now ? 'expired' : s.status
  return {
    id: s.id,
    object: 'verification_session',
    mode: s.mode,
    min_age: s.threshold,
    status,
    verified: status === 'verified',
    method: status === 'verified' ? s.method : null,
    reference: s.reference,
    created_at: s.created_at,
    expires_at: s.expires_at,
    verified_at: s.verified_at,
  }
}
