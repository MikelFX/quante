// The shopper's verification window: quantecode.com/plnolet/v/<session>. Opened by a merchant's
// checkout (redirect or the widget's popup). Shows only what the shopper needs: which shop asks,
// the age, and the ways to prove it.

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { effectiveStatus, isSessionId, returnTo } from '@/lib/plnolet/model'
import { providers } from '@/lib/plnolet/providers'
import { PnFoot, PnTop } from '../../_chrome'
import { VerifyClient, type VerifyProps } from './VerifyClient'
import '../../plnolet.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Ověření věku · Plnolet', robots: { index: false, follow: false }, referrer: 'no-referrer' }

async function loadProps(id: string, e: string | undefined): Promise<VerifyProps | null> {
  if (isSessionId(id)) {
    const { data: s } = await supabaseAdmin
      .from('plnolet_sessions').select('id, merchant_id, mode, threshold, status, method, return_url, expires_at, pass_issued').eq('id', id).maybeSingle()
    if (s) {
      const { data: m } = await supabaseAdmin.from('plnolet_merchants').select('name').eq('id', s.merchant_id).maybeSingle()
      const status = effectiveStatus(s, Date.now())
      const ret = new URL(s.return_url)
      return {
        id,
        shop: m?.name ?? ret.hostname,
        threshold: s.threshold,
        test: s.mode === 'test',
        status,
        method: s.method,
        offerPass: status === 'verified' && !s.pass_issued && s.method !== 'pass',
        // Real providers only on live sessions (a test session must never touch a real identity).
        providers: s.mode === 'live' || process.env.PLNOLET_PROVIDERS_IN_TEST === '1' ? providers(process.env).map((p) => ({ id: p.id, label: p.label })) : [],
        backUrl: returnTo(s.return_url, id, status),
        backOrigin: ret.origin,
        error: typeof e === 'string' ? e.slice(0, 20) : null,
      }
    }
  }
  return null
}

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const { id } = await params
  const { e } = await searchParams
  const props = await loadProps(id, e)
  return (
    <div className="pn">
      <PnTop links={false} />
      <main className="pn-verify">
        {props ? <VerifyClient {...props} /> : (
          <div className="pn-box">
            <h1>Odkaz neplatí</h1>
            <p>Tento odkaz na ověření věku neexistuje. Vraťte se prosím do obchodu a začněte znovu.</p>
          </div>
        )}
      </main>
      <PnFoot />
    </div>
  )
}
