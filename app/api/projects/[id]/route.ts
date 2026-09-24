import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { getOwnedProject } from '@/lib/auth/project'
import { removeProject, HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { getPayoutBalances } from '@/lib/payments/earnings'
import { stripe, isStripeConfigured } from '@/lib/stripe'

// Mirrors MIN_PAYOUT_CENTS in /api/payout/request — a balance the owner can still
// withdraw must not be stranded by deleting the project.
const MIN_PAYOUT_CENTS = 500

// Stripe statuses that can still bill or be revived.
const LIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ROW_PAGE = 1000

// DELETE /api/projects/[id]
//
// SECURITY (audit #37): deleting used to wipe DB rows only — the Vercel project and
// its domains stayed live forever for free (the hosting cron works from the projects
// table), the Stripe hosting subscription kept billing, and earnings/payout history
// was cascade-deleted. Now, in order, and aborting before any DB change on failure:
//   1. refuse while a payout is in progress or any currency still has a withdrawable
//      (settled or held) balance;
//   2. cancel live Stripe hosting subscriptions;
//   3. take the store offline: remove the Vercel project, or — when a legacy row
//      shares that Vercel project with another Quante project — detach this project's
//      own domains from it;
//   4. projects with financial history, or that ever had a public store host, are
//      soft-deleted (tombstoned) so orders, earnings, payouts and hosting
//      subscriptions survive for audit and the store slug stays reserved; others are
//      hard-deleted as before.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const project = await getOwnedProject<{
    id: string
    vercel_project_id: string | null
    custom_domain: string | null
    hosting_trial_ends_at: string | null
  }>(id, userId, 'id, vercel_project_id, custom_domain, hosting_trial_ends_at')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const serverError = () =>
    NextResponse.json({ error: 'Could not delete project right now. Please try again.' }, { status: 500 })

  // ── 1. Payout guard ──────────────────────────────────────────────────────────
  const [earningsRes, payoutsRes, ordersRes, subsRes] = await Promise.all([
    supabaseAdmin.from('store_earnings').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabaseAdmin.from('payout_requests').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabaseAdmin.from('store_orders').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabaseAdmin.from('hosting_subscriptions').select('id, stripe_subscription_id, status').eq('project_id', id),
  ])
  if (earningsRes.error || payoutsRes.error || ordersRes.error || subsRes.error) {
    console.error('[projects/delete] pre-delete lookup failed:', {
      earnings: earningsRes.error?.message,
      payouts: payoutsRes.error?.message,
      orders: ordersRes.error?.message,
      subs: subsRes.error?.message,
    })
    return serverError()
  }
  const subs = subsRes.data ?? []

  // Per-currency and fully paginated (getPayoutBalances): summing currencies used to
  // block multi-currency stores whose individual balances are all below the payout
  // minimum, and the unpaginated query under-counted stores with >1000 earnings rows.
  let balances: Awaited<ReturnType<typeof getPayoutBalances>>
  try {
    balances = await getPayoutBalances(id)
  } catch (err) {
    console.error('[projects/delete] payout balance lookup failed:', err)
    return serverError()
  }
  const allBalances = [...balances.values()]
  if (allBalances.some((b) => b.pendingPayoutCents > 0)) {
    return NextResponse.json(
      { error: 'This store has a payout in progress. You can delete it once the payout is completed.' },
      { status: 409 },
    )
  }
  // Held (still inside the refund window) earnings count too — they become
  // withdrawable later and the owner could no longer reach them after deletion.
  if (allBalances.some((b) => b.settledNetCents + b.heldCents - b.pendingPayoutCents - b.paidOutCents >= MIN_PAYOUT_CENTS)) {
    return NextResponse.json(
      { error: 'This store still has earnings you can withdraw. Request a payout before deleting it.' },
      { status: 409 },
    )
  }

  // Everything that identifies this store publicly — read before any row is removed.
  let storeSlug: string | null
  let ownDomains: string[]
  let legacySlug: string | null
  try {
    storeSlug = await readStoreSlug(id)
    const deployDomains = await readDeploymentDomains(id)
    legacySlug = deployDomains
      .map(subdomainLabel)
      .find((label): label is string => !!label) ?? null
    ownDomains = await collectOwnDomains(id, storeSlug, project.custom_domain, deployDomains)
  } catch (err) {
    console.error('[projects/delete] domain lookup failed:', err)
    return serverError()
  }

  // ── 2. Cancel live hosting subscriptions ────────────────────────────────────
  const liveSubs = subs.filter((s) => LIVE_SUB_STATUSES.includes(s.status as string))
  if (liveSubs.length > 0) {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'This store has an active hosting subscription. Cancel it before deleting the project.' },
        { status: 409 },
      )
    }
    for (const sub of liveSubs) {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id as string, { prorate: true })
      } catch (err) {
        const code = (err as { code?: string }).code
        // Already gone on Stripe's side — nothing left to cancel.
        if (code !== 'resource_missing') {
          console.error('[projects/delete] failed to cancel hosting subscription:', sub.id, err)
          return NextResponse.json(
            { error: 'Could not cancel the hosting subscription. Nothing was deleted — please try again.' },
            { status: 502 },
          )
        }
      }
      await supabaseAdmin
        .from('hosting_subscriptions')
        .update({ status: 'canceled', cancel_at_period_end: false })
        .eq('id', sub.id)
    }
  }

  // ── 3. Take the store offline on Vercel ─────────────────────────────────────
  if (project.vercel_project_id) {
    const vercelProjectId = project.vercel_project_id
    // Legacy rows from the old name-based lookup can share one Vercel project across
    // tenants — never tear down a project another Quante project still points at.
    const { data: sharers, error: shareErr } = await supabaseAdmin
      .from('projects')
      .select('id, custom_domain')
      .eq('vercel_project_id', vercelProjectId)
      .neq('id', id)
    if (shareErr) {
      console.error('[projects/delete] shared Vercel project check failed:', shareErr)
      return serverError()
    }

    if (sharers && sharers.length > 0) {
      console.error(
        `[projects/delete] SECURITY: Vercel project ${vercelProjectId} is shared with ${sharers.length} other project(s) — detaching only ${id}'s own domains; migrate manually`,
      )
      // Detach every host only this project claims. Hosts a surviving sharer also
      // claims stay attached: they remain governed by that project's hosting
      // lifecycle (its subscription / the hosting cron), so nothing is left untracked.
      let toDetach: string[]
      try {
        const claimedBySharers = await domainsClaimedBy(
          sharers as Array<{ id: string; custom_domain: string | null }>,
          ownDomains,
        )
        toDetach = ownDomains.filter((d) => !claimedBySharers.has(d))
      } catch (err) {
        console.error('[projects/delete] shared-domain lookup failed:', err)
        return serverError()
      }
      for (const domain of toDetach) {
        try {
          await detachVercelDomain(vercelProjectId, domain)
        } catch (err) {
          console.error(`[projects/delete] failed to detach ${domain} from ${vercelProjectId}:`, err)
          return NextResponse.json(
            { error: 'Could not take the store offline. Nothing was deleted — please try again.' },
            { status: 502 },
          )
        }
      }
    } else {
      try {
        // Deleting the Vercel project also detaches every domain assigned to it.
        await removeProject(vercelProjectId)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status !== 404) {
          console.error('[projects/delete] removeProject failed:', err)
          return NextResponse.json(
            { error: 'Could not take the store offline. Nothing was deleted — please try again.' },
            { status: 502 },
          )
        }
      }
    }
  }

  // ── 4. Database ─────────────────────────────────────────────────────────────
  const hasFinancialHistory =
    (earningsRes.count ?? 0) > 0 || (payoutsRes.count ?? 0) > 0 || (ordersRes.count ?? 0) > 0 || subs.length > 0
  // A project that ever had a public store host keeps a tombstone so its
  // <slug>.stores subdomain is never handed to another tenant (customers, links and
  // bookmarks of the old store would land on a different merchant).
  const everPublic = !!storeSlug || !!legacySlug || !!project.hosting_trial_ends_at
  const keepTombstone = hasFinancialHistory || everPublic

  // Legacy stores never got store_slug backfilled — reserve the subdomain they were
  // actually served on before their deployment rows (the only record of it) go away.
  if (keepTombstone && !storeSlug && legacySlug) {
    const { error: reserveErr } = await supabaseAdmin
      .from('projects')
      .update({ store_slug: legacySlug })
      .eq('id', id)
      .is('store_slug', null)
    if (reserveErr) console.warn('[projects/delete] could not reserve legacy store slug:', reserveErr.message)
  }

  // Non-financial data is removed either way. project_secrets goes first so the
  // store's QUANTE_API_KEY stops working immediately.
  const childDeletes = await Promise.all([
    supabaseAdmin.from('project_secrets').delete().eq('project_id', id),
    supabaseAdmin.from('deployments').delete().eq('project_id', id),
    supabaseAdmin.from('code_versions').delete().eq('project_id', id),
    supabaseAdmin.from('manifest_versions').delete().eq('project_id', id),
    supabaseAdmin.from('store_inventory').delete().eq('project_id', id),
    supabaseAdmin.from('custom_components').delete().eq('project_id', id),
    supabaseAdmin.from('exports').delete().eq('project_id', id),
    // Unlink domains but keep the registration record (user still owns the domain)
    supabaseAdmin.from('user_domains').update({ project_id: null }).eq('project_id', id),
  ])
  const childErr = childDeletes.find((r) => r.error)?.error
  if (childErr) {
    console.error('[projects/delete] child cleanup failed:', childErr)
    return NextResponse.json({ error: 'Failed to delete project data. Please try again.' }, { status: 500 })
  }

  if (keepTombstone) {
    // Soft delete: the FKs cascade, so a hard delete would wipe orders, earnings,
    // payouts and hosting subscriptions. Tombstoning user_id removes the project from
    // every `.eq('user_id', userId)` query (dashboard, Studio, APIs) while the owner
    // stays recoverable from the tombstone for audit. store_slug is deliberately kept
    // so the subdomain stays reserved (getOrClaimStoreSlug skips held slugs).
    const { error: softErr } = await supabaseAdmin
      .from('projects')
      .update({
        user_id: `deleted:${userId}`,
        status: 'deleted',
        vercel_project_id: null,
        custom_domain: null,
        hosting_suspended_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
    if (softErr) {
      console.error('[projects/delete] soft delete failed:', softErr)
      return NextResponse.json({ error: 'Failed to delete project.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  const remaining = await Promise.all([
    supabaseAdmin.from('store_payout_accounts').delete().eq('project_id', id),
    supabaseAdmin.from('hosting_subscriptions').delete().eq('project_id', id),
  ])
  const remErr = remaining.find((r) => r.error)?.error
  if (remErr) {
    console.error('[projects/delete] cleanup failed:', remErr)
    return NextResponse.json({ error: 'Failed to delete project data. Please try again.' }, { status: 500 })
  }

  const { error: delErr } = await supabaseAdmin.from('projects').delete().eq('id', id).eq('user_id', userId)
  if (delErr) {
    console.error('[projects/delete] project delete failed:', delErr)
    return NextResponse.json({ error: 'Failed to delete project.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')
  return HOSTNAME_RE.test(host) ? host : null
}

// '<label>.<HOSTING_ROOT_DOMAIN>' → '<label>' when it is a valid single DNS label.
function subdomainLabel(host: string): string | null {
  const suffix = `.${HOSTING_ROOT_DOMAIN.toLowerCase()}`
  if (!host.endsWith(suffix)) return null
  const label = host.slice(0, -suffix.length)
  return DNS_LABEL_RE.test(label) ? label : null
}

// projects.store_slug comes from migration-security-foundation.sql; tolerate its absence.
async function readStoreSlug(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('projects').select('store_slug').eq('id', projectId).maybeSingle()
  if (error) {
    console.warn('[projects/delete] store_slug lookup failed:', error.message)
    return null
  }
  const slug = (data as { store_slug?: string | null } | null)?.store_slug
  return typeof slug === 'string' && DNS_LABEL_RE.test(slug) ? slug : null
}

// Every distinct host this project's deployments were served on (legacy subdomains
// renamed with the brand included). Paginated so no host is missed.
async function readDeploymentDomains(projectId: string): Promise<string[]> {
  const out = new Set<string>()
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await supabaseAdmin
      .from('deployments')
      .select('domain')
      .eq('project_id', projectId)
      .not('domain', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + ROW_PAGE - 1)
    if (error) throw new Error(`deployments: ${error.message}`)
    const rows = (data ?? []) as Array<{ domain: string | null }>
    for (const r of rows) {
      const host = normalizeHost(r.domain)
      if (host) out.add(host)
    }
    if (rows.length < ROW_PAGE) return [...out]
  }
}

async function collectOwnDomains(
  projectId: string,
  storeSlug: string | null,
  customDomain: string | null,
  deployDomains: string[],
): Promise<string[]> {
  const out = new Set<string>(deployDomains)
  if (storeSlug) out.add(`${storeSlug}.${HOSTING_ROOT_DOMAIN}`.toLowerCase())

  const addWithWww = (value: unknown) => {
    const host = normalizeHost(value)
    if (!host) return
    out.add(host)
    if (!host.startsWith('www.')) out.add(`www.${host}`)
  }
  addWithWww(customDomain)

  const { data, error } = await supabaseAdmin.from('user_domains').select('domain').eq('project_id', projectId)
  if (error) throw new Error(`user_domains: ${error.message}`)
  for (const r of (data ?? []) as Array<{ domain: string | null }>) addWithWww(r.domain)

  return [...out]
}

// Which of `candidates` a sharing project also claims (store_slug host, custom domain,
// a connected user_domains row, or a deployment served on it).
async function domainsClaimedBy(
  sharers: Array<{ id: string; custom_domain: string | null }>,
  candidates: string[],
): Promise<Set<string>> {
  const claimed = new Set<string>()
  if (candidates.length === 0) return claimed
  const candidateSet = new Set(candidates)
  const mark = (value: unknown) => {
    const host = normalizeHost(value)
    if (!host) return
    for (const h of [host, host.startsWith('www.') ? host.slice(4) : `www.${host}`]) {
      if (candidateSet.has(h)) claimed.add(h)
    }
  }

  for (let i = 0; i < sharers.length; i += 100) {
    const batch = sharers.slice(i, i + 100)
    const ids = batch.map((s) => s.id)
    for (const s of batch) mark(s.custom_domain)

    const { data: slugs, error: slugErr } = await supabaseAdmin.from('projects').select('store_slug').in('id', ids)
    if (!slugErr) {
      for (const r of (slugs ?? []) as Array<{ store_slug?: string | null }>) {
        if (r.store_slug) mark(`${r.store_slug}.${HOSTING_ROOT_DOMAIN}`)
      }
    }

    const { data: ud, error: udErr } = await supabaseAdmin
      .from('user_domains')
      .select('domain')
      .in('project_id', ids)
    if (udErr) throw new Error(`user_domains (sharers): ${udErr.message}`)
    for (const r of (ud ?? []) as Array<{ domain: string | null }>) mark(r.domain)

    for (const domain of candidates) {
      if (claimed.has(domain)) continue
      const { data: dep, error: depErr } = await supabaseAdmin
        .from('deployments')
        .select('id')
        .in('project_id', ids)
        .eq('domain', domain)
        .limit(1)
      if (depErr) throw new Error(`deployments (sharers): ${depErr.message}`)
      if (dep && dep.length > 0) claimed.add(domain)
    }
  }
  return claimed
}

// DELETE /v9/projects/{id}/domains/{domain}. 404 = not (or no longer) on that project.
// Fails closed without VERCEL_TOKEN so the caller aborts before touching the DB.
async function detachVercelDomain(vercelProjectId: string, domain: string): Promise<void> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not configured')
  const teamId = process.env.VERCEL_TEAM_ID
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(domain)}${qs}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  if (res.ok || res.status === 404) return
  const body = await res.text().catch(() => '')
  throw new Error(`Vercel API ${res.status} removing ${domain}: ${body.slice(0, 300)}`)
}
