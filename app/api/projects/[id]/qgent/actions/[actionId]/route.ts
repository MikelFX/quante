// POST /api/projects/[id]/qgent/actions/[actionId] { op, confirmSensitive? } — the merchant's
// decision on one Qgent proposal. Every step is logged on the qgent_actions row.
//   apply   → re-applies the edits to the CURRENT draft (a stale proposal is refused), checks
//             them with the store-file safety filter again, and when the change touches money
//             (prices, currency, cart, shipping/payment wording — decided by code) requires a
//             second, separate confirmation (confirmSensitive: true). Then charges
//             CREDIT_COSTS.qgent_apply (free on Agency), saves a DRAFT code version
//             "Qgent: <title>" and builds it like a chat edit (staged for a live store), so
//             shoppers see it only after Publish. Refunded when saving fails.
//   reject  → the proposal is dismissed. Free.
//   revert  → undoes an applied change: the touched files go back to their old content as a
//             new draft version ("Qgent undo: <title>") — only when nothing changed them since,
//             otherwise the merchant uses the version history. Free.

import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { debitCredits, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { rejectAiStoreFile } from '@/lib/store-template/build'
import { autoDeployCodeVersion } from '@/app/api/quante/iterate/deploy'
import { ACTION_COLUMNS, isMissingTable, loadLatestVersion, saveVersion, workingFiles, type ActionRow } from '@/lib/qgent/shop'
import { applyEdits, revertFiles, sensitiveReasons } from '@ad/qgent/shop'

export const maxDuration = 120

interface Params { params: Promise<{ id: string; actionId: string }> }

const COST = CREDIT_COSTS.qgent_apply
const now = () => new Date().toISOString()
const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

async function build(project: { id: string; name: string | null }, userId: string, files: Record<string, string>, version: { id: string; version_no: number }) {
  try {
    return await autoDeployCodeVersion({ projectId: project.id, projectName: project.name, userId, files, version, logTag: 'qgent' })
  } catch (err) {
    console.error('[qgent] build start failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id, actionId } = await params
  const { userId } = await auth()
  if (!userId) return json({ error: 'Unauthorized' }, 401)
  const project = await getOwnedProject<{ id: string; name: string | null }>(id, userId, 'id, name')
  if (!project || !isUuid(actionId)) return json({ error: 'Not found' }, 404)
  if (!rateLimit(`qgent-action:${userId}`, 20, 60_000).allowed) return json({ error: 'Too many requests. Wait a moment.' }, 429)

  const body = (await request.json().catch(() => null)) as { op?: unknown; confirmSensitive?: unknown } | null
  const op = body?.op
  if (op !== 'apply' && op !== 'reject' && op !== 'revert') return json({ error: 'Unknown action.' }, 400)

  const found = await supabaseAdmin.from('qgent_actions').select(ACTION_COLUMNS).eq('id', actionId).eq('project_id', id).maybeSingle()
  if (found.error) {
    if (isMissingTable(found.error)) return json({ error: 'Qgent is not set up yet.', setup: true }, 503)
    return json({ error: 'Could not load the change.' }, 500)
  }
  const action = found.data as unknown as ActionRow | null
  if (!action) return json({ error: 'Not found' }, 404)

  // ── reject ─────────────────────────────────────────────────────────────
  if (op === 'reject') {
    const { data } = await supabaseAdmin
      .from('qgent_actions')
      .update({ status: 'rejected', updated_at: now() })
      .eq('id', actionId)
      .in('status', ['proposed', 'advice', 'stale'])
      .select('id')
    if (!data?.length) return json({ error: 'This change can no longer be dismissed.' }, 409)
    return json({ ok: true })
  }

  const latest = await loadLatestVersion(id)
  if (!latest) return json({ error: 'Generate your store first.' }, 409)
  const files = workingFiles(latest.files)

  // ── apply ──────────────────────────────────────────────────────────────
  if (op === 'apply') {
    if (action.status !== 'proposed') return json({ error: 'This change is no longer waiting for confirmation.' }, 409)
    const r = applyEdits(files, action.edits ?? [])
    if (!r.ok) {
      await supabaseAdmin.from('qgent_actions').update({ status: 'stale', error: r.error, updated_at: now() }).eq('id', actionId).eq('status', 'proposed')
      return json({ error: `${r.error} Run a new review.`, stale: true }, 409)
    }
    for (const [p, c] of Object.entries(r.after)) {
      const why = rejectAiStoreFile(p, c)
      if (why) {
        await supabaseAdmin.from('qgent_actions').update({ status: 'failed', error: `Safety check: ${why}`, updated_at: now() }).eq('id', actionId).eq('status', 'proposed')
        return json({ error: 'This change did not pass the safety check, so it was not applied.' }, 422)
      }
    }
    // Decided again on the real before/after — never trusted from the stored proposal.
    const reasons = sensitiveReasons(r.before, r.after)
    if (reasons.length && body?.confirmSensitive !== true) {
      return json({ error: 'This change touches money and needs a separate confirmation.', needsSensitiveConfirm: true, reasons }, 409)
    }

    // Claim the proposal first, so a double click can't apply (or charge) twice.
    const claimed = await supabaseAdmin
      .from('qgent_actions')
      .update({ status: 'applied', confirmed_at: now(), sensitive_confirmed_at: reasons.length ? now() : null, sensitive_reasons: reasons, updated_at: now() })
      .eq('id', actionId)
      .eq('status', 'proposed')
      .select('id')
    if (!claimed.data?.length) return json({ error: 'This change is no longer waiting for confirmation.' }, 409)
    const release = (status: 'proposed' | 'failed', error: string | null) =>
      supabaseAdmin.from('qgent_actions').update({ status, error, confirmed_at: null, sensitive_confirmed_at: null, updated_at: now() }).eq('id', actionId)

    const agency = await isAgencyUser(userId)
    const versionId = randomUUID()
    if (!agency) {
      const debit = await debitCredits(userId, COST, 'qgent_apply', versionId)
      if (!debit.ok) {
        await release('proposed', null)
        if (debit.error === 'insufficient_credits') return json({ error: `Applying a change costs ${COST} credit. Top up in Billing.` }, 402)
        if (debit.error === 'billing_hold') return json({ error: 'Your account is on a billing hold. Contact support.' }, 403)
        return json({ error: 'Could not charge the credit.' }, 500)
      }
    }

    const newFiles = { ...latest.files, ...r.after }
    const saved = await saveVersion(id, userId, latest, newFiles, `Qgent: ${action.title}`, versionId)
    if (!saved.ok) {
      if (!agency) await refundDebit(userId, versionId, 'qgent_apply', 'qgent_apply_failed')
      await release('proposed', null)
      return json({ error: saved.conflict ? 'The store changed meanwhile. Try again.' : 'Could not save the change. Your credit was returned.' }, saved.conflict ? 409 : 500)
    }
    await supabaseAdmin
      .from('qgent_actions')
      .update({ files_before: r.before, files_after: r.after, applied_version_id: saved.id, credits_charged: agency ? 0 : COST, error: null, updated_at: now() })
      .eq('id', actionId)

    const deploy = await build(project, userId, newFiles, { id: saved.id, version_no: saved.version_no })
    return json({
      ok: true,
      versionId: saved.id,
      versionNo: saved.version_no,
      charged: agency ? 0 : COST,
      deploymentId: deploy?.deploymentId ?? null,
      previewUrl: deploy?.previewUrl ?? null,
      staged: deploy?.staged ?? false,
    })
  }

  // ── revert ─────────────────────────────────────────────────────────────
  if (action.status !== 'applied' || !action.files_before || !action.files_after) {
    return json({ error: 'Only an applied change can be undone.' }, 409)
  }
  const back = revertFiles(files, action.files_before, action.files_after)
  if (!back.ok) {
    return json({ error: `${back.error} Undo it from the version history instead.`, useHistory: true }, 409)
  }
  const claimed = await supabaseAdmin
    .from('qgent_actions')
    .update({ status: 'reverted', reverted_at: now(), updated_at: now() })
    .eq('id', actionId)
    .eq('status', 'applied')
    .select('id')
  if (!claimed.data?.length) return json({ error: 'This change can no longer be undone here.' }, 409)

  const newFiles = { ...latest.files, ...back.files }
  const saved = await saveVersion(id, userId, latest, newFiles, `Qgent undo: ${action.title}`)
  if (!saved.ok) {
    await supabaseAdmin.from('qgent_actions').update({ status: 'applied', reverted_at: null, updated_at: now() }).eq('id', actionId)
    return json({ error: 'Could not undo the change. Try again.' }, 500)
  }
  await supabaseAdmin.from('qgent_actions').update({ reverted_version_id: saved.id, updated_at: now() }).eq('id', actionId)
  const deploy = await build(project, userId, newFiles, { id: saved.id, version_no: saved.version_no })
  return json({
    ok: true,
    versionId: saved.id,
    versionNo: saved.version_no,
    charged: 0,
    deploymentId: deploy?.deploymentId ?? null,
    previewUrl: deploy?.previewUrl ?? null,
    staged: deploy?.staged ?? false,
  })
}
