// Called by deployed stores' app/terms, app/privacy, app/cookies, app/contact pages
// (server components, hosted mode — see lib/store-template/build.ts) to render live
// legal content generated from the merchant's business info. Public, no auth: the
// caller is the deployed store's own Next.js server, not a logged-in browser session
// (same pattern as app/api/store/checkout).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateTermsEn, generatePrivacyEn, generateCookiesEn, generateContactEn } from '@/lib/legal-templates-en'
import type { BusinessInfo, PaymentsInfo, ShippingInfo } from '@/types/business'
import { EMPTY_BUSINESS_INFO } from '@/types/business'

const PAGES = ['terms', 'privacy', 'cookies', 'contact'] as const
type LegalPageId = (typeof PAGES)[number]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const page = searchParams.get('page') as LegalPageId | null
  if (!projectId || !page || !PAGES.includes(page)) {
    return NextResponse.json({ error: 'projectId and a valid page (terms|privacy|cookies|contact) are required' }, { status: 400 })
  }

  const { data } = await supabaseAdmin
    .from('project_secrets')
    .select('merchant_json, payments_json, shipping_json')
    .eq('project_id', projectId)
    .maybeSingle()

  const merchant = (data?.merchant_json as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO
  const payments = (data?.payments_json as PaymentsInfo | null) ?? null
  const shipping = (data?.shipping_json as ShippingInfo | null) ?? null

  const result =
    page === 'terms' ? generateTermsEn(merchant, payments, shipping)
    : page === 'privacy' ? generatePrivacyEn(merchant)
    : page === 'cookies' ? generateCookiesEn(merchant)
    : generateContactEn(merchant)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
