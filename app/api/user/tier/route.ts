import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const [record, countResult] = await Promise.all([
    getUserRecord(userId),
    supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'archived'),
  ])

  return NextResponse.json({
    tier: record.tier,
    subscription_status: record.subscription_status,
    current_period_end: record.current_period_end,
    project_limit: record.project_limit,
    project_count: countResult.count ?? 0,
    stripe_customer_id: record.stripe_customer_id,
  })
}
