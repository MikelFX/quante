// Which web origins belong to a project's storefront. Server-only.
//
// SECURITY (audit #11): the checkout used to build Stripe/Comgate/GoPay/PayPal
// success/cancel URLs from the request's Origin header + a client-supplied path, so
// anyone could mint a payment session on Quante's accounts that redirects to their own
// site. Redirect bases now come only from this allowlist: the project's claimed
// <store_slug>.<HOSTING_ROOT_DOMAIN>, hosts of its own deployments, and custom domains
// verified for it.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'

export function originOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const u = new URL(value.includes('://') ? value : `https://${value}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    return u.origin.toLowerCase()
  } catch {
    return null
  }
}

function addHost(set: Set<string>, host: string | null | undefined) {
  if (!host || typeof host !== 'string') return
  const o = originOf(host.startsWith('http') ? host : `https://${host}`)
  if (!o || !o.startsWith('https://')) return
  set.add(o)
  // Serve both apex and www for custom domains.
  const h = o.slice('https://'.length)
  if (h.startsWith('www.')) set.add(`https://${h.slice(4)}`)
  else if (h.split('.').length === 2) set.add(`https://www.${h}`)
}

export interface StoreOrigins {
  allowed: Set<string>
  /** Best public origin of the live store, used when the request has no Origin. */
  canonical: string | null
}

export async function getStoreOrigins(projectId: string): Promise<StoreOrigins> {
  const allowed = new Set<string>()
  let canonical: string | null = null

  // projects.store_slug comes from migration-security-foundation.sql; tolerate its absence.
  const { data: proj, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('store_slug, custom_domain, custom_domain_verified')
    .eq('id', projectId)
    .maybeSingle()
  const p = projErr ? null : (proj as { store_slug?: string | null; custom_domain?: string | null; custom_domain_verified?: boolean | null } | null)

  const verifiedCustom: string[] = []
  if (p?.custom_domain && p.custom_domain_verified) verifiedCustom.push(p.custom_domain)

  const { data: domains } = await supabaseAdmin
    .from('user_domains')
    .select('domain, status, dns_verified')
    .eq('project_id', projectId)
  for (const d of (domains ?? []) as Array<{ domain: string | null; status: string | null; dns_verified: boolean | null }>) {
    if (d.domain && (d.status === 'active' || d.dns_verified === true)) verifiedCustom.push(d.domain)
  }
  for (const d of verifiedCustom) addHost(allowed, d)
  if (verifiedCustom[0]) canonical = originOf(`https://${verifiedCustom[0]}`)

  if (p?.store_slug) {
    const o = `https://${p.store_slug}.${HOSTING_ROOT_DOMAIN}`.toLowerCase()
    allowed.add(o)
    canonical = canonical ?? o
  }

  const { data: deps } = await supabaseAdmin
    .from('deployments')
    .select('domain, url, status, custom_domain, custom_domain_verified')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
  for (const d of (deps ?? []) as Array<{ domain: string | null; url: string | null; status: string | null; custom_domain?: string | null; custom_domain_verified?: boolean | null }>) {
    // Before store_slug existed, the live subdomain was only recorded here.
    if (!p?.store_slug) addHost(allowed, d.domain)
    addHost(allowed, d.url)
    if (d.custom_domain && d.custom_domain_verified) addHost(allowed, d.custom_domain)
    if (!canonical && d.status === 'ready') canonical = originOf(d.domain ? `https://${d.domain}` : d.url)
  }

  return { allowed, canonical }
}
