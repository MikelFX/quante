import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { payoutIbanCooldownDays } from '@/lib/payments/earnings'

// SECURITY (audit #9): changing the IBAN or account holder
//   - restarts the payout cool-down (iban_changed_at): /api/payout/request refuses
//     payouts for PAYOUT_IBAN_COOLDOWN_DAYS afterwards, so a hijacked account can't
//     swap the IBAN and cash out immediately;
//   - clears identity_verified_at: an operator must re-verify that the account holder
//     is the verified store owner before money goes to the new account.
// Both columns come from supabase/migration-security-stripe-payments.sql.

// ISO 13616 IBAN check (length + mod-97). Rejects typos and junk before money is sent.
function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

type PgError = { code?: string; message?: string } | null

function isMissingColumn(err: PgError): boolean {
  if (!err) return false
  return err.code === '42703' || err.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column/i.test(err.message ?? '')
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const project = await getOwnedProject(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let { data, error } = await supabaseAdmin
    .from('store_payout_accounts')
    .select('iban, account_holder_name, bank_name, iban_changed_at, identity_verified_at')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error && isMissingColumn(error)) {
    ;({ data, error } = await supabaseAdmin
      .from('store_payout_accounts')
      .select('iban, account_holder_name, bank_name')
      .eq('project_id', projectId)
      .maybeSingle())
  }

  if (!data) return NextResponse.json({ iban: null, account_holder_name: null, bank_name: null, identity_verified: false })

  const row = data as {
    iban: string; account_holder_name: string; bank_name: string | null
    iban_changed_at?: string | null; identity_verified_at?: string | null
  }
  const changedMs = row.iban_changed_at ? Date.parse(row.iban_changed_at) : NaN
  return NextResponse.json({
    iban: row.iban,
    account_holder_name: row.account_holder_name,
    bank_name: row.bank_name,
    // Additive fields (older clients ignore them).
    identity_verified: !!row.identity_verified_at,
    payouts_available_from: Number.isFinite(changedMs)
      ? new Date(changedMs + payoutIbanCooldownDays() * 86_400_000).toISOString()
      : null,
  })
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; iban?: unknown; accountHolderName?: unknown; bankName?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { projectId, iban, accountHolderName, bankName } = body
  if (!projectId || typeof iban !== 'string' || typeof accountHolderName !== 'string' || !iban || !accountHolderName.trim()) {
    return NextResponse.json({ error: 'projectId, iban, and accountHolderName required' }, { status: 400 })
  }

  const project = await getOwnedProject(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const normalizedIban = iban.trim().replace(/\s+/g, '').toUpperCase()
  if (!isValidIban(normalizedIban)) {
    return NextResponse.json({ error: 'Invalid IBAN.' }, { status: 400 })
  }
  const holder = accountHolderName.trim().slice(0, 140)
  const bank = typeof bankName === 'string' ? bankName.trim().slice(0, 140) || null : null

  const { data: existing, error: readErr } = await supabaseAdmin
    .from('store_payout_accounts')
    .select('iban, account_holder_name')
    .eq('project_id', projectId)
    .maybeSingle()
  if (readErr) {
    console.error('[payout/account] read failed:', readErr.message)
    return NextResponse.json({ error: 'Failed to save payout account.' }, { status: 500 })
  }
  const changed = !existing
    || existing.iban !== normalizedIban
    || existing.account_holder_name !== holder

  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    project_id: projectId,
    user_id: userId,
    iban: normalizedIban,
    account_holder_name: holder,
    bank_name: bank,
    updated_at: now,
    // New destination for money: restart the cool-down and require re-verification.
    ...(changed ? { iban_changed_at: now, identity_verified_at: null } : {}),
  }

  let { error } = await supabaseAdmin.from('store_payout_accounts').upsert(row, { onConflict: 'project_id' })
  if (error && isMissingColumn(error)) {
    // Before the migration: payout requests fall back to updated_at for the cool-down
    // and refuse payouts as unverified, so saving without the columns stays safe.
    console.warn('[payout/account] iban_changed_at/identity_verified_at missing — run supabase/migration-security-stripe-payments.sql')
    const stripped = Object.fromEntries(
      Object.entries(row).filter(([k]) => k !== 'iban_changed_at' && k !== 'identity_verified_at'),
    )
    ;({ error } = await supabaseAdmin.from('store_payout_accounts').upsert(stripped, { onConflict: 'project_id' }))
  }

  if (error) {
    console.error('[payout/account] upsert failed:', error.message)
    return NextResponse.json({ error: 'Failed to save payout account.' }, { status: 500 })
  }

  if (changed && existing) {
    console.warn(`[payout/account] SECURITY: payout account for project ${projectId} changed by ${userId} — cool-down restarted, re-verification required`)
  }

  return NextResponse.json({ ok: true })
}
