import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord, hasAgencyPlan } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import Link from 'next/link'
import { DashboardGrid } from './DashboardGrid'
import { DashboardHeader } from './DashboardHeader'
import { BatchBanner } from './BatchBanner'
import { DashboardEmptyState } from './DashboardEmptyState'
// Shared one-time welcome grant (atomic RPC, verified accounts only). The old inline
// read-then-insert here raced with /api/credits/balance and could grant twice.
import { ensureWelcomeGrant } from '@/app/api/credits/welcome-grant'
import { getBalance } from '@/lib/credits'

export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()
  const record = await getUserRecord(userId)
  const isAgency = hasAgencyPlan(record)

  // Welcome credits wait for a verified email — surface that instead of a silent 0 balance.
  let verificationRequired = false
  if (!isAgency) {
    const grant = await ensureWelcomeGrant(userId)
    verificationRequired = grant.status === 'verification_required'
  }

  const [projectsResult, archivedResult, creditBalance] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', userId)
      .neq('status', 'archived').order('updated_at', { ascending: false }),
    supabase.from('projects').select('id, name').eq('user_id', userId).eq('status', 'archived'),
    getBalance(userId), // latest ledger row by seq, not created_at
  ])

  const projects = projectsResult.data ?? []
  const archived = archivedResult.data ?? []
  const activeCount = projects.length
  // Agency has no project limit (lib/tier.ts).
  const atLimit = !isAgency && activeCount >= record.project_limit
  const limitLabel = isAgency ? `${activeCount} active · no limit` : `${activeCount} / ${record.project_limit} active`

  return (
    <div className="q-page-wrap">

      <DashboardHeader atLimit={atLimit} limitLabel={limitLabel} batch={isAgency} />

      {isAgency && <BatchBanner />}

      {verificationRequired && (
        <div role="status" style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgb(var(--q-warn-rgb) / .2)', background: 'rgb(var(--q-warn-rgb) / .05)', fontSize: 13, color: 'var(--q-warn-text)' }}>
          Verify your email to receive your {CREDIT_COSTS.welcome_grant} free credits — then reload this page.
        </div>
      )}

      {/* At-limit warning */}
      {atLimit && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgb(var(--q-warn-rgb) / .2)', background: 'rgb(var(--q-warn-rgb) / .05)', fontSize: 13, color: 'var(--q-warn-text)' }}>
          <Link href="/billing#agency" style={{ color: 'var(--q-warn-text)' }}>Upgrade to Agency</Link> for unlimited stores.
        </div>
      )}

      {/* Archived notice (shown after downgrade) */}
      {archived.length > 0 && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgb(var(--q-ink-rgb) / .07)', background: 'rgb(var(--q-ink-rgb) / .03)', fontSize: 13, color: 'var(--q-fg3)' }}>
          {archived.length} project{archived.length > 1 ? 's' : ''} archived due to plan downgrade.{' '}
          <Link href="/billing" style={{ color: 'var(--q-acc-text)' }}>Reactivate your Agency plan</Link> to restore them.
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
