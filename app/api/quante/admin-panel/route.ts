import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit, getBalance } from '@/lib/credits'
import { hasPaidAdminPanel, ADMIN_PANEL_REASON, ADMIN_PANEL_REFUND_REASON } from './paid'

export const maxDuration = 60

const ADMIN_COST = 5
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let projectId: unknown
  try { ({ projectId } = await request.json()) }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // Ownership check (service-role client — RLS does not apply)
  const project = await getOwnedProject<{ id: string; name: string }>(projectId, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get current manifest
  const { data: version } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest, version_no')
    .eq('project_id', project.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return NextResponse.json({ error: 'No manifest found.' }, { status: 404 })

  // Already purchased for this project → just (re)apply the flag, don't charge again.
  const alreadyPaid = await hasPaidAdminPanel(userId, project.id)

  // Atomic debit BEFORE the work. ref_id = projectId so export / manifest save can
  // verify the purchase server-side (see ./paid.ts) instead of trusting manifest.adminPanel.
  let balance: number
  if (alreadyPaid) {
    balance = await getBalance(userId)
  } else {
    const debit = await debitCredits(userId, ADMIN_COST, ADMIN_PANEL_REASON, project.id)
    if (!debit.ok) {
      if (debit.error === 'insufficient_credits') {
        return NextResponse.json(
          { error: `Insufficient credits. Need ${ADMIN_COST}, have ${debit.balance ?? 0}.` },
          { status: 402 }
        )
      }
      if (debit.error === 'billing_hold') {
        return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Failed to debit credits.' }, { status: 500 })
    }
    balance = debit.balance
  }

  // Patch manifest with adminPanel flag
  const updatedManifest = { ...(version.manifest as object), adminPanel: true }

  const { data: newVersion } = await supabaseAdmin
    .from('manifest_versions')
    .insert({
      project_id: project.id,
      version_no: version.version_no + 1,
      manifest: updatedManifest,
      prompt: 'Admin panel added',
    })
    .select('id')
    .single()

  if (!newVersion) {
    if (!alreadyPaid) {
      // amount = ADMIN_COST: refund only this request's debit, never an earlier purchase
      await refundDebit(userId, project.id, ADMIN_PANEL_REASON, ADMIN_PANEL_REFUND_REASON, ADMIN_COST)
    }
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, balance })
}
