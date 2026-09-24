// Identity gate (audit F0/F10) — welcome-credit and hosting-trial dedupe across alias
// accounts.
// Usage: node --test __tests__/identity-gate.test.mjs
//
// Inlines plain-JS copies (must stay in sync) of:
//   - normalizeEmail / normalizePhone / normalizedIdentities / verifiedIdentitiesOf
//     from app/api/credits/welcome-grant.ts
//   - an in-memory model of grant_welcome_credits_v2, record_user_identities and
//     claim_hosting_trial_v2 from supabase/migration-security4-identity-gate.sql
// Same convention as the other __tests__ files: plain `node --test`, no TS loader.
// Every farming path found in review is kept here as a REJECTED case.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// ─── app/api/credits/welcome-grant.ts (inlined copy) ────────────────────────────

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

function normalizeEmail(raw) {
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

function normalizePhone(raw) {
  let s = (raw ?? '').trim()
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return `+${digits}`
}

function identityKey(kind, normalized) {
  return createHash('sha256').update(`${kind}:${normalized}`).digest('hex')
}

function normalizedIdentities(emails, phones) {
  const out = new Set()
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

function verifiedIdentitiesOf(user) {
  const emails = (user.emailAddresses ?? [])
    .filter((e) => e.verification?.status === 'verified')
    .map((e) => e.emailAddress)
  const phones = (user.phoneNumbers ?? [])
    .filter((p) => p.verification?.status === 'verified')
    .map((p) => p.phoneNumber)
  return normalizedIdentities(emails, phones)
}

// ─── supabase/migration-security4-identity-gate.sql (in-memory model) ───────────

function makeDb() {
  return {
    ledger: new Map(),          // user_id -> balance (any entry = has ledger rows)
    welcomeGrants: new Map(),   // identity -> user_id
    userIdentities: new Set(),  // `${identity}|${user_id}`
    hostingTrials: new Map(),   // user_id -> project_id
    projects: [],               // { id, user_id, hosting_trial_ends_at }
  }
}

function clean(ids) {
  return [...new Set((ids ?? []).filter((i) => i && i.length <= 200))].sort()
}

function storedIdentities(db, userId) {
  const out = []
  for (const k of db.userIdentities) {
    const [id, u] = k.split('|')
    if (u === userId) out.push(id)
  }
  return out
}

function grantWelcomeV2(db, userId, amount, identities) {
  const ids = clean(identities)
  if (ids.length === 0 || ids.length > 20) return { ok: false, error: 'invalid_identities' }
  for (const i of ids) db.userIdentities.add(`${i}|${userId}`)
  if (db.ledger.has(userId)) return { ok: true, already_granted: true, balance: db.ledger.get(userId) }
  if (ids.some((i) => db.welcomeGrants.has(i) && db.welcomeGrants.get(i) !== userId)) {
    return { ok: false, error: 'identity_already_used', balance: 0 }
  }
  for (const i of ids) if (!db.welcomeGrants.has(i)) db.welcomeGrants.set(i, userId)
  db.ledger.set(userId, amount)
  return { ok: true, balance: amount }
}

function recordUserIdentities(db, userId, identities) {
  const ids = clean(identities)
  for (const i of ids) db.userIdentities.add(`${i}|${userId}`)
  return { ok: true, recorded: ids.length }
}

function claimHostingTrialV2(db, userId, projectId, identities) {
  const fresh = clean(identities)
  if (fresh.length > 20) return { ok: false, error: 'invalid_identities' }
  const ids = clean([...fresh, ...storedIdentities(db, userId)])
  for (const i of fresh) db.userIdentities.add(`${i}|${userId}`)
  if (db.hostingTrials.has(userId)) {
    return { ok: true, status: db.hostingTrials.get(userId) === projectId ? 'claimed' : 'used' }
  }
  if (ids.length === 0) return { ok: true, status: 'used', reason: 'unverified' }
  const siblings = new Set()
  for (const k of db.userIdentities) {
    const [id, u] = k.split('|')
    if (ids.includes(id) && u !== userId) siblings.add(u)
  }
  const siblingUsed = [...siblings].some((s) =>
    db.hostingTrials.has(s) ||
    db.projects.some((p) => p.hosting_trial_ends_at && (p.user_id === s || p.user_id === `deleted:${s}`)),
  )
  if (siblingUsed) return { ok: true, status: 'used', reason: 'identity' }
  db.hostingTrials.set(userId, projectId)
  return { ok: true, status: 'claimed' }
}

// ─── Clerk fixtures ─────────────────────────────────────────────────────────────

const verified = { status: 'verified' }
const unverified = { status: 'unverified' }
function clerkUser(emails = [], phones = []) {
  return {
    emailAddresses: emails.map(([emailAddress, verification = verified]) => ({ emailAddress, verification })),
    phoneNumbers: phones.map(([phoneNumber, verification = verified]) => ({ phoneNumber, verification })),
  }
}

// ─── Normalization ──────────────────────────────────────────────────────────────

test('gmail aliases collapse to one mailbox', () => {
  for (const alias of ['Me@gmail.com', 'm.e@gmail.com', 'me+shop1@gmail.com', 'M.E+x@googlemail.com', ' me@gmail.com. ']) {
    assert.equal(normalizeEmail(alias), 'me@gmail.com', alias)
  }
})

test('+tag is stripped on every domain, dots only on gmail', () => {
  assert.equal(normalizeEmail('jan.novak+test@seznam.cz'), 'jan.novak@seznam.cz')
  assert.notEqual(normalizeEmail('jan.novak@seznam.cz'), normalizeEmail('jannovak@seznam.cz'))
})

test('invalid emails / phones are dropped', () => {
  assert.equal(normalizeEmail('nobody'), null)
  assert.equal(normalizeEmail('@gmail.com'), null)
  assert.equal(normalizeEmail('+tag@gmail.com'), null)
  assert.equal(normalizePhone('12'), null)
})

test('phones normalize to E.164', () => {
  assert.equal(normalizePhone('+420 777 123 456'), '+420777123456')
  assert.equal(normalizePhone('00420777123456'), '+420777123456')
})

test('only VERIFIED emails / phones become identities', () => {
  const ids = verifiedIdentitiesOf(clerkUser([['me@gmail.com'], ['other@x.cz', unverified]], [['+420777123456', unverified]]))
  assert.deepEqual(ids, [identityKey('email', 'me@gmail.com')])
})

test('identities are hashed, never plaintext', () => {
  const [id] = normalizedIdentities(['me@gmail.com'], [])
  assert.match(id, /^[0-9a-f]{64}$/)
  assert.ok(!id.includes('gmail'))
})

// ─── Welcome grant (F0) ─────────────────────────────────────────────────────────

test('REJECTED: welcome grant farmed with a gmail alias', () => {
  const db = makeDb()
  const a = verifiedIdentitiesOf(clerkUser([['m.e@gmail.com']]))
  const b = verifiedIdentitiesOf(clerkUser([['me+2@googlemail.com']]))
  assert.equal(grantWelcomeV2(db, 'user_a', 12, a).ok, true)
  assert.deepEqual(grantWelcomeV2(db, 'user_b', 12, b), { ok: false, error: 'identity_already_used', balance: 0 })
})

test('REJECTED: welcome grant farmed with a new email but the same verified phone', () => {
  const db = makeDb()
  grantWelcomeV2(db, 'user_a', 12, verifiedIdentitiesOf(clerkUser([['a@x.cz']], [['+420777123456']])))
  const res = grantWelcomeV2(db, 'user_b', 12, verifiedIdentitiesOf(clerkUser([['b@y.cz']], [['00420 777 123 456']])))
  assert.equal(res.error, 'identity_already_used')
})

test('allowed: two different people each get the welcome grant once', () => {
  const db = makeDb()
  assert.equal(grantWelcomeV2(db, 'user_a', 12, normalizedIdentities(['alice@gmail.com'], [])).balance, 12)
  assert.equal(grantWelcomeV2(db, 'user_b', 12, normalizedIdentities(['bob@gmail.com'], [])).balance, 12)
  assert.equal(grantWelcomeV2(db, 'user_a', 12, normalizedIdentities(['alice@gmail.com'], [])).already_granted, true)
})

// ─── Hosting trial (F10) ────────────────────────────────────────────────────────

test('REJECTED: alias that never ran the welcome grant (projects → manifest/save → deploy)', () => {
  const db = makeDb()
  // Neither account ever called /api/credits/balance — identities come from Clerk only.
  const a = verifiedIdentitiesOf(clerkUser([['me@gmail.com']]))
  const b = verifiedIdentitiesOf(clerkUser([['m.e+shop2@gmail.com']]))
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', a).status, 'claimed')
  assert.deepEqual(claimHostingTrialV2(db, 'user_b', 'p2', b), { ok: true, status: 'used', reason: 'identity' })
})

test('REJECTED: first account never ran the grant, alias did (reverse direction)', () => {
  const db = makeDb()
  const a = verifiedIdentitiesOf(clerkUser([['me@gmail.com']]))
  const b = verifiedIdentitiesOf(clerkUser([['me+2@gmail.com']]))
  grantWelcomeV2(db, 'user_b', 12, b) // only the alias touched the balance endpoint
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', a).status, 'claimed')
  assert.equal(claimHostingTrialV2(db, 'user_b', 'p2', b).status, 'used')
})

test('REJECTED: purchase-first / pre-migration account — backfilled identities link its alias', () => {
  const db = makeDb()
  // Pre-migration: user_a already has ledger rows and a live store, no identity rows.
  db.ledger.set('user_a', 100)
  db.projects.push({ id: 'p1', user_id: 'user_a', hosting_trial_ends_at: '2026-01-01T00:00:00Z' })
  const a = verifiedIdentitiesOf(clerkUser([['me@gmail.com']]))
  // ensureWelcomeGrant's fast path ('existing') backfills once via record_user_identities.
  assert.deepEqual(recordUserIdentities(db, 'user_a', a), { ok: true, recorded: 1 })
  const b = verifiedIdentitiesOf(clerkUser([['m.e@googlemail.com']]))
  assert.equal(claimHostingTrialV2(db, 'user_b', 'p2', b).status, 'used')
})

test('REJECTED: trial held by a soft-deleted project of an alias still counts', () => {
  const db = makeDb()
  const ids = normalizedIdentities(['me@gmail.com'], [])
  recordUserIdentities(db, 'user_a', ids)
  db.projects.push({ id: 'p1', user_id: 'deleted:user_a', hosting_trial_ends_at: '2026-01-01T00:00:00Z' })
  assert.equal(claimHostingTrialV2(db, 'user_b', 'p2', normalizedIdentities(['me+x@gmail.com'], [])).status, 'used')
})

test('REJECTED: an email removed from Clerk after claiming still links (stored identities are unioned)', () => {
  const db = makeDb()
  claimHostingTrialV2(db, 'user_a', 'p1', normalizedIdentities(['me@gmail.com'], []))
  // user_b claimed nothing yet but had the alias recorded earlier, then removed it from Clerk.
  recordUserIdentities(db, 'user_b', normalizedIdentities(['me+2@gmail.com'], []))
  assert.equal(claimHostingTrialV2(db, 'user_b', 'p2', normalizedIdentities(['fresh@proton.me'], [])).status, 'used')
})

test('REJECTED: account with no verified identity gets no free trial', () => {
  const db = makeDb()
  const ids = verifiedIdentitiesOf(clerkUser([['ghost@x.cz', unverified]]))
  assert.deepEqual(claimHostingTrialV2(db, 'user_x', 'p1', ids), { ok: true, status: 'used', reason: 'unverified' })
})

test('REJECTED: second project of the same account', () => {
  const db = makeDb()
  const ids = normalizedIdentities(['alice@x.cz'], [])
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', ids).status, 'claimed')
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p2', ids).status, 'used')
})

test('allowed: re-claim for the same project is idempotent', () => {
  const db = makeDb()
  const ids = normalizedIdentities(['alice@x.cz'], [])
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', ids).status, 'claimed')
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', ids).status, 'claimed')
})

test('allowed: unrelated people each get one trial', () => {
  const db = makeDb()
  assert.equal(claimHostingTrialV2(db, 'user_a', 'p1', normalizedIdentities(['alice@gmail.com'], [])).status, 'claimed')
  assert.equal(claimHostingTrialV2(db, 'user_b', 'p2', normalizedIdentities(['bob@gmail.com'], [])).status, 'claimed')
  // Different non-gmail local parts with dots stay distinct people.
  assert.equal(claimHostingTrialV2(db, 'user_c', 'p3', normalizedIdentities(['j.novak@firma.cz'], [])).status, 'claimed')
  assert.equal(claimHostingTrialV2(db, 'user_d', 'p4', normalizedIdentities(['jnovak@firma.cz'], [])).status, 'claimed')
})
