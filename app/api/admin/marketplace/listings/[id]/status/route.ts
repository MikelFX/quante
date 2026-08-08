// POST /api/admin/marketplace/listings/[id]/status   { status: 'listed' | 'rejected' | 'delisted' | 'pending' }
// Admin-only review gate, same ADMIN_EMAILS pattern as app/api/admin/partners/[id]/status/route.ts
// and app/api/admin/changelog/route.ts. Required before any unvalidated component or
// starter_store listing becomes purchasable — see migration-marketplace.sql.

import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

async function requireAdmin(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? ''
  return ADMIN_EMAILS.includes(email) ? userId : null
}

const VALID_STATUSES = ['pending', 'listed', 'delisted', 'rejected']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
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
