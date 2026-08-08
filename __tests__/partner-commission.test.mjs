// Partner commission — calculateCommissionCents() pure math, plus a fake-DB test of the
// idempotent recordCommission() ledger-insert helper.
// Usage: node --test __tests__/partner-commission.test.mjs
// Or via: npm run test:partner-commission
//
// Inlines plain-JS copies of lib/partner-commission.ts (must stay in sync) — same
// convention as __tests__/fulfillment-byrd.test.mjs / __tests__/store-health.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/partner-commission.ts (inlined copy) ───────────────────────────────────

function calculateCommissionCents(amountCents, commissionRateBps) {
  if (!Number.isFinite(amountCents) || !Number.isFinite(commissionRateBps)) return 0
  if (amountCents <= 0 || commissionRateBps <= 0) return 0
  return Math.floor((amountCents * commissionRateBps) / 10000)
}

// Fake append-only ledger table + a minimal Supabase-like query builder, just enough to
// exercise recordCommission()'s real control flow (read last balance, insert, detect a
// UNIQUE(partner_id, ref_id) collision) without a real DB.
function makeFakeLedger() {
  const rows = []
  return {
    rows,
    from(table) {
      assert.equal(table, 'partner_commission_ledger')
      return {
        select() { return this },
        eq(field, value) { this._partnerId = field === 'partner_id' ? value : this._partnerId; return this },
        order() { return this },
        limit() { return this },
        async maybeSingle() {
          const forPartner = rows.filter((r) => r.partner_id === this._partnerId)
          const last = forPartner[forPartner.length - 1]
          return { data: last ? { balance_after_cents: last.balance_after_cents } : null }
        },
        async insert(row) {
          const dup = rows.find((r) => r.partner_id === row.partner_id && r.ref_id === row.ref_id)
          if (dup) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}

async function recordCommission(db, input) {
  const commissionCents = calculateCommissionCents(input.amountCents, input.commissionRateBps)
  if (commissionCents <= 0) return { recorded: false, commissionCents: 0 }

  const { data: lastEntry } = await db.from('partner_commission_ledger').select().eq('partner_id', input.partnerId).order().limit().maybeSingle()
  const balanceAfter = (lastEntry?.balance_after_cents ?? 0) + commissionCents

  const { error } = await db.from('partner_commission_ledger').insert({
    partner_id: input.partnerId,
    project_id: input.projectId,
    delta_cents: commissionCents,
    currency: input.currency,
    reason: input.reason,
    ref_id: input.refId,
    balance_after_cents: balanceAfter,
  })

  if (error) {
    if (error.code === '23505') return { recorded: false, commissionCents: 0 }
    throw new Error(`Failed to record partner commission: ${error.message}`)
  }
  return { recorded: true, commissionCents }
}

// ─── tests ───────────────────────────────────────────────────────────────────────

test('10% of $29.00 (2900 cents) is 290 cents', () => {
  assert.equal(calculateCommissionCents(2900, 1000), 290)
})

test('rounds down (floors) rather than rounding to the nearest cent', () => {
  // 999 cents * 1000 bps / 10000 = 99.9 → floors to 99, never rounds up to 100
  assert.equal(calculateCommissionCents(999, 1000), 99)
})

test('zero or negative amount produces zero commission', () => {
  assert.equal(calculateCommissionCents(0, 1000), 0)
  assert.equal(calculateCommissionCents(-500, 1000), 0)
})

test('zero commission rate produces zero commission', () => {
  assert.equal(calculateCommissionCents(5000, 0), 0)
})

test('non-finite inputs never throw and produce zero', () => {
  assert.equal(calculateCommissionCents(NaN, 1000), 0)
  assert.equal(calculateCommissionCents(5000, Infinity), 0)
})

test('recordCommission accrues a running balance across multiple entries for the same partner', async () => {
  const db = makeFakeLedger()
  const r1 = await recordCommission(db, { partnerId: 'p1', projectId: 'proj1', amountCents: 2900, commissionRateBps: 1000, currency: 'usd', reason: 'renewal', refId: 'sub_1:2026-01-01' })
  const r2 = await recordCommission(db, { partnerId: 'p1', projectId: 'proj1', amountCents: 2900, commissionRateBps: 1000, currency: 'usd', reason: 'renewal', refId: 'sub_1:2026-02-01' })
  assert.equal(r1.recorded, true)
  assert.equal(r1.commissionCents, 290)
  assert.equal(r2.recorded, true)
  assert.equal(db.rows[1].balance_after_cents, 580)
})

test('recordCommission is idempotent — the same ref_id is never double-counted', async () => {
  const db = makeFakeLedger()
  const input = { partnerId: 'p1', projectId: 'proj1', amountCents: 2900, commissionRateBps: 1000, currency: 'usd', reason: 'renewal', refId: 'sub_1:2026-01-01' }
  const r1 = await recordCommission(db, input)
  const r2 = await recordCommission(db, input) // simulates a retried/duplicate webhook delivery
  assert.equal(r1.recorded, true)
  assert.equal(r2.recorded, false)
  assert.equal(db.rows.length, 1)
})

test('different partners with the same ref_id do not collide with each other', async () => {
  const db = makeFakeLedger()
  const r1 = await recordCommission(db, { partnerId: 'p1', projectId: 'proj1', amountCents: 2900, commissionRateBps: 1000, currency: 'usd', reason: 'renewal', refId: 'sub_1:2026-01-01' })
  const r2 = await recordCommission(db, { partnerId: 'p2', projectId: 'proj2', amountCents: 2900, commissionRateBps: 500, currency: 'usd', reason: 'renewal', refId: 'sub_1:2026-01-01' })
  assert.equal(r1.recorded, true)
  assert.equal(r2.recorded, true)
  assert.equal(db.rows.length, 2)
})
