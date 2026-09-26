import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAgencyUser } from '@/lib/tier'
import { StudioClient } from './StudioClient'
import { Suspense } from 'react'
import { toStoreSlug } from '@/lib/store-template/build'
import { HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { getHostingGate } from '@/lib/hosting/gate'
import { getBalance } from '@/lib/credits'
import { isDraftPublishReady } from '@/lib/hosting/deployments'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StudioPage({ params }: Props) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const [projectResult, balance, hostingSubResult, latestDeploymentResult, codeVersionResult, agencyFlag, gate, draftPublishReady] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).eq('user_id', userId).single(),
    getBalance(userId),
    supabase.from('hosting_subscriptions').select('status, current_period_end, cancel_at_period_end')
      .eq('project_id', id).in('status', ['active', 'trialing']).maybeSingle(),
    supabase.from('deployments').select('id, vercel_deployment_id, status, url, target')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('code_versions').select('id')
      .eq('project_id', id).limit(1).maybeSingle(),
    isAgencyUser(userId),
    // Same gate every deploy path uses. Keyed only by project id (service-role), so its
    // result is used only after the owner-scoped project query above succeeded.
    getHostingGate(id),
    isDraftPublishReady(),
  ])

  if (projectResult.error || !projectResult.data) redirect('/dashboard')

  const project = projectResult.data

  // Paused = the store has been live but may not be on production now; the server then
  // deploys edits as true *.vercel.app previews, which the Studio must show as-is. On a
  // gate lookup failure pass nothing and let StudioClient fall back to its estimate.
  const hostingPaused = gate.reason === 'lookup_failed'
    ? undefined
    : gate.everLive && !gate.canDeployProduction
  // Audit R7: the free trial is once per user. For a never-live project whose owner
  // already used it, report the trial as ended so the Studio shows its existing
  // "trial ended → Subscribe" UI (it keys those buttons on trialEndsAt) instead of
  // promising a new 30-day trial that /api/deploy would refuse.
  // (StudioClient has no separate "never had a trial" state, so this reads "Free trial
  // ended" — the Subscribe buttons it renders are what matters.)
  const trialUsedElsewhere = !gate.everLive && gate.reason === 'trial_used'
  // Draft/publish (2026-09-26): chat edits of this live store are staged drafts, shown in
  // the preview by their own URL until the owner publishes them.
  const draftMode = gate.everLive && gate.canDeployProduction && draftPublishReady
  // An active Agency plan covers hosting for every store (getHostingGate allows them),
  // so present it like a hosting subscription: no trial countdown, no "trial ended →
  // subscribe" upsell, no "first deploy starts your trial" hint. Without this an Agency
  // owner's 2nd+ store — stamped "now" on its first deploy because the one free trial
  // was used elsewhere — would show "Free hosting trial ended" right after going live.
  const agencyCoversHosting = !!agencyFlag && !hostingSubResult.data
  const hostingInfo = {
    trialEndsAt: (project.hosting_trial_ends_at as string | null)
      ?? (trialUsedElsewhere ? new Date(0).toISOString() : null),
    subscribed: !!hostingSubResult.data || agencyCoversHosting,
    subscriptionEndsAt: hostingSubResult.data?.current_period_end ?? null,
    cancelAtPeriodEnd: hostingSubResult.data?.cancel_at_period_end ?? false,
    suspendedAt: (project.hosting_suspended_at as string | null) ?? null,
  }

  const latestDeploy = latestDeploymentResult.data
  const latestDeployment = latestDeploy
    ? {
        id: latestDeploy.vercel_deployment_id as string,
        status: latestDeploy.status as string,
        url: latestDeploy.url as string | null,
        target: (latestDeploy.target as string | null | undefined) ?? null,
      }
    : null

  const hasCodeVersion = !!codeVersionResult.data
  const isAgency = !!agencyFlag

  // The real subdomain is the project's permanently claimed, unique store_slug. Before
  // the first Push to Live it's still null, so fall back to the name-derived slug for
  // display only (the actual slug may get a -2/-3 suffix when claimed).
  const storedSlug = (project.store_slug as string | null | undefined) ?? null
  const slug = storedSlug || toStoreSlug(project.name)
  const storeUrl = (slug && hasCodeVersion) ? `https://${slug}.${HOSTING_ROOT_DOMAIN}` : null

  return (
    <Suspense fallback={null}>
      <StudioClient
        projectId={id}
        projectName={project.name}
        storeUrl={storeUrl}
        initialBalance={balance}
        hostingInfo={hostingInfo}
        latestDeployment={latestDeployment}
        hasCodeVersion={hasCodeVersion}
        isAgency={isAgency}
        hostingPaused={hostingPaused}
        draftMode={draftMode}
      />
    </Suspense>
  )
}
