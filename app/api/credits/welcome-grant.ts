// One-time welcome grant, shared by GET /api/credits/balance and the dashboard page.
// Server-only (not a route — Next only treats route.ts files as endpoints).
//
// Security:
//   - The grant goes through grant_welcome_credits_v2 (supabase/migration-security4-
//     identity-gate.sql), which runs under the per-user ledger advisory lock and is a
//     no-op once the user has ANY ledger row — parallel first requests used to insert two
//     welcome rows. Until that migration runs it falls back to grantWelcomeCredits
//     (lib/credits.ts), which has the same per-user once-only semantics.
//   - It is only granted once the account has a VERIFIED primary email (or phone), so
//     unverified throwaway sign-ups get nothing until they verify.
//   - Once per PERSON, not per Clerk account (audit F0/F10): every verified email / phone
//     is normalized (lower-case, +tag stripped on every domain, dots stripped and
//     googlemail.com folded into gmail.com, phones as E.164) and hashed; the RPC refuses
//     the grant when any of those identities already received one on another account.
//     The identities are also recorded per user so the one-per-user hosting trial
//     (lib/hosting/gate.ts) treats alias accounts as one person. The hosting trial does
//     not depend on this grant having run: lib/hosting/gate.ts derives the identities
//     from Clerk itself (verifiedIdentitiesForUserId below). Accounts that already have
//     ledger rows (pre-migration, or first row from a purchase) never reach the grant
//     RPC, so their identities are backfilled once here (record_user_identities).
//   - Well-known disposable email domains get no grant unless a phone is verified.
//   - The 1000-credit admin grant requires the VERIFIED primary email to be listed in
//     ADMIN_EMAILS — emailAddresses[0] was just whichever address came first, verified
//     or not, so anyone could add an admin's address to their account and claim it.

import { createHash } from 'node:crypto'
import { currentUser, clerkClient } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { grantWelcomeCredits, type GrantResult } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/config'

// Read from CREDIT_COSTS so a config bump can't drift out of sync with the
// marketing site's "N free credits" pitch.
const WELCOME_CREDITS = CREDIT_COSTS.welcome_grant
const ADMIN_GRANT = 1000
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

// Small static list of the most common throwaway-inbox providers. Not exhaustive — the
// identity dedupe above is the real guard; this just stops the laziest farming.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'dispostable.com',
  'emailondeck.com', 'fakeinbox.com', 'getairmail.com', 'getnada.com', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamailblock.com', 'grr.la', 'maildrop.cc', 'mailinator.com',
  'mailinator.net', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'mytemp.email',
  'nada.email', 'sharklasers.com', 'spam4.me', 'temp-mail.io', 'temp-mail.org',
  'tempail.com', 'tempmail.com', 'tempmail.dev', 'tempmail.net', 'tempmailo.com',
  'tempr.email', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'discard.email', 'burnermail.io',
  'mailpoof.com', 'moakt.com', 'inboxkitten.com', 'emailfake.com', 'luxusmail.org',
])

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export type WelcomeGrantRefusal = 'identity_already_used' | 'disposable_email'

export type WelcomeGrantResult =
  | { status: 'existing' }
  | { status: 'granted'; balance: number; isAdmin: boolean }
  | { status: 'verification_required' }
  /** Verified, but this person already had a welcome grant (or uses a throwaway inbox). */
  | { status: 'refused'; reason: WelcomeGrantRefusal }
  | { status: 'error' }

/**
 * Canonical mailbox for an email address: lower-case, `+tag` stripped (every domain),
 * and for Gmail dots removed and googlemail.com folded into gmail.com. null if invalid.
 */
export function normalizeEmail(raw: string): string | null {
  const email = (raw ?? '').trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  let local = email.slice(0, at)
  let domain = email.slice(at + 1).replace(/\.+$/, '')
  const plus = local.indexOf('+')
  if (plus >= 0) local = local.slice(0, plus)
  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com'
    local = local.replace(/\./g, '')
  }
  if (!local || !domain) return null
  return `${local}@${domain}`
}

/** E.164 form (`+<digits>`) of a phone number, or null if it can't be one. */
export function normalizePhone(raw: string): string | null {
  let s = (raw ?? '').trim()
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return `+${digits}`
}

export function isDisposableEmail(raw: string): boolean {
  const normalized = normalizeEmail(raw)
  if (!normalized) return false
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1)
  return DISPOSABLE_EMAIL_DOMAINS.has(domain)
}

// Identities are stored as SHA-256 digests, never as plaintext email / phone.
function identityKey(kind: 'email' | 'phone', normalized: string): string {
  return createHash('sha256').update(`${kind}:${normalized}`).digest('hex')
}

/** The Clerk User fields the identity helpers read (structural, so tests can fake it). */
export interface IdentitySource {
  emailAddresses?: { emailAddress: string; verification?: { status?: string | null } | null }[] | null
  phoneNumbers?: { phoneNumber: string; verification?: { status?: string | null } | null }[] | null
}

/** Hashed normalized identities for a set of VERIFIED emails and phone numbers. */
export function normalizedIdentities(emails: string[], phones: string[]): string[] {
  const out = new Set<string>()
  for (const e of emails) {
    const n = normalizeEmail(e)
    if (n) out.add(identityKey('email', n))
  }
  for (const p of phones) {
    const n = normalizePhone(p)
    if (n) out.add(identityKey('phone', n))
  }
  return [...out].slice(0, 20)
}

/** Hashed normalized identities of a Clerk user's VERIFIED emails and phone numbers. */
export function verifiedIdentitiesOf(user: IdentitySource): string[] {
  const emails = (user.emailAddresses ?? [])
    .filter((e) => e.verification?.status === 'verified')
    .map((e) => e.emailAddress)
  const phones = (user.phoneNumbers ?? [])
    .filter((p) => p.verification?.status === 'verified')
    .map((p) => p.phoneNumber)
  return normalizedIdentities(emails, phones)
}

/**
 * Hashed normalized identities of `userId`, read server-side from Clerk (not from the
 * session / request). [] when the Clerk user no longer exists; null when the lookup
 * fails (callers fail closed).
 */
export async function verifiedIdentitiesForUserId(userId: string): Promise<string[] | null> {
  if (!userId || userId.startsWith('deleted:')) return []
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    return verifiedIdentitiesOf(user)
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 404) return []
    console.error('[credits] Clerk identity lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}

type GrantV2Result =
  | GrantResult
  | { ok: false; error: 'identity_already_used' }
  | { ok: false; error: 'unavailable' }

// PGRST202 = function not in PostgREST's schema cache; 42883 = undefined_function.
// Either means migration-security4-identity-gate.sql has not been run yet.
function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

/** grant_welcome_credits_v2 — once per user and per normalized identity. */
async function grantWelcomeCreditsV2(
  userId: string,
  amount: number,
  identities: string[],
  reason = 'welcome_grant',
): Promise<GrantV2Result> {
  const { data, error } = await supabaseAdmin.rpc('grant_welcome_credits_v2', {
    p_user_id: userId,
    p_amount: amount,
    p_identities: identities,
    p_reason: reason,
  })
  if (error || !data) {
    if (isMissingFunction(error)) return { ok: false, error: 'unavailable' }
    console.error('[credits] grant_welcome_credits_v2 rpc failed:', error?.message)
    return { ok: false, error: 'rpc_error' }
  }
  const d = data as { ok: boolean; error?: string; balance?: number; already_granted?: boolean }
  if (!d.ok) {
    if (d.error === 'identity_already_used') return { ok: false, error: 'identity_already_used' }
    return { ok: false, error: d.error ?? 'rpc_error' }
  }
  return { ok: true, balance: d.balance ?? 0, alreadyGranted: !!d.already_granted }
}

// 42P01 = undefined_table; PGRST205 = table not in PostgREST's schema cache.
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/**
 * One-time identity backfill for an account that already has ledger rows and so never
 * reaches grant_welcome_credits_v2 (it got its credits before the migration, or its
 * first ledger row came from a purchase). Without it, its later alias accounts could
 * not be linked to it for the hosting trial. Best-effort: a no-op once the account has
 * any user_identities row, or while the migration has not run.
 */
async function backfillIdentities(userId: string): Promise<void> {
  const { data: known, error } = await supabaseAdmin
    .from('user_identities').select('user_id').eq('user_id', userId).limit(1).maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[credits] identity backfill lookup failed:', error.message)
    return
  }
  if (known) return

  const user = await currentUser()
  if (!user || user.id !== userId) return
  const identities = verifiedIdentitiesOf(user)
  if (identities.length === 0) return
  const { error: rpcErr } = await supabaseAdmin.rpc('record_user_identities', {
    p_user_id: userId,
    p_identities: identities,
  })
  if (rpcErr && !isMissingFunction(rpcErr)) {
    console.error('[credits] record_user_identities rpc failed:', rpcErr.message)
  }
}

export async function ensureWelcomeGrant(userId: string): Promise<WelcomeGrantResult> {
  // Cheap fast path — the RPC below is still the authoritative once-only check.
  const { data: anyRow, error } = await supabaseAdmin
    .from('credit_ledger').select('id').eq('user_id', userId).limit(1).maybeSingle()
  if (error) return { status: 'error' }
  if (anyRow) {
    try {
      await backfillIdentities(userId)
    } catch (err) {
      console.error('[credits] identity backfill failed:', err)
    }
    return { status: 'existing' }
  }

  const user = await currentUser()
  if (!user || user.id !== userId) return { status: 'error' }

  const primaryEmail = user.primaryEmailAddress
  const emailVerified = primaryEmail?.verification?.status === 'verified'
  const phoneVerified = user.primaryPhoneNumber?.verification?.status === 'verified'
  if (!emailVerified && !phoneVerified) return { status: 'verification_required' }

  const email = emailVerified ? (primaryEmail?.emailAddress ?? '').trim().toLowerCase() : ''
  const isAdmin = email !== '' && ADMIN_EMAILS.includes(email)

  if (isAdmin) {
    // The exact verified ADMIN_EMAILS address can sit on one Clerk account only, so the
    // identity dedupe adds nothing here — and must not lock an admin out because an
    // earlier test alias of theirs took the normal welcome grant.
    const res = await grantWelcomeCredits(userId, ADMIN_GRANT, 'admin_grant')
    if (!res.ok) return { status: 'error' }
    if (res.alreadyGranted) return { status: 'existing' }
    return { status: 'granted', balance: res.balance, isAdmin: true }
  }

  // A throwaway inbox alone is not an identity worth 12 credits; a verified phone is.
  if (emailVerified && !phoneVerified && isDisposableEmail(email)) {
    return { status: 'refused', reason: 'disposable_email' }
  }

  const identities = verifiedIdentitiesOf(user)
  // Primary verified but unparseable — nothing to dedupe on, so no grant.
  if (identities.length === 0) return { status: 'verification_required' }

  let res: GrantV2Result = await grantWelcomeCreditsV2(userId, WELCOME_CREDITS, identities, 'welcome_grant')
  if (!res.ok && res.error === 'unavailable') {
    // Migration not run yet — the previous per-user-only grant.
    res = await grantWelcomeCredits(userId, WELCOME_CREDITS, 'welcome_grant')
  }
  if (!res.ok) {
    if (res.error === 'identity_already_used') return { status: 'refused', reason: 'identity_already_used' }
    return { status: 'error' }
  }
  if (res.alreadyGranted) return { status: 'existing' }
  return { status: 'granted', balance: res.balance, isAdmin: false }
}
