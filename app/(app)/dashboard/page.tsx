import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import Link from 'next/link'
import { DashboardGrid } from './DashboardGrid'
import { DashboardHeader } from './DashboardHeader'
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
  const isAgency = record.tier === 'agency' && record.subscription_status === 'active'

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
  const atLimit = activeCount >= record.project_limit
  const limitLabel = `${activeCount} / ${record.project_limit} active`

  return (
    <div className="q-page-wrap">

      <DashboardHeader atLimit={atLimit} limitLabel={limitLabel} />

      {verificationRequired && (
        <div role="status" style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', fontSize: 13, color: '#e0a04f' }}>
          Verify your email to receive your {CREDIT_COSTS.welcome_grant} free credits — then reload this page.
        </div>
      )}

      {/* At-limit warning */}
      {atLimit && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', fontSize: 13, color: '#e0a04f' }}>
          {isAgency
            ? <>You&apos;ve reached the Agency batch limit (20 simultaneous stores). <a href="mailto:support@quantecode.com" style={{ color: '#e0a04f' }}>Contact us for a custom plan.</a></>
            : <><Link href="/pricing" style={{ color: '#e0a04f' }}>Upgrade to Agency</Link> to generate &amp; export up to 20 stores at once.</>
          }
        </div>
      )}

      {/* Archived notice (shown after downgrade) */}
      {archived.length > 0 && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.03)', fontSize: 13, color: '#8a8a93' }}>
          {archived.length} project{archived.length > 1 ? 's' : ''} archived due to plan downgrade.{' '}
          <Link href="/billing" style={{ color: '#D4FF3F' }}>Reactivate your Agency plan</Link> to restore them.
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
