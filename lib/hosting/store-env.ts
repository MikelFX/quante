// Store ↔ platform connection values (QUANTE_API_URL / QUANTE_PROJECT_ID /
// QUANTE_API_KEY) shared by Push to Live (app/api/deploy/route.ts) and the scaffold
// rollout (lib/hosting/scaffold-rollout.ts). Server-only.

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { setEnvVars } from '@/lib/hosting/vercel'

/**
 * The URL a deployed store calls back to for managed checkout/orders. Fails closed:
 * no hard-coded fallback host (a stale one would route shoppers' orders to a server
 * we may not control). https only, except localhost for local development.
 */
export function platformApiUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) return null
    return u.origin
  } catch {
    return null
  }
}

/**
 * Returns the project's per-store API key (project_secrets.quante_api_key), creating
 * one on first use. `ownerUserId` must be the project's owner (callers verified it).
 * Throws when the key cannot be persisted — a key the store holds but Quante doesn't
 * know would break managed checkout.
 */
export async function ensureStoreApiKey(projectId: string, ownerUserId: string): Promise<string> {
  const readKey = async (): Promise<{ exists: boolean; key: string | null }> => {
    const { data, error } = await supabaseAdmin
      .from('project_secrets')
      .select('quante_api_key')
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) throw new Error(`ensureStoreApiKey: project_secrets lookup failed: ${error.message}`)
    const key = (data as { quante_api_key?: string | null } | null)?.quante_api_key ?? null
    return { exists: !!data, key: key || null }
  }

  const existing = await readKey()
  if (existing.key) return existing.key

  // First use. Concurrent callers (Push to Live, a background scaffold rollout) must
  // all end up with the SAME key — a key the store holds but Quante doesn't know breaks
  // managed checkout. So never overwrite: create the row with ON CONFLICT DO NOTHING
  // (or fill a NULL key only while it is still NULL), then use whatever key is stored.
  const now = new Date().toISOString()
  if (!existing.exists) {
    const { error } = await supabaseAdmin.from('project_secrets').upsert({
      project_id: projectId,
      user_id: ownerUserId,
      quante_api_key: randomUUID(),
      updated_at: now,
    }, { onConflict: 'project_id', ignoreDuplicates: true })
    if (error) throw new Error(`ensureStoreApiKey: failed to persist project secrets: ${error.message}`)
  }
  // Row existed without a key (other secrets stored first), or a concurrent insert won
  // before its key was set: fill it only while still NULL.
  const { error: fillErr } = await supabaseAdmin
    .from('project_secrets')
    .update({ quante_api_key: randomUUID(), updated_at: now })
    .eq('project_id', projectId)
    .is('quante_api_key', null)
  if (fillErr) throw new Error(`ensureStoreApiKey: failed to persist project secrets: ${fillErr.message}`)

  const stored = await readKey()
  if (!stored.key) throw new Error('ensureStoreApiKey: project API key could not be stored')
  return stored.key
}

/**
 * Writes the store's connection env vars onto its Vercel project (setEnvVars enforces
 * the store env allowlist). Takes effect for the NEXT build of that project.
 */
export async function setStoreConnectionEnv(
  vercelProjectId: string,
  projectId: string,
  appUrl: string,
  quanteApiKey: string,
): Promise<void> {
  await setEnvVars(
    vercelProjectId,
    {
      QUANTE_API_URL: appUrl,
      QUANTE_PROJECT_ID: projectId,
      QUANTE_API_KEY: quanteApiKey,
    },
    { encrypted: ['QUANTE_API_KEY'] },
  )
}
