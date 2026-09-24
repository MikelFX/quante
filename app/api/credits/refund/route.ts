import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { getDeploymentStatus } from '@/lib/hosting/vercel'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { MAX_AUTO_FIX_ATTEMPTS } from '@/lib/config'
import { refundCapped } from './capped'

// Refunds the generate/iterate debit for a code version whose deployment could
// not be repaired by the auto-fix loop.
//
// Security: this used to refund ANY past generate/iterate debit of the user as soon as the
// project's newest deployment was failed — so one deliberately broken iterate refunded
// every earlier (successful) generation. Now the refund is tied to the failure, and every
// condition is proven from server-written rows (never from the user-controlled prompt —
// iterate stores the raw instruction, so "Fix: …" can be typed by anyone):
//   1. versionId must be the project's newest PAID version. Every later version must be a
//      real auto-fix version: no debit of its own, not a generation, and created after an
//      executed /api/quante/fix attempt (quante_request_attempts, route 'fix', executed_at
//      set) on a deployment of the version before it — the fix route only executes after
//      verifying that build failed;
//   2. the auto-fix loop must actually have been exhausted by REAL fix outcomes: at least
//      MAX_AUTO_FIX_ATTEMPTS saved fix versions in the chain, each of whose builds failed
//      (proven by the next fix attempt / check 3 for the last one). Counting attempt rows
//      was gameable: a fix that "ran" but produced nothing (an unknown filePath, an
//      injected "emit no <file> block", a safety-rejected rewrite) cost the attacker
//      nothing, yet counted toward exhaustion (R2). The client-side gate is skippable;
//   3. the project's latest deployment must be failed AND be a build of the newest
//      version of that chain;
//   4. the debit must be recent (REFUND_WINDOW_MS) and the user under the daily cap
//      (credit_refund_claims, see ./capped.ts);
//   5. refund_debit refunds only that one debit, never more than was debited, idempotently.

const REFUND_REASON = 'generation_failed'
const REFUND_WINDOW_MS = 2 * 3_600_000
const FIX_PROMPT_PREFIX = 'Fix:'
// /api/quante/fix allows 5 trailing fix versions per paid version; anything longer is not
// a fix chain (and bounds the queries below).
const MAX_FIX_CHAIN = 10

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = rateLimit(`refund:${userId}`, 10, 3_600_000)
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many refund requests.' }, { status: 429 })
  }

  let versionId: unknown
  try {
    ({ versionId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!versionId) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  }
  if (!isUuid(versionId)) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  // Ownership: the version must be the caller's AND sit in a project the caller owns.
  const { data: version } = await supabaseAdmin
    .from('code_versions')
    .select('id, project_id, user_id, created_at')
    .eq('id', versionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  const project = await getOwnedProject(version.project_id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const serverError = () => NextResponse.json({ error: 'Refund failed.' }, { status: 500 })
  const notRefundable = (error: string) => NextResponse.json({ error }, { status: 403 })

  // 1. Everything newer than versionId has to be its fix chain.
  const { data: newer, error: newerError } = await supabaseAdmin
    .from('code_versions')
    .select('id, prompt, created_at')
    .eq('project_id', version.project_id)
    .gt('created_at', version.created_at)
    .order('created_at', { ascending: true })
    .limit(MAX_FIX_CHAIN + 1)
  if (newerError) {
    console.error('[refund] newer-version lookup failed:', newerError.message)
    return serverError()
  }
  const newerRows = (newer ?? []) as Array<{ id: string; prompt: string | null; created_at: string }>
  // Cheap pre-filter only — the prompt is user-controlled, the checks below are not.
  if (newerRows.length > MAX_FIX_CHAIN || newerRows.some((v) => !(v.prompt ?? '').startsWith(FIX_PROMPT_PREFIX))) {
    return notRefundable('Only the most recent change can be refunded.')
  }
  const chain = [
    { id: version.id as string, created_at: version.created_at as string },
    ...newerRows.map((v) => ({ id: v.id, created_at: v.created_at })),
  ]
  const chainVersionIds = chain.map((v) => v.id)

  // A newer version that carries its own debit is paid work (iterate / section), not a fix.
  if (newerRows.length > 0) {
    const { data: paidNewer, error: paidError } = await supabaseAdmin
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .lt('delta', 0)
      .in('ref_id', newerRows.map((v) => v.id))
      .limit(1)
    if (paidError) {
      console.error('[refund] newer-version debit lookup failed:', paidError.message)
      return serverError()
    }
    if ((paidNewer ?? []).length > 0) return notRefundable('Only the most recent change can be refunded.')

    // Generate debits are keyed by the generation job, not the version id, so a newer
    // generation whose brief starts with "Fix:" would pass the check above.
    const { data: genNewer, error: genError } = await supabaseAdmin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .in('code_version_id', newerRows.map((v) => v.id))
      .limit(1)
    if (genError) {
      console.error('[refund] newer-version generation lookup failed:', genError.message)
      return serverError()
    }
    if ((genNewer ?? []).length > 0) return notRefundable('Only the most recent change can be refunded.')
  }

  // 2 (cheap part). Exhaustion = real fix outcomes: MAX_AUTO_FIX_ATTEMPTS saved fix
  // versions. /api/quante/fix allows exactly that many per paid version.
  if (newerRows.length < MAX_AUTO_FIX_ATTEMPTS) {
    return notRefundable('Auto-fix has not been exhausted for this change.')
  }

  // Deployments of the chain and the fix attempts recorded against them.
  const { data: chainDeploys, error: deploysError } = await supabaseAdmin
    .from('deployments')
    .select('id, code_version_id')
    .eq('project_id', version.project_id)
    .in('code_version_id', chainVersionIds)
  if (deploysError) {
    console.error('[refund] chain deployment lookup failed:', deploysError.message)
    return serverError()
  }
  const deployRows = (chainDeploys ?? []) as Array<{ id: string; code_version_id: string }>
  let attemptRows: Array<{ ref_id: string; created_at: string }> = []
  if (deployRows.length > 0) {
    const deployIds = deployRows.map((d) => d.id)
    // Prefer attempts that actually ran (executed_at is set by /api/quante/fix after every
    // cap and the failed-build check passed, right before Claude is called).
    const executed = await supabaseAdmin
      .from('quante_request_attempts')
      .select('ref_id, created_at')
      .eq('user_id', userId)
      .eq('route', 'fix')
      .not('executed_at', 'is', null)
      .in('ref_id', deployIds)
    let attempts = executed.data as Array<{ ref_id: string; created_at: string }> | null
    if (executed.error) {
      // executed_at missing (migration-security3-quante-credits.sql not run yet): fall back
      // to all fix attempts. Safe — exhaustion is counted in saved fix versions (check 2),
      // which only an executed fix can create; the rows here only link each fix version to
      // its predecessor's failed build.
      console.error('[refund] executed fix-attempt lookup failed (run migration-security3-quante-credits.sql?):', executed.error.message)
      const all = await supabaseAdmin
        .from('quante_request_attempts')
        .select('ref_id, created_at')
        .eq('user_id', userId)
        .eq('route', 'fix')
        .in('ref_id', deployIds)
      if (all.error) {
        // Fail closed — without the attempt log nothing proves the fix loop ran.
        console.error('[refund] fix-attempt lookup failed:', all.error.message)
        return serverError()
      }
      attempts = all.data as Array<{ ref_id: string; created_at: string }> | null
    }
    attemptRows = attempts ?? []
  }

  // Each fix version must follow a server-recorded fix attempt on a (failed) deployment
  // of its predecessor — iterate/section versions typed as "Fix: …" have none. Together
  // with check 2 this means MAX_AUTO_FIX_ATTEMPTS real fixes were saved and every one of
  // them but the last was then proven to fail its build (the last: check 3).
  for (let i = 1; i < chain.length; i++) {
    const predecessorDeploys = new Set(
      deployRows.filter((d) => d.code_version_id === chain[i - 1].id).map((d) => d.id),
    )
    const createdMs = new Date(chain[i].created_at).getTime()
    const proven = attemptRows.some(
      (a) => predecessorDeploys.has(a.ref_id) && new Date(a.created_at).getTime() <= createdMs,
    )
    if (!proven) return notRefundable('Only the most recent change can be refunded.')
  }

  // 3. Server-side validation: the project's latest deployment must actually be failed,
  // and must be a build of the newest version of this chain (the last fix's outcome).
  const { data: latestDeploy } = await supabaseAdmin
    .from('deployments')
    .select('id, status, vercel_deployment_id, code_version_id')
    .eq('project_id', version.project_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestDeploy) {
    return NextResponse.json({ error: 'No deployment found.' }, { status: 409 })
  }
  if (latestDeploy.code_version_id !== chainVersionIds[chainVersionIds.length - 1]) {
    return NextResponse.json({ error: 'Latest deployment is not for this version.' }, { status: 409 })
  }

  let failed = latestDeploy.status === 'error' || latestDeploy.status === 'canceled'

  // DB may lag behind Vercel (SSE writes status async) — verify live before rejecting.
  if (!failed && latestDeploy.vercel_deployment_id) {
    try {
      const live = await getDeploymentStatus(latestDeploy.vercel_deployment_id)
      if (live.state === 'error' || live.state === 'canceled') {
        failed = true
        await supabaseAdmin
          .from('deployments')
          .update({ status: live.state, updated_at: new Date().toISOString() })
          .eq('id', latestDeploy.id)
      }
    } catch (err) {
      console.error('[refund] live status check failed:', err)
    }
  }

  if (!failed) {
    return NextResponse.json({ error: 'Latest deployment is not in a failed state.' }, { status: 409 })
  }

  // 4. Find the single debit that paid for this version. Generate debits are keyed by the
  // generation job id (mapped via generation_jobs.code_version_id); iterate debits and
  // legacy generate debits are keyed by the version id itself.
  const { data: jobs } = await supabaseAdmin
    .from('generation_jobs')
    .select('id')
    .eq('code_version_id', version.id)
    .eq('user_id', userId)
  const refCandidates = [version.id as string, ...((jobs ?? []) as Array<{ id: string }>).map((j) => j.id)]

  const { data: debit } = await supabaseAdmin
    .from('credit_ledger')
    .select('ref_id, reason, created_at')
    .eq('user_id', userId)
    .in('reason', ['generate', 'iterate'])
    .lt('delta', 0)
    .in('ref_id', refCandidates)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!debit) {
    // Nothing was debited for this version (e.g. agency user) — nothing to refund.
    return NextResponse.json({ ok: true, refunded: 0, no_debit: true })
  }
  if (Date.now() - new Date(debit.created_at as string).getTime() > REFUND_WINDOW_MS) {
    return notRefundable('This change is too old to be refunded.')
  }

  // 5. Refund exactly that debit — daily-capped, never more than was debited, idempotent.
  const result = await refundCapped(userId, debit.ref_id as string, debit.reason as string, REFUND_REASON)
  if (!result.ok) {
    if (result.reason === 'limit') {
      return NextResponse.json({ error: 'Daily refund limit reached.' }, { status: 429 })
    }
    return serverError()
  }

  return NextResponse.json({ ok: true, refunded: result.refunded, balance: result.balance })
}
