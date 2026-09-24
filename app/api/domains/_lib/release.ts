// Server-only helpers shared by the /api/domains/* routes (the `_lib` folder is
// not routable). They decide which user_domains rows actually prove that
// someone holds a name, and release the rows that don't.
import { supabaseAdmin } from '@/lib/supabase/admin'

/** A user_domains row, read with select('*') so optional columns never break the query. */
export interface DomainRow {
  id: string
  user_id: string
  project_id: string | null
  domain: string
  status: string
  vercel_project_id: string | null
  namecheap_order_id?: string | null
  registered_at?: string | null
  stripe_session_id?: string | null
  dns_verified?: boolean | null
  created_at?: string | null
}

/**
 * How long a claim that proves nothing (not DNS-verified, not bought through Quante)
 * may hold an exact name against other users. After that the name can be taken by
 * whoever proves it (audit #38 follow-up: a squatter must not lock the real owner out).
 */
export const UNVERIFIED_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000

const LIVE_STATUSES = new Set(['pending', 'active', 'registering'])

export function isLiveStatus(status: string | null | undefined): boolean {
  return LIVE_STATUSES.has(String(status ?? ''))
}

/**
 * Bought through Quante (paid checkout and/or a Namecheap order on Quante's
 * registrar account). Such a row keeps holding the name even after the owner
 * soft-deletes it: the registration and its Vercel DNS still exist.
 */
export function isQuanteRegistered(row: DomainRow): boolean {
  return !!row.namecheap_order_id || !!row.registered_at || !!row.stripe_session_id || row.status === 'registering'
}

/**
 * Whether a row blocks OTHER users from the name. A connect-only row that is
 * expired / failed proves nothing and must not squat the name forever.
 */
export function rowHoldsName(row: DomainRow): boolean {
  return isLiveStatus(row.status) || isQuanteRegistered(row)
}

/**
 * A row that PROVES control of the name: bought through Quante, or live and
 * DNS-verified (dns_verified is only set once the zone's public DNS actually points at
 * Vercel — see getDomainDnsConfigured). Only proven rows block OTHER users from a
 * parent or child of the name.
 */
export function rowProvesOwnership(row: DomainRow): boolean {
  return isQuanteRegistered(row) || (isLiveStatus(row.status) && row.dns_verified === true)
}

/**
 * Whether a row blocks OTHER users from this exact name: a proven row always does; an
 * unproven live row only for UNVERIFIED_CLAIM_TTL_MS after it was created.
 */
export function rowHoldsExactName(row: DomainRow, now: number = Date.now()): boolean {
  if (rowProvesOwnership(row)) return true
  if (!isLiveStatus(row.status)) return false
  const created = row.created_at ? Date.parse(row.created_at) : NaN
  // Unknown age → keep holding (fail closed).
  if (!Number.isFinite(created)) return true
  return now - created < UNVERIFIED_CLAIM_TTL_MS
}

/** Every parent of `host` with at least two labels, including itself. */
export function selfAndParents(host: string): string[] {
  const labels = host.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/**
 * Removes `host` from a Vercel project. A 404 (already gone) counts as success;
 * anything else throws, so callers never drop the DB row while the domain is
 * still served by that project.
 */
export async function detachFromVercel(vercelProjectId: string, host: string): Promise<void> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not configured')
  const params = new URLSearchParams()
  if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID)
  const qs = params.toString()
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(host)}${qs ? `?${qs}` : ''}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  if (res.ok || res.status === 404) return
  const text = await res.text().catch(() => '')
  throw new Error(`Vercel domain removal failed (${res.status}) for ${host}: ${text.slice(0, 200)}`)
}

// Is `host` still in use on this Vercel project by something other than `excludeRowId`
// (another user_domains row, or a project's custom_domain from /api/hosting/domain)?
async function hostStillReferenced(host: string, vercelProjectId: string, excludeRowId: string): Promise<boolean> {
  const [rows, projects] = await Promise.all([
    supabaseAdmin.from('user_domains').select('id').eq('domain', host).eq('vercel_project_id', vercelProjectId).neq('id', excludeRowId).limit(1),
    supabaseAdmin.from('projects').select('id').eq('custom_domain', host).eq('vercel_project_id', vercelProjectId).limit(1),
  ])
  // Unknown → assume referenced, so we never detach something still in use.
  if (rows.error || projects.error) return true
  return (rows.data?.length ?? 0) > 0 || (projects.data?.length ?? 0) > 0
}

/**
 * Detaches a row's host (and the www variant /api/domains/[id] adds for apexes)
 * from its Vercel project, then hard-deletes the row. Compare-and-set on
 * user_id + status so a row that changed meanwhile is left alone.
 *
 * `force`: detach even when something else references the host — only for names
 * that are provably unregistered at the registry, where no claim is legitimate.
 * Returns false when the row changed concurrently and was not deleted.
 */
export async function releaseDomainRow(row: DomainRow, opts: { force?: boolean } = {}): Promise<boolean> {
  if (row.vercel_project_id) {
    const hosts = row.domain.split('.').length === 2 ? [row.domain, `www.${row.domain}`] : [row.domain]
    for (const host of hosts) {
      if (!opts.force && (await hostStillReferenced(host, row.vercel_project_id, row.id))) continue
      await detachFromVercel(row.vercel_project_id, host)
    }
  }
  const { data, error } = await supabaseAdmin
    .from('user_domains')
    .delete()
    .eq('id', row.id)
    .eq('user_id', row.user_id)
    .eq('status', row.status)
    .select('id')
  if (error) throw new Error(`user_domains delete failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}
