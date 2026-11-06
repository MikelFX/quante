// Qbox services storage. Server-only, service role (supabase/migration-qbox-services.sql). Every
// helper fails closed: without the migration the services API answers "not set up".

import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '../store'
import type { CallRow, ServiceInput, ServiceRow, ServiceStatus } from './model'

export class ServicesNotSetUpError extends Error {
  constructor() {
    super('Qbox services are not set up yet.')
  }
}

type PgError = { code?: string; message?: string } | null

function check(error: PgError) {
  if (!error) return
  if (isMissingTable(error)) throw new ServicesNotSetUpError()
  throw new Error(error.message ?? 'database error')
}

const COLS = 'id, slug, user_id, name, description, price_units, upstream, input_schema, example, tags, status, wallet, network, created_at'

export interface WalletRow { user_id: string; address: string; network: string; verified_at: string }

export async function walletOf(userId: string): Promise<WalletRow | null> {
  const { data, error } = await supabaseAdmin.from('qbox_wallets').select('user_id, address, network, verified_at').eq('user_id', userId).maybeSingle()
  check(error)
  return (data as WalletRow | null) ?? null
}

export async function saveWallet(userId: string, address: string, network: string, signature: string, message: string) {
  const { error } = await supabaseAdmin.from('qbox_wallets').upsert(
    { user_id: userId, address: address.toLowerCase(), network, signature, message, verified_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  check(error)
  // Listed services follow the new wallet: payments for them go there from now on.
  const { error: e2 } = await supabaseAdmin.from('qbox_services').update({ wallet: address.toLowerCase(), network, updated_at: new Date().toISOString() })
    .eq('user_id', userId).in('status', ['live', 'paused'])
  check(e2)
}

export async function serviceBySlug(slug: string): Promise<ServiceRow | null> {
  const { data, error } = await supabaseAdmin.from('qbox_services').select(COLS).eq('slug', slug).maybeSingle()
  check(error)
  return (data as ServiceRow | null) ?? null
}

export async function servicesOf(userId: string): Promise<ServiceRow[]> {
  const { data, error } = await supabaseAdmin.from('qbox_services').select(COLS).eq('user_id', userId).neq('status', 'removed')
    .order('created_at', { ascending: false }).limit(100)
  check(error)
  return (data ?? []) as ServiceRow[]
}

export async function liveServices(limit = 500): Promise<ServiceRow[]> {
  const { data, error } = await supabaseAdmin.from('qbox_services').select(COLS).eq('status', 'live')
    .order('created_at', { ascending: false }).limit(limit)
  check(error)
  return (data ?? []) as ServiceRow[]
}

/** false when the slug is taken. */
export async function insertService(userId: string, s: ServiceInput, wallet: string, network: string): Promise<ServiceRow | false> {
  const { data, error } = await supabaseAdmin.from('qbox_services').insert({
    slug: s.slug, user_id: userId, name: s.name, description: s.description, price_units: s.priceUnits,
    upstream: s.upstream, input_schema: s.inputSchema, example: s.example, tags: s.tags, wallet, network,
  }).select(COLS).single()
  if (error?.code === '23505') return false
  check(error)
  return data as ServiceRow
}

export async function updateService(id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('qbox_services').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  check(error)
}

export async function deleteService(id: string) {
  await supabaseAdmin.from('qbox_services').delete().eq('id', id)
}

export async function setStatus(id: string, status: ServiceStatus, reason?: string | null) {
  await updateService(id, { status, ...(reason !== undefined ? { blocked_reason: reason } : {}) })
}

export async function callsOf(serviceIds: string[], sinceIso?: string): Promise<CallRow[]> {
  if (!serviceIds.length) return []
  let q = supabaseAdmin.from('qbox_service_calls').select('service_id, seller_id, payer, price_units, status, created_at, duration_ms').in('service_id', serviceIds)
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { data, error } = await q.limit(50_000)
  check(error)
  return (data ?? []) as CallRow[]
}

/** Reserves one paid call for a payment nonce. false = this payment was used already. */
export async function startCall(row: { service_id: string; seller_id: string; payer: string | null; price_units: number; nonce: string; network: string }): Promise<string | false> {
  const { data, error } = await supabaseAdmin.from('qbox_service_calls').insert({ ...row, status: 'pending' }).select('id').single()
  if (error?.code === '23505') return false
  check(error)
  return (data as { id: string }).id
}

export async function finishCall(id: string, patch: { status: CallRow['status']; upstream_status?: number | null; transaction?: string | null; payer?: string | null; fee_vcpu_minutes?: number; duration_ms?: number }) {
  await supabaseAdmin.from('qbox_service_calls').update(patch).eq('id', id)
}

export async function addReport(serviceId: string, reason: string, reporter: string | null, ipHash: string) {
  const { error } = await supabaseAdmin.from('qbox_service_reports').insert({ service_id: serviceId, reason, reporter, ip_hash: ipHash })
  check(error)
}
