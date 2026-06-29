import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Ownership check via user-scoped client
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Delete all child records before removing the project (avoid FK violations)
  await Promise.all([
    supabaseAdmin.from('deployments').delete().eq('project_id', id),
    supabaseAdmin.from('code_versions').delete().eq('project_id', id),
    supabaseAdmin.from('manifest_versions').delete().eq('project_id', id),
    supabaseAdmin.from('store_orders').delete().eq('project_id', id),
    supabaseAdmin.from('store_earnings').delete().eq('project_id', id),
    supabaseAdmin.from('store_inventory').delete().eq('project_id', id),
    supabaseAdmin.from('custom_components').delete().eq('project_id', id),
    supabaseAdmin.from('exports').delete().eq('project_id', id),
    supabaseAdmin.from('payout_requests').delete().eq('project_id', id),
    supabaseAdmin.from('store_payout_accounts').delete().eq('project_id', id),
    supabaseAdmin.from('project_secrets').delete().eq('project_id', id),
    supabaseAdmin.from('hosting_subscriptions').delete().eq('project_id', id),
    // Unlink domains but keep the registration record (user still owns the domain)
    supabaseAdmin.from('user_domains').update({ project_id: null }).eq('project_id', id),
  ])

  await supabaseAdmin.from('projects').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
