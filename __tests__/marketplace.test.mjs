// Marketplace — calculateRevenueSplit() pure math, plus a fake-DB test of the idempotent
// recordSellerEarning() ledger-insert helper.
// Usage: node --test __tests__/marketplace.test.mjs
// Or via: npm run test:marketplace
//
// Inlines a plain-JS copy of lib/marketplace.ts (must stay in sync) — same convention as
// __tests__/partner-commission.test.mjs / __tests__/store-health.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/marketplace.ts (inlined copy) ──────────────────────────────────────────

const DEFAULT_PLATFORM_FEE_BPS = 2000

function calculateRevenueSplit(priceCents, platformFeeBps = DEFAULT_PLATFORM_FEE_BPS) {
  const safePrice = Number.isFinite(priceCents) && priceCents > 0 ? Math.floor(priceCents) : 0
  const safeBps = Number.isFinite(platformFeeBps) ? Math.min(Math.max(platformFeeBps, 0), 10000) : 0
  const platformFeeCents = Math.floor((safePrice * safeBps) / 10000)
  return {
    priceCents: safePrice,
    platformFeeBps: safeBps,
    platformFeeCents,
    sellerEarningCents: safePrice - platformFeeCents,
  }
}

function makeFakeLedger() {
  const rows = []
  return {
    rows,
    from(table) {
      assert.equal(table, 'marketplace_seller_ledger')
      return {
        select() { return this },
        eq(field, value) { this._sellerId = field === 'seller_user_id' ? value : this._sellerId; return this },
        order() { return this },
        limit() { return this },
        async maybeSingle() {
          const forSeller = rows.filter((r) => r.seller_user_id === this._sellerId)
          const last = forSeller[forSeller.length - 1]
          return { data: last ? { balance_after_cents: last.balance_after_cents } : null }
        },
        async insert(row) {
          const dup = rows.find((r) => r.purchase_id === row.purchase_id)
          if (dup) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}

async function recordSellerEarning(db, input) {
  if (input.sellerEarningCents <= 0) return { recorded: false }

  const { data: lastEntry } = await db.from('marketplace_seller_ledger').select().eq('seller_user_id', input.sellerUserId).order().limit().maybeSingle()
  const balanceAfter = (lastEntry?.balance_after_cents ?? 0) + input.sellerEarningCents

  const { error } = await db.from('marketplace_seller_ledger').insert({
    seller_user_id: input.sellerUserId,
    purchase_id: input.purchaseId,
    delta_cents: input.sellerEarningCents,
    currency: input.currency,
    balance_after_cents: balanceAfter,
  })

  if (error) {
    if (error.code === '23505') return { recorded: false }
    throw new Error(`Failed to record seller earning: ${error.message}`)
  }
  return { recorded: true }
}

// ─── tests ───────────────────────────────────────────────────────────────────────

test('a $10.00 listing at the default 20% platform fee splits 800/200', () => {
  const split = calculateRevenueSplit(1000)
  assert.equal(split.platformFeeCents, 200)
  assert.equal(split.sellerEarningCents, 800)
})

test('platform fee floors rather than rounds', () => {
  // 999 * 2000 / 10000 = 199.8 → floors to 199, seller gets the remainder (800)
  const split = calculateRevenueSplit(999)
  assert.equal(split.platformFeeCents, 199)
  assert.equal(split.sellerEarningCents, 800)
})

test('a free (0 cents) listing has no fee and no seller earning', () => {
  const split = calculateRevenueSplit(0)
  assert.equal(split.platformFeeCents, 0)
  assert.equal(split.sellerEarningCents, 0)
})

test('negative or non-finite price is clamped to zero', () => {
  assert.equal(calculateRevenueSplit(-500).priceCents, 0)
  assert.equal(calculateRevenueSplit(NaN).priceCents, 0)
})

test('platform fee bps is clamped to [0, 10000] — cannot exceed 100% or go negative', () => {
  assert.equal(calculateRevenueSplit(1000, 15000).platformFeeCents, 1000) // clamped to 100%
  assert.equal(calculateRevenueSplit(1000, -500).platformFeeCents, 0)     // clamped to 0%
})

test('custom platform fee rate is respected (e.g. a promotional 10% rate)', () => {
  const split = calculateRevenueSplit(2000, 1000)
  assert.equal(split.platformFeeCents, 200)
  assert.equal(split.sellerEarningCents, 1800)
})

test('recordSellerEarning is idempotent on purchase_id — a retried call never double-credits', async () => {
  const db = makeFakeLedger()
  const input = { sellerUserId: 's1', purchaseId: 'purchase_1', sellerEarningCents: 800, currency: 'usd' }
  const r1 = await recordSellerEarning(db, input)
  const r2 = await recordSellerEarning(db, input)
  assert.equal(r1.recorded, true)
  assert.equal(r2.recorded, false)
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].balance_after_cents, 800)
})

test('recordSellerEarning accrues a running balance across separate purchases', async () => {
  const db = makeFakeLedger()
  await recordSellerEarning(db, { sellerUserId: 's1', purchaseId: 'purchase_1', sellerEarningCents: 800, currency: 'usd' })
  await recordSellerEarning(db, { sellerUserId: 's1', purchaseId: 'purchase_2', sellerEarningCents: 1600, currency: 'usd' })
  assert.equal(db.rows[1].balance_after_cents, 2400)
})
