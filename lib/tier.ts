import { supabaseAdmin } from './supabase/admin'
import { FREE_PROJECT_LIMIT, AGENCY_PROJECT_LIMIT } from './config'

export type UserTier = 'free' | 'credit' | 'agency'

export interface UserRecord {
  tier: UserTier
  project_limit: number
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  subscription_status: string | null
  current_period_end: string | null
}

const DEFAULT_RECORD: UserRecord = {
  tier: 'free',
  project_limit: FREE_PROJECT_LIMIT,
  stripe_subscription_id: null,
  stripe_customer_id: null,
  subscription_status: null,
  current_period_end: null,
}

export async function getUserRecord(userId: string): Promise<UserRecord> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('tier, project_limit, stripe_subscription_id, stripe_customer_id, subscription_status, current_period_end')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return DEFAULT_RECORD
  return {
    tier: (data.tier as UserTier) ?? 'free',
    project_limit: data.project_limit ?? FREE_PROJECT_LIMIT,
    stripe_subscription_id: data.stripe_subscription_id ?? null,
    stripe_customer_id: data.stripe_customer_id ?? null,
    subscription_status: data.subscription_status ?? null,
    current_period_end: data.current_period_end ?? null,
  }
}

// 42703 = undefined_column (Postgres); PGRST204 = column not in PostgREST's schema cache.
// Either means users.billing_hold does not exist yet (migration not run) → no hold.
function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

/**
 * Active Agency plan AND no billing hold (audit F2). A chargeback on an Agency invoice
 * only sets users.billing_hold (the subscription stays 'active' until Stripe moves it),
 * so without this the hold would leave production hosting and every Agency bonus in
 * place. Fails closed for the Agency bonus: a hold lookup error = not Agency. A missing
 * billing_hold column = no hold.
 */
export async function isAgencyUser(userId: string): Promise<boolean> {
  const record = await getUserRecord(userId)
  if (record.tier !== 'agency' || record.subscription_status !== 'active') return false

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('billing_hold')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return true
    console.error('[tier] billing_hold lookup failed:', error.message)
    return false
  }
  return (data as { billing_hold?: boolean | null } | null)?.billing_hold !== true
}

// Upsert a user row — used by webhook to set tier and subscription state.
export async function upsertUser(
  userId: string,
  updates: Partial<Omit<UserRecord, 'tier'> & { tier: UserTier }>
): Promise<void> {
  const projectLimit =
    updates.tier === 'agency' ? AGENCY_PROJECT_LIMIT :
    updates.tier === 'free'   ? FREE_PROJECT_LIMIT   :
    updates.project_limit     ?? FREE_PROJECT_LIMIT

  await supabaseAdmin.from('users').upsert(
    { id: userId, ...updates, project_limit: projectLimit, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  )
}
