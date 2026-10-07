import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin'
import { ChangelogAdmin, type ChangelogEntry } from './ChangelogAdmin'
import { StoreUpdatesAdmin } from './StoreUpdatesAdmin'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface AgencyUser {
  id: string
  tier: string
  subscription_status: string | null
  current_period_end: string | null
  project_limit: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export default async function AdminPage() {
  const { userId } = await auth()
  if (!userId) redirect('/login')

  // Shared gate: verified primary email in ADMIN_EMAILS (fails closed if unset).
  if (!(await requireAdmin())) redirect('/dashboard')

  const { data: agencyUsers } = await supabaseAdmin
    .from('users')
    .select('id, tier, subscription_status, current_period_end, project_limit, stripe_customer_id, stripe_subscription_id')
    .eq('tier', 'agency')
    .order('id')

  // Get project counts for each agency user
  const counts: Record<string, number> = {}
  if (agencyUsers && agencyUsers.length > 0) {
    const ids = (agencyUsers as AgencyUser[]).map((u) => u.id)
    for (const uid of ids) {
      const { count } = await supabaseAdmin
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .neq('status', 'archived')
      counts[uid] = count ?? 0
    }
  }

  const users = (agencyUsers ?? []) as AgencyUser[]

  const { data: changelogRows, error: changelogError } = await supabaseAdmin
    .from('changelog_entries')
    .select('id, date, title, description, tags, published, deployment_id')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)
  if (changelogError) console.error('[admin] changelog fetch failed:', changelogError)
  const changelogEntries = (changelogRows ?? []) as ChangelogEntry[]

  const statusColor: Record<string, string> = {
    active: 'var(--q-ok)',
    past_due: 'var(--q-warn)',
    canceled: 'var(--q-fg3)',
    trialing: 'var(--q-acc)',
  }

  return (
    <div style={{ padding: '1.5rem 1rem 3rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em' }}>Admin — Agency subscribers</h1>
        <span style={{
          fontSize: 11, fontFamily: 'var(--q-mono)', color: 'var(--q-fg4)',
          padding: '3px 8px', borderRadius: 5, background: 'rgb(var(--q-ink-rgb) / .05)',
          border: '1px solid rgb(var(--q-ink-rgb) / .08)',
        }}>
          {users.length} subscriber{users.length !== 1 ? 's' : ''}
        </span>
      </div>

      {users.length === 0 ? (
        <div style={{ borderRadius: 12, border: '1px dashed rgb(var(--q-ink-rgb) / .09)', padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--q-fg3)', margin: 0 }}>No agency subscribers yet.</p>
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: '1px solid rgb(var(--q-ink-rgb) / .07)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr', gap: 12, padding: '8px 18px', background: 'rgb(var(--q-ink-rgb) / .02)', borderBottom: '1px solid rgb(var(--q-ink-rgb) / .07)' }}>
            {['User ID', 'Status', 'Projects', 'Next billing', 'Subscription'].map((h, i) => (
              <p key={h} style={{ fontSize: 10, fontFamily: 'var(--q-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--q-fg4)', margin: 0, textAlign: i > 0 ? 'right' : 'left' }}>
                {h}
              </p>
            ))}
          </div>

          {users.map((u, idx) => (
            <div key={u.id} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr', gap: 12,
              padding: '12px 18px', alignItems: 'center',
              borderBottom: idx < users.length - 1 ? '1px solid rgb(var(--q-ink-rgb) / .04)' : 'none',
            }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--q-mono)', color: 'var(--q-fg3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.id}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'var(--q-mono)', fontWeight: 600, color: statusColor[u.subscription_status ?? ''] ?? 'var(--q-fg3)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {u.subscription_status ?? '—'}
              </span>
              <span style={{ fontSize: 13, fontFamily: 'var(--q-mono)', color: 'var(--q-fg)', textAlign: 'right' }}>
                {counts[u.id] ?? 0} / {u.project_limit}
              </span>
              <span style={{ fontSize: 12, color: 'var(--q-fg3)', textAlign: 'right' }}>
                {formatDate(u.current_period_end)}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'var(--q-mono)', color: 'var(--q-fg4)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.stripe_subscription_id ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <StoreUpdatesAdmin />

      <ChangelogAdmin entries={changelogEntries} />
    </div>
  )
}
