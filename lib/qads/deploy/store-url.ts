// Resolves the live storefront URL for a project, for use as an ad's landing_page_url /
// link field. Reads the latest `deployments` row (see supabase/migration-hosting.sql) —
// same table the Publish panel and export flow already treat as the source of truth for
// "what's actually live" — preferring a verified custom domain, then the assigned
// subdomain, then the raw Vercel deployment URL as a last resort.

import { supabaseAdmin } from '@/lib/supabase/admin'

export async function resolveStoreUrl(projectId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('deployments')
    .select('domain, custom_domain, custom_domain_verified, url, status')
    .eq('project_id', projectId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  const host = data.custom_domain_verified && data.custom_domain ? data.custom_domain : data.domain
  if (host) return `https://${host}`
  return data.url ? (data.url.startsWith('http') ? data.url : `https://${data.url}`) : null
}
