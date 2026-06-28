import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import Link from 'next/link'
import { DashboardGrid } from './DashboardGrid'
import { DashboardHeader } from './DashboardHeader'
import { DashboardEmptyState } from './DashboardEmptyState'

async function ensureWelcomeGrant(userId: string, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('credit_ledger').select('id').eq('user_id', userId).limit(1).maybeSingle()
  if (!data) {
    await supabase.from('credit_ledger').insert({
      user_id: userId, delta: 25, reason: 'welcome_grant', ref_id: null, balance_after: 25,
    })
  }
}

export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()
  const record = await getUserRecord(userId)
  const isAgency = record.tier === 'agency' && record.subscription_status === 'active'

  if (!isAgency) {
    await ensureWelcomeGrant(userId, supabase)
  }

  const [projectsResult, archivedResult, ledgerResult] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', userId)
      .neq('status', 'archived').order('updated_at', { ascending: false }),
    supabase.from('projects').select('id, name').eq('user_id', userId).eq('status', 'archived'),
    supabase.from('credit_ledger').select('balance_after')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const projects = projectsResult.data ?? []
  const archived = archivedResult.data ?? []
  const creditBalance = ledgerResult.data?.balance_after ?? 0
  const activeCount = projects.length
  const atLimit = activeCount >= record.project_limit
  const limitLabel = `${activeCount} / ${record.project_limit} active`

  return (
    <div style={{ padding: '2rem 1.5rem 3rem', maxWidth: 1100, margin: '0 auto' }}>

      <DashboardHeader atLimit={atLimit} limitLabel={limitLabel} />

      {/* At-limit warning */}
      {atLimit && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', fontSize: 13, color: '#e0a04f' }}>
          {isAgency
            ? <>You&apos;ve reached the Agency batch limit (20 simultaneous stores). <a href="mailto:support@quante.io" style={{ color: '#e0a04f' }}>Contact us for a custom plan.</a></>
            : <><Link href="/pricing" style={{ color: '#e0a04f' }}>Upgrade to Agency</Link> to generate &amp; export up to 20 stores at once.</>
          }
        </div>
      )}

      {/* Archived notice (shown after downgrade) */}
      {archived.length > 0 && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.03)', fontSize: 13, color: '#8a8a93' }}>
          {archived.length} project{archived.length > 1 ? 's' : ''} archived due to plan downgrade.{' '}
          <Link href="/billing" style={{ color: '#6f78e6' }}>Reactivate your Agency plan</Link> to restore them.
        </div>
      )}

      {projects.length === 0 ? (
        <DashboardEmptyState />
      ) : (
        <DashboardGrid
          projects={projects}
          isAgency={isAgency}
          exportCostPerProject={CREDIT_COSTS.export}
          creditBalance={creditBalance}
        />
      )}
    </div>
  )
}
