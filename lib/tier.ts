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

export async function isAgencyUser(userId: string): Promise<boolean> {
  const record = await getUserRecord(userId)
  return record.tier === 'agency' && record.subscription_status === 'active'
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
