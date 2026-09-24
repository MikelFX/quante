// POST /api/admin/marketplace/listings/[id]/status   { status: 'listed' | 'rejected' | 'delisted' | 'pending' }
// Admin-only review gate (shared requireAdmin() in lib/admin.ts — verified primary email
// in ADMIN_EMAILS). Required before any unvalidated component, paid listing or
// starter_store listing becomes visible — see migration-marketplace.sql.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin'
import { isUuid } from '@/lib/auth/project'

const VALID_STATUSES = ['pending', 'listed', 'delisted', 'rejected']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Listing not found' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const status = body.status

  if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('marketplace_listings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title, status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Listing not found' }, { status: 404 })

  return Response.json({ listing: data })
}
