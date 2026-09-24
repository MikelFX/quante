// POST /api/admin/partners/[id]/status   { status: 'active' | 'suspended' | 'pending' }
// Admin-only gate for approving/suspending partner accounts (shared requireAdmin() in
// lib/admin.ts — verified primary email in ADMIN_EMAILS).
// This never touches money — it only flips whether a partner's commission accrual is live
// (getActivePartnerForProject() in lib/partner-commission.ts checks partners.status).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin'
import { isUuid } from '@/lib/auth/project'

const VALID_STATUSES = ['pending', 'active', 'suspended']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Partner not found' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const status = body.status

  if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('partners')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, company_name, status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Partner not found' }, { status: 404 })

  return Response.json({ partner: data })
}
