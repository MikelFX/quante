import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import Link from 'next/link'
import { DashboardGrid } from './DashboardGrid'

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
  const limitLabel = `${activeCount} / ${record.project_limit} projects`

  return (
    <div style={{ padding: '1.5rem 1rem', maxWidth: 680, margin: '0 auto' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em' }}>Projects</h1>
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-geist-mono)',
            color: atLimit ? '#e0a04f' : '#5b5b64',
            background: atLimit ? 'rgba(224,160,79,.08)' : 'transparent',
            border: atLimit ? '1px solid rgba(224,160,79,.2)' : '1px solid transparent',
            padding: '2px 7px', borderRadius: 5,
          }}>
            {limitLabel}
          </span>
        </div>
        {!atLimit && (
          <Link href="/new" style={{
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.45rem 1rem', borderRadius: 7,
            letterSpacing: '-.005em',
          }}>
            + New project
          </Link>
        )}
      </div>

      {/* At-limit warning */}
      {atLimit && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', fontSize: 13, color: '#e0a04f' }}>
          {isAgency
            ? <>You&apos;ve reached the 20-project Agency limit. <a href="mailto:support@quante.io" style={{ color: '#e0a04f' }}>Contact us for a custom plan.</a></>
            : <><Link href="/pricing" style={{ color: '#e0a04f' }}>Upgrade to Agency</Link> for up to 20 projects.</>
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
        <div style={{ border: '1px dashed rgba(255,255,255,.1)', borderRadius: 14, padding: '4rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: .4 }}>◻</div>
          <p style={{ fontSize: 14, color: 'var(--foreground)', fontWeight: 500, marginBottom: 6 }}>No projects yet</p>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 20, maxWidth: 280, margin: '0 auto 20px' }}>
            Describe a store and Quante builds it in seconds.
          </p>
          <Link href="/new" style={{
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.6rem 1.4rem', borderRadius: 8, display: 'inline-block',
          }}>
            Build your first store
          </Link>
        </div>
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
