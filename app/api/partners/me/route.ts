// GET /api/partners/me
// Returns the calling user's partner account (if any), the projects assigned to it, and
// a recent slice of the commission ledger + running balance. Read-only.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: partner } = await supabaseAdmin
    .from('partners')
    .select('id, company_name, contact_email, referral_code, commission_rate_bps, status, created_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!partner) return Response.json({ partner: null })

  const [projectsResult, ledgerResult] = await Promise.all([
    supabaseAdmin
      .from('partner_projects')
      .select('project_id, assigned_at, status, projects(name)')
      .eq('partner_id', partner.id)
      .eq('status', 'active'),
    supabaseAdmin
      .from('partner_commission_ledger')
      .select('id, project_id, delta_cents, currency, reason, status, balance_after_cents, created_at')
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const balanceCents = ledgerResult.data?.[0]?.balance_after_cents ?? 0

  return Response.json({
    partner,
    projects: projectsResult.data ?? [],
    ledger: ledgerResult.data ?? [],
    balanceCents,
  })
}
