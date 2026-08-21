// GET /api/projects/[id]/health
// Store Health Score — computes the "Ready to sell" checklist for the Studio's admin
// dashboard. Read-only, free (no credit cost) — this is informational, not an AI call.
// Scoring logic lives in lib/store-health.ts (kept dependency-free for unit testing).

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import { computeStoreHealth } from '@/lib/store-health'
import type { BusinessInfo, PaymentsInfo, ShippingInfo } from '@/types/business'
import type { CodeVersionFiles } from '@/types/store-code'

// Deterministic legal page paths written by /api/quante/legal (see
// lib/store-template/build.ts). Kept in sync with that route's scaffold output.
const LEGAL_PAGE_PATHS = ['app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx', 'app/contact/page.tsx']

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const { id: projectId } = await params
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const [codeResult, deploymentResult, secretsResult] = await Promise.all([
    supabaseAdmin
      .from('code_versions')
      .select('files')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('deployments')
      .select('status, domain, custom_domain, custom_domain_verified')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('project_secrets')
      .select('email_test_sent_at, merchant_json, payments_json, shipping_json')
      .eq('project_id', projectId)
      .maybeSingle(),
  ])

  const files = (codeResult.data?.files ?? {}) as CodeVersionFiles
  const products = files[PRODUCTS_FILE] ? parseProductsFile(files[PRODUCTS_FILE]) : null
  const hasCookieConsent = Object.keys(files).some((path) => path.endsWith('CookieConsent.tsx'))
  const legalPagesPresent = LEGAL_PAGE_PATHS.filter((p) => p in files).length

  const deploymentRow = deploymentResult.data
  const deployment = deploymentRow
    ? {
        status: deploymentRow.status as string | null,
        domain: deploymentRow.domain as string | null,
        customDomain: deploymentRow.custom_domain as string | null,
        customDomainVerified: !!deploymentRow.custom_domain_verified,
      }
    : null

  const health = computeStoreHealth({
    merchant: (secretsResult.data?.merchant_json as BusinessInfo | undefined) ?? null,
    payments: (secretsResult.data?.payments_json as PaymentsInfo | undefined) ?? null,
    shipping: (secretsResult.data?.shipping_json as ShippingInfo | undefined) ?? null,
    legalPagesPresent,
    products,
    hasCookieConsent,
    deployment,
    emailTestSentAt: (secretsResult.data?.email_test_sent_at as string | null) ?? null,
  })

  return Response.json(health)
}
