import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StudioClient } from './StudioClient'
import type { ShopManifest } from '@/types/manifest'
import { Suspense } from 'react'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StudioPage({ params }: Props) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const [projectResult, manifestResult, ledgerResult, hostingSubResult] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).eq('user_id', userId).single(),
    supabase.from('manifest_versions').select('manifest').eq('project_id', id)
      .order('version_no', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('credit_ledger').select('balance_after').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('hosting_subscriptions').select('status, current_period_end, cancel_at_period_end')
      .eq('project_id', id).in('status', ['active', 'trialing']).maybeSingle(),
  ])

  if (projectResult.error || !projectResult.data) redirect('/dashboard')

  const project = projectResult.data
  const manifest = (manifestResult.data?.manifest ?? null) as ShopManifest | null
  const balance = ledgerResult.data?.balance_after ?? 0
  const hostingInfo = {
    trialEndsAt: (project.hosting_trial_ends_at as string | null) ?? null,
    subscribed: !!hostingSubResult.data,
    subscriptionEndsAt: hostingSubResult.data?.current_period_end ?? null,
    cancelAtPeriodEnd: hostingSubResult.data?.cancel_at_period_end ?? false,
  }

  return (
    <Suspense fallback={null}>
      <StudioClient
        projectId={id}
        projectName={project.name}
        initialManifest={manifest}
        initialBalance={balance}
        hostingInfo={hostingInfo}
      />
    </Suspense>
  )
}
