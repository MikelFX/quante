// Ownership check for project-scoped routes. Server-only.
//
// Every server route talks to Supabase through the service-role client, so RLS does
// NOT protect anything — a route that loads a project by id alone lets any signed-in
// user read or mutate another tenant's project. Load projects through this helper
// (or an equivalent `.eq('user_id', userId)` filter) before doing anything with them.

import { supabaseAdmin } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * Returns the project row only if `projectId` is a valid uuid AND the project belongs
 * to `userId`; null otherwise (not found, not owned, malformed id, or lookup error —
 * callers should answer 404 in every case so ownership isn't leaked).
 */
export async function getOwnedProject<T = Record<string, unknown>>(
  projectId: unknown,
  userId: string,
  columns = 'id, user_id, name',
): Promise<T | null> {
  if (!isUuid(projectId)) return null
  if (typeof userId !== 'string' || userId.length === 0) return null

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select(columns)
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[auth/project] project lookup failed:', error.message)
    return null
  }
  return (data as T | null) ?? null
}
