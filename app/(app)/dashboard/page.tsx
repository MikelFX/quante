// The dashboard = Grideet, the account's workspace (CLAUDE.md §13h): everything the user made,
// grouped by brand (store), each card leading on into a module. Shown to users as "Dashboard"
// (owner 2026-10-28). Everything the old project list had stays: batch banner, project limit, Agency bulk
// export, delete, archived notice, welcome-credit notice.
import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import { getUserRecord, hasAgencyPlan } from '@/lib/tier'
import { AGENCY_BATCH_SIZE, CREDIT_COSTS } from '@/lib/config'
import { createClient } from '@/lib/supabase/server'
import { loadGrideet } from '@/lib/grideet/load'
import { parseFilters } from '@/lib/grideet/model'
// Shared one-time welcome grant (atomic RPC, verified accounts only).
import { ensureWelcomeGrant } from '@/app/api/credits/welcome-grant'
import { BatchBanner } from './BatchBanner'
import { GrideetEmpty } from './GrideetEmpty'
import { GrideetClient } from './GrideetClient'
import './grideet.css'

export const metadata = { title: 'Dashboard · Quante' }

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function GrideetPage({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) return null

  const record = await getUserRecord(userId)
  const isAgency = hasAgencyPlan(record)

  // Welcome credits wait for a verified email — surface that instead of a silent 0 balance.
  let verificationRequired = false
  if (!isAgency) {
    const grant = await ensureWelcomeGrant(userId)
    verificationRequired = grant.status === 'verification_required'
  }

  const filters = parseFilters(await searchParams)
  const supabase = await createClient()
  const [data, archivedResult] = await Promise.all([
    loadGrideet(userId, filters),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'archived'),
  ])
  const archived = archivedResult.count ?? 0

  const activeCount = data.storeCount
  // Agency has no project limit (lib/tier.ts).
  const atLimit = !isAgency && activeCount >= record.project_limit
  const limitLabel = isAgency ? `${activeCount} stores · no limit` : `${activeCount} / ${record.project_limit} stores`
  const empty = data.brandCount === 0

  return (
    <div className="q-page-wrap gd-wrap">
      <header className="gd-head">
        <div>
          <p className="ad-app-label" style={{ padding: '0 0 12px' }}>workspace</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="q-h1">Dashboard</h1>
            <span className={`gd-limit${atLimit ? ' gd-limit-warn' : ''}`}>{limitLabel}</span>
          </div>
          <p className="gd-sub">Your stores and everything made for them, in one place.</p>
        </div>
        {!empty && (
          <div className="gd-head-actions">
            {isAgency && <Link href="/new/batch" className="q-btn q-btn-gl">Batch · up to {AGENCY_BATCH_SIZE}</Link>}
            <Link href="/qads" className="q-btn q-btn-gl">Make an ad</Link>
            <Link href="/qscan" className="q-btn q-btn-gl">Import a store</Link>
            {!atLimit && <Link href="/new" className="q-btn">+ New store</Link>}
          </div>
        )}
      </header>

      {isAgency && <BatchBanner />}

      {verificationRequired && (
        <div role="status" className="gd-note gd-note-warn">
          Verify your email to receive your {CREDIT_COSTS.welcome_grant} free credits — then reload this page.
        </div>
      )}

      {atLimit && (
        <div className="gd-note gd-note-warn">
          You have reached your store limit. <Link href="/billing#agency">Upgrade to Agency</Link> for unlimited stores.
        </div>
      )}

      {archived > 0 && (
        <div className="gd-note">
          {archived} store{archived > 1 ? 's' : ''} archived due to plan downgrade.{' '}
          <Link href="/billing">Reactivate your Agency plan</Link> to restore them.
        </div>
      )}

      {empty ? (
        <GrideetEmpty />
      ) : (
        <GrideetClient
          groups={data.groups}
          page={data.page}
          pages={data.pages}
          total={data.total}
          filters={filters}
          isAgency={isAgency}
          capped={data.capped}
          skipped={data.skipped}
          stores={data.stores}
          brandKitReady={data.brandKitReady}
        />
      )}
    </div>
  )
}
