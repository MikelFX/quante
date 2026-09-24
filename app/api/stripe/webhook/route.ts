import { after } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { upsertUser, getUserRecord } from '@/lib/tier'
import { FREE_PROJECT_LIMIT, AGENCY_PROJECT_LIMIT } from '@/lib/config'
import { CREDIT_PACKS, type CreditPack } from '@/lib/credit-packs'
import { grantCredits, debitCredits, refundDebit, getBalance } from '@/lib/credits'
import { isUuid } from '@/lib/auth/project'
import { clerkClient } from '@clerk/nextjs/server'
import type Stripe from 'stripe'
import { paymentConfirmedEmail, merchantNewOrderEmail, sendEmail } from '@/lib/email-templates'
import type { ShopManifest } from '@/types/manifest'
import { registerDomain, setDnsToVercel } from '@/lib/namecheap'
import { attachDomain, createPreviewDeployment, ensureProjectVercel, getOrClaimStoreSlug } from '@/lib/hosting/vercel'
import { detachFromVercel } from '@/app/api/domains/_lib/release'
import { getHostingGate } from '@/lib/hosting/gate'
import { buildStoreFiles, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import { insertDeploymentRow } from '@/lib/hosting/deployments'
import type { CodeVersionFiles } from '@/types/store-code'
import { getActivePartnerForProject, recordCommission } from '@/lib/partner-commission'
import { decrementStockForOrder } from '@/lib/payments/stock'
import { signedInvoiceUrl } from '@/lib/invoice-generator'

// Stripe webhook — every money-moving event for the platform.
//
// SECURITY notes (audit 2026-09-23):
//   - Handlers never trust amounts/credits from metadata: credit packs are resolved from
//     the server-side pack table by the amount actually paid (#31/#55).
//   - Credit grants/clawbacks go through lib/credits.ts (lock-serialised RPCs) (#31/#80).
//   - Subscription state is re-fetched from Stripe, so out-of-order or retried events
//     can't revive a canceled plan (#52).
//   - Refunds/disputes reverse credit packs and store earnings (#9/#80), and domain
//     purchases / hosting + protection invoices (R3); billing_hold is upserted so it
//     also lands on accounts without a public.users row (R4).
//   - Domain purchases claim the domain before registering and refund when it's taken
//     (#32); protection is only recorded once actually paid for (#68).
//   - A handler error returns 500 so Stripe retries; "nothing to do" returns 200 (a 4xx
//     makes Stripe retry for days and can get the endpoint disabled).

const ok = () => new Response('ok', { status: 200 })

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured.', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return new Response('Signature verification failed.', { status: 400 })
  }

  try {
    return await handleEvent(event)
  } catch (err) {
    console.error(`[webhook] ${event.type} (${event.id}) failed:`, err)
    return new Response('Webhook handler failed.', { status: 500 })
  }
}

async function handleEvent(event: Stripe.Event): Promise<Response> {
  // Stripe Connect (account.updated) is no longer handled: Connect is not part of the
  // payment flow and its onboarding routes were removed (audit F5). Such events fall
  // through to the final ok() below.

  // ── checkout.session.completed / async payment settled ──────────────────────
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, type, project_id: projectId } = session.metadata ?? {}

    // Store sale — record earning + notify the shop owner
    if (type === 'store_sale') {
      if (projectId) await recordStoreSale(projectId, session)
      return ok()
    }

    // Hosting / Agency subscriptions — the customer.subscription.* events handle these.
    if (type === 'hosting' || type === 'agency') return ok()

    // Domain purchase — register with Namecheap, attach to Vercel, record in DB
    if (type === 'domain_purchase') {
      if (userId) await handleDomainPurchase(session, userId)
      return ok()
    }

    // Only credit-pack sessions (type 'credits', or legacy sessions without a type)
    // reach the credit grant.
    if (type && type !== 'credits') {
      console.warn(`[webhook] checkout session ${session.id} has unknown type '${type}' — ignored`)
      return ok()
    }
    return handleCreditPurchase(session)
  }

  // ── Refunds / disputes (#9 store earnings, #80 credit packs) ─────────────────
  // Every dispute event is handled the same way (the dispute is re-fetched and its
  // CURRENT status decides), so subscribing to more of them is harmless.
  if (
    event.type === 'charge.refunded' ||
    event.type === 'charge.dispute.created' ||
    event.type === 'charge.dispute.updated' ||
    event.type === 'charge.dispute.closed' ||
    event.type === 'charge.dispute.funds_withdrawn' ||
    event.type === 'charge.dispute.funds_reinstated'
  ) {
    // Events for connected accounts' own charges are not ours to book.
    if (event.account) return ok()
    await handleChargeReversal(event)
    return ok()
  }

  // ── Subscription events (agency + hosting) ───────────────────────────────────
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleSubscriptionEvent(event.data.object as Stripe.Subscription)
    return ok()
  }

  // ── Paid subscription invoice → partner commission (bookkeeping only) ────────
  if (event.type === 'invoice.paid') {
    if (event.account) return ok()
    await handleInvoicePaid(event.data.object as Stripe.Invoice)
    return ok()
  }

  return ok()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

type PgError = { code?: string; message?: string } | null

function isMissingColumn(err: PgError): boolean {
  if (!err) return false
  return err.code === '42703' || err.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column/i.test(err.message ?? '')
}

// Insert that still works before supabase/migration-security-stripe-payments.sql is
// applied: if one of the `optional` columns doesn't exist yet, retry without them.
async function insertTolerant(
  table: string,
  row: Record<string, unknown>,
  optional: string[],
  select: string,
): Promise<{ data: Record<string, unknown> | null; error: PgError }> {
  let res = await supabaseAdmin.from(table).insert(row).select(select).single()
  if (res.error && isMissingColumn(res.error)) {
    console.warn(`[webhook] ${table}: optional column missing — run supabase/migration-security-stripe-payments.sql`)
    const stripped = Object.fromEntries(Object.entries(row).filter(([k]) => !optional.includes(k)))
    res = await supabaseAdmin.from(table).insert(stripped).select(select).single()
  }
  return { data: (res.data as Record<string, unknown> | null) ?? null, error: res.error }
}

// Returns how many rows were written (with ignoreDuplicates, 0 = the row already existed).
async function upsertTolerant(
  table: string,
  row: Record<string, unknown>,
  optional: string[],
  options: { onConflict: string; ignoreDuplicates?: boolean },
): Promise<{ error: PgError; written: number }> {
  let { data, error } = await supabaseAdmin.from(table).upsert(row, options).select('id')
  if (error && isMissingColumn(error)) {
    console.warn(`[webhook] ${table}: optional column missing — run supabase/migration-security-stripe-payments.sql`)
    const stripped = Object.fromEntries(Object.entries(row).filter(([k]) => !optional.includes(k)))
    ;({ data, error } = await supabaseAdmin.from(table).upsert(stripped, options).select('id'))
  }
  return { error, written: data?.length ?? 0 }
}

// ─── Adaptive Pricing ────────────────────────────────────────────────────────
// With Stripe Adaptive Pricing a session can be localized: session.currency /
// amount_total are then the CUSTOMER's presentment currency, and what we priced (and
// must compare against) is in session.currency_conversion. All amount checks and
// bookkeeping use the source (priced) currency.

function pricedAmount(session: Stripe.Checkout.Session): { amount: number | null; currency: string } {
  const cc = session.currency_conversion
  if (cc && typeof cc.amount_total === 'number' && cc.source_currency) {
    return { amount: cc.amount_total, currency: cc.source_currency.toLowerCase() }
  }
  return { amount: session.amount_total ?? null, currency: (session.currency ?? '').toLowerCase() }
}

// Converts an amount charged/refunded/disputed in the presentment currency back to the
// session's source currency (pro rata), so refunds land in the same payout bucket as
// the sale they reverse.
function toPricedAmount(
  session: Stripe.Checkout.Session,
  amount: number,
  currency: string,
): { amount: number; currency: string } {
  const cc = session.currency_conversion
  const cur = currency.toLowerCase()
  const presentment = (session.currency ?? '').toLowerCase()
  const total = session.amount_total ?? 0
  if (cc && cc.source_currency && cur === presentment && cc.source_currency.toLowerCase() !== cur && total > 0) {
    return {
      amount: Math.min(cc.amount_total, Math.round((amount * cc.amount_total) / total)),
      currency: cc.source_currency.toLowerCase(),
    }
  }
  return { amount, currency: cur }
}

// ─── Credit pack purchase (#31 / #55) ────────────────────────────────────────

// The pack is resolved from the SERVER-SIDE table by what was actually paid — never
// from metadata.credits. packId is only a hint; if its price changed since the session
// was created, the pack whose price matches the paid amount is used instead.
function resolvePaidPack(session: Stripe.Checkout.Session): CreditPack | null {
  const { amount: paid, currency } = pricedAmount(session)
  if (typeof paid !== 'number' || !Number.isInteger(paid) || paid <= 0) return null
  if (currency !== 'usd') return null
  const hinted = CREDIT_PACKS.find((p) => p.id === session.metadata?.packId)
  if (hinted && hinted.priceCents === paid) return hinted
  return CREDIT_PACKS.find((p) => p.priceCents === paid) ?? null
}

async function handleCreditPurchase(session: Stripe.Checkout.Session): Promise<Response> {
  const userId = session.metadata?.userId
  if (!userId) {
    console.error(`[webhook] credit session ${session.id} has no userId — ignored`)
    return ok()
  }

  // Async payment methods complete unpaid; checkout.session.async_payment_succeeded
  // brings the session back here once the money is in.
  if (session.payment_status !== 'paid') return ok()

  const pack = resolvePaidPack(session)
  if (!pack) {
    console.error(
      `[webhook] BILLING REVIEW: credit session ${session.id} paid ${session.amount_total} ${session.currency} ` +
      `(priced ${pricedAmount(session).amount} ${pricedAmount(session).currency}) ` +
      `which matches no credit pack (packId=${session.metadata?.packId}) — no credits granted, needs manual review.`,
    )
    return ok()
  }

  // purchases.stripe_session_id is UNIQUE: insert first, and on a retry reuse the row.
  // The grant below is idempotent per (user, 'purchase', purchase.id), so a retry after
  // a failed grant completes it instead of being stuck at "already processed".
  const inserted = await insertTolerant(
    'purchases',
    {
      user_id: userId,
      stripe_session_id: session.id,
      credits: pack.credits,
      amount_cents: pack.priceCents, // USD cents actually priced (see pricedAmount)
      stripe_payment_intent_id: idOf(session.payment_intent),
      stripe_customer_id: idOf(session.customer),
    },
    ['stripe_payment_intent_id', 'stripe_customer_id'],
    'id, user_id',
  )

  let purchase = inserted.data as { id: string; user_id: string } | null
  if (inserted.error) {
    if (inserted.error.code !== '23505') {
      console.error('Failed to record purchase:', inserted.error)
      return new Response('Failed to record purchase.', { status: 500 })
    }
    const { data: existing } = await supabaseAdmin
      .from('purchases')
      .select('id, user_id')
      .eq('stripe_session_id', session.id)
      .maybeSingle()
    purchase = existing as { id: string; user_id: string } | null
  }

  if (!purchase || purchase.user_id !== userId) {
    console.error(`[webhook] purchase row for session ${session.id} missing or owned by another user`)
    return new Response('Purchase record inconsistent.', { status: 500 })
  }

  const grant = await grantCredits(userId, pack.credits, 'purchase', purchase.id)
  if (!grant.ok) {
    console.error('Failed to update ledger:', grant.error)
    return new Response('Failed to update credit ledger.', { status: 500 })
  }
  return ok()
}

// ─── Refunds & disputes (#9 / #80) ───────────────────────────────────────────

async function findCheckoutSession(paymentIntentId: string): Promise<Stripe.Checkout.Session | null> {
  const list = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })
  return list.data[0] ?? null
}

async function handleChargeReversal(event: Stripe.Event): Promise<void> {
  let paymentIntentId: string | null
  let charge: Stripe.Charge | null = null
  let dispute: Stripe.Dispute | null = null

  if (event.type === 'charge.refunded') {
    // Re-fetch: amount_refunded is cumulative, and the fresh value makes retried or
    // out-of-order deliveries harmless.
    charge = await stripe.charges.retrieve((event.data.object as Stripe.Charge).id)
    paymentIntentId = idOf(charge.payment_intent)
  } else {
    dispute = await stripe.disputes.retrieve((event.data.object as Stripe.Dispute).id)
    paymentIntentId = idOf(dispute.payment_intent)
  }
  if (!paymentIntentId) return

  const session = await findCheckoutSession(paymentIntentId)
  if (!session) {
    // Subscription invoices (hosting, domain protection, agency) are paid by a
    // PaymentIntent that no checkout session references (R3).
    if (dispute) await reverseSubscriptionInvoiceDispute(paymentIntentId, dispute)
    return
  }
  const meta = session.metadata ?? {}

  if (meta.type === 'store_sale' && meta.project_id) {
    await reverseStoreEarning(meta.project_id, session, paymentIntentId, charge, dispute)
    return
  }

  if (meta.type === 'domain_purchase') {
    await reverseDomainPurchase(session, charge, dispute)
    return
  }

  if (!meta.type || meta.type === 'credits') {
    await reverseCreditPurchase(session, charge, dispute)
  }
}

// ─── Domain purchase / subscription invoice reversals (R3) ───────────────────
//
// A charged-back domain purchase used to leave the domain 'active', attached to the
// buyer's store and flagged nowhere. Now:
//   - dispute with funds withdrawn → billing_hold, user_domains row → 'disputed',
//     detached (apex + www) from Vercel, protection add-on canceled.
//   - dispute won / closed as an inquiry → row back to 'active' (NOT re-attached: the
//     owner re-assigns it to a store from the Domains panel), hold lifted if nothing
//     else is outstanding.
//   - full refund we did NOT issue ourselves (refundDomainSession) → row soft-deleted
//     ('expired', the same state the owner's own delete leaves a bought domain in),
//     detached, protection canceled. No billing hold: a refund is our own decision.
// Every step is idempotent, so Stripe's duplicate / out-of-order deliveries converge.
//
// user_domains.status is also written by the owner's own routes (DELETE → 'expired',
// connect → 'pending'/'active'), so it can't be what keeps an account held. Every
// non-credit-pack chargeback is therefore recorded in billing_disputes (webhook-only,
// keyed by the Stripe dispute id), and maybeClearBillingHold checks that table.

const DOMAIN_DISPUTED_STATUS = 'disputed'

type DisputeKind = 'domain_purchase' | 'hosting' | 'domain_protection' | 'agency'

// open = funds withdrawn and still contested; lost = final; resolved = won, or an
// inquiry that never took money. Holds are kept while any row is open or lost.
function disputeRecordStatus(dispute: Stripe.Dispute): 'open' | 'lost' | 'resolved' {
  if (dispute.status === 'lost') return 'lost'
  return disputeWithdrewFunds(dispute) ? 'open' : 'resolved'
}

function isMissingRelation(err: PgError): boolean {
  if (!err) return false
  return err.code === '42P01' || err.code === 'PGRST205'
    || /relation .* does not exist|could not find the table/i.test(err.message ?? '')
}

// Upserts the dispute's CURRENT state (the dispute is re-fetched before we get here), so
// retries and out-of-order deliveries converge. Throws so Stripe retries — including
// when the table is missing: the delivery then succeeds once the migration has run.
async function recordDispute(dispute: Stripe.Dispute, userId: string, kind: DisputeKind, refId: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('billing_disputes')
    .upsert(
      {
        dispute_id: dispute.id,
        user_id: userId,
        kind,
        ref_id: refId,
        status: disputeRecordStatus(dispute),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'dispute_id' },
    )
  if (error) {
    throw new Error(
      `billing_disputes upsert for ${dispute.id} failed` +
      (isMissingRelation(error) ? ' — run supabase/migration-security3-webhook-secrets-qads.sql' : '') +
      `: ${error.message}`,
    )
  }
}

// Runs a protective step without letting its failure skip the ones after it; the first
// failure is rethrown at the end (runSteps) so Stripe retries the whole, idempotent set.
async function runSteps(steps: Array<() => Promise<void>>): Promise<void> {
  let first: unknown = null
  for (const step of steps) {
    try {
      await step()
    } catch (err) {
      if (first === null) first = err
      console.error('[webhook] reversal step failed:', err)
    }
  }
  if (first !== null) throw first
}

type DomainReversalRow = {
  id: string
  user_id: string
  domain: string
  status: string
  vercel_project_id: string | null
  stripe_subscription_id: string | null
  protection_enabled: boolean | null
}

async function cancelSubscriptionIfLive(subscriptionId: string, why: string): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return
    await stripe.subscriptions.cancel(subscriptionId, { prorate: false })
    console.warn(`[webhook] canceled subscription ${subscriptionId} (${why})`)
  } catch (err) {
    const e = err as { code?: string; statusCode?: number }
    if (e.code === 'resource_missing' || e.statusCode === 404) return
    throw err
  }
}

// Detach the domain (apex + the www variant handleDomainPurchase adds) from its Vercel
// project and forget the attachment. Throws on a Vercel failure so Stripe retries.
async function detachDisputedDomain(row: DomainReversalRow): Promise<void> {
  const hosts = row.domain.split('.').length === 2 ? [row.domain, `www.${row.domain}`] : [row.domain]
  if (row.vercel_project_id) {
    for (const host of hosts) await detachFromVercel(row.vercel_project_id, host)
    const { error } = await supabaseAdmin
      .from('user_domains')
      .update({ vercel_project_id: null, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) throw new Error(`user_domains detach update failed: ${error.message}`)
  }

  // The same name may also have been set as a store's custom domain through
  // /api/hosting/domain (projects.custom_domain) — detach and clear that too.
  const { data: projects, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('id, custom_domain, vercel_project_id')
    .eq('user_id', row.user_id)
    .in('custom_domain', hosts)
  if (projErr) throw new Error(`custom_domain lookup for ${row.domain} failed: ${projErr.message}`)
  for (const p of (projects ?? []) as Array<{ id: string; custom_domain: string; vercel_project_id: string | null }>) {
    if (p.vercel_project_id) await detachFromVercel(p.vercel_project_id, p.custom_domain)
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ custom_domain: null, custom_domain_verified: false })
      .eq('id', p.id)
      .eq('custom_domain', p.custom_domain)
    if (error) throw new Error(`custom_domain clear for project ${p.id} failed: ${error.message}`)
  }
}

async function disableDomainProtection(row: DomainReversalRow): Promise<void> {
  if (row.stripe_subscription_id) {
    await cancelSubscriptionIfLive(row.stripe_subscription_id, `domain ${row.domain} reversed`)
  }
  if (row.protection_enabled || row.stripe_subscription_id) {
    const { error } = await supabaseAdmin
      .from('user_domains')
      .update({ protection_enabled: false, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) throw new Error(`user_domains protection update failed: ${error.message}`)
  }
}

// Refunds we issue ourselves when a purchase fails (refundDomainSession) carry this
// metadata type — those must not be treated as a customer-side reversal.
async function isOwnDomainFailureRefund(chargeId: string): Promise<boolean> {
  const refunds = await stripe.refunds.list({ charge: chargeId, limit: 20 })
  return refunds.data.some((r) => r.metadata?.type === 'domain_purchase_failed')
}

async function reverseDomainPurchase(
  session: Stripe.Checkout.Session,
  charge: Stripe.Charge | null,
  dispute: Stripe.Dispute | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('user_domains')
    .select('id, user_id, domain, status, vercel_project_id, stripe_subscription_id, protection_enabled')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (error) throw new Error(`user_domains lookup for session ${session.id} failed: ${error.message}`)
  const row = data as DomainReversalRow | null
  // No row: the purchase failed and was refunded by us (the row is deleted before
  // refundDomainSession runs), or registration never started. Nothing is held.
  if (!row) return
  const now = new Date().toISOString()

  if (dispute) {
    if (!disputeWithdrewFunds(dispute)) {
      // Won, or an inquiry that never took money: undo an earlier dispute lock.
      await recordDispute(dispute, row.user_id, 'domain_purchase', row.id)
      if (row.status === DOMAIN_DISPUTED_STATUS) {
        const { error: upErr } = await supabaseAdmin
          .from('user_domains')
          .update({ status: 'active', updated_at: now })
          .eq('id', row.id)
          .eq('status', DOMAIN_DISPUTED_STATUS)
        if (upErr) throw new Error(`user_domains dispute clear failed: ${upErr.message}`)
        console.warn(`[webhook] domain ${row.domain}: dispute ${dispute.id} resolved in our favour — row re-activated (not re-attached)`)
      }
      await maybeClearBillingHold(row.user_id)
      return
    }

    await setBillingHold(row.user_id)
    // Every dispute event (created / updated / funds_withdrawn / closed) re-runs this, so
    // a re-attach or status change the owner made in between is undone again.
    await runSteps([
      () => recordDispute(dispute, row.user_id, 'domain_purchase', row.id),
      async () => {
        if (row.status === DOMAIN_DISPUTED_STATUS) return
        const { error: upErr } = await supabaseAdmin
          .from('user_domains')
          .update({ status: DOMAIN_DISPUTED_STATUS, updated_at: now })
          .eq('id', row.id)
          .eq('status', row.status)
        if (upErr) throw new Error(`user_domains dispute update failed: ${upErr.message}`)
      },
      () => detachDisputedDomain(row),
      () => disableDomainProtection(row),
    ])
    console.error(
      `[SECURITY][webhook] domain ${row.domain} (user ${row.user_id}) charged back — dispute ${dispute.id} ` +
      `(${dispute.status}); domain detached, protection canceled, account on billing_hold.`,
    )
    return
  }

  if (charge) {
    // Only a FULL refund releases the domain; a partial one is a goodwill credit.
    if (!charge.refunded) return
    if (row.status === 'expired' || row.status === DOMAIN_DISPUTED_STATUS) return
    if (await isOwnDomainFailureRefund(charge.id)) return
    const { error: upErr } = await supabaseAdmin
      .from('user_domains')
      .update({ status: 'expired', updated_at: now })
      .eq('id', row.id)
      .eq('status', row.status)
    if (upErr) throw new Error(`user_domains refund update failed: ${upErr.message}`)
    await detachDisputedDomain(row)
    await disableDomainProtection(row)
    console.warn(`[webhook] domain ${row.domain} (user ${row.user_id}) fully refunded — detached, protection canceled`)
  }
}

// Invoice behind a PaymentIntent. On the pinned API version (2025-01-27.acacia) the
// charge still carries `invoice`; newer versions expose it through InvoicePayments.
async function invoiceIdForPayment(paymentIntentId: string, dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = idOf(dispute.charge as string | { id: string } | null)
  if (chargeId) {
    const charge = await stripe.charges.retrieve(chargeId)
    const legacy = idOf((charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null)
    if (legacy) return legacy
  }
  try {
    const payments = await stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      limit: 1,
    })
    return idOf(payments.data[0]?.invoice as string | { id: string } | null | undefined)
  } catch {
    return null // endpoint unavailable on this API version
  }
}

// A charged-back subscription invoice: hosting (per project), domain protection or
// Agency. Only disputes are handled — refunds of subscription invoices are issued by us.
async function reverseSubscriptionInvoiceDispute(paymentIntentId: string, dispute: Stripe.Dispute): Promise<void> {
  const invoiceId = await invoiceIdForPayment(paymentIntentId, dispute)
  if (!invoiceId) return
  const invoice = await stripe.invoices.retrieve(invoiceId)
  const subId = subscriptionIdOfInvoice(invoice)
  if (!subId) return

  let sub: Stripe.Subscription
  try {
    sub = await stripe.subscriptions.retrieve(subId)
  } catch (err) {
    const e = err as { code?: string; statusCode?: number }
    if (e.code === 'resource_missing' || e.statusCode === 404) return
    throw err
  }
  const meta = sub.metadata ?? {}
  const withdrawn = disputeWithdrewFunds(dispute)
  const now = new Date().toISOString()

  // ── Domain protection add-on ──
  if (meta.type === 'domain_protection') {
    const userId = meta.userId || (await ownerOfProtectionSubscription(sub.id))
    if (!userId) {
      console.error(`[SECURITY][webhook] protection ${sub.id} disputed (${dispute.id}) but no owner found — review manually`)
      return
    }
    if (!withdrawn) {
      // Won / inquiry: protection stays canceled (the owner can re-buy it); the hold is
      // lifted if nothing else is outstanding.
      await recordDispute(dispute, userId, 'domain_protection', sub.id)
      await maybeClearBillingHold(userId)
      return
    }
    await setBillingHold(userId)
    await runSteps([
      () => recordDispute(dispute, userId, 'domain_protection', sub.id),
      () => cancelSubscriptionIfLive(sub.id, `protection invoice ${invoiceId} charged back`),
      async () => {
        const { error } = await supabaseAdmin
          .from('user_domains')
          .update({ protection_enabled: false, updated_at: now })
          .eq('stripe_subscription_id', sub.id)
        if (error) throw new Error(`user_domains protection update failed: ${error.message}`)
      },
    ])
    console.error(`[SECURITY][webhook] domain protection ${sub.id} charged back (dispute ${dispute.id}) — canceled`)
    return
  }

  // ── Agency plan: flag only; the plan's own subscription events handle the tier ──
  if (meta.type === 'agency') {
    const userId = meta.userId || (await ownerOfAgencySubscription(sub.id))
    if (!userId) {
      console.error(`[SECURITY][webhook] agency ${sub.id} disputed (${dispute.id}) but no owner found — review manually`)
      return
    }
    if (!withdrawn) {
      await recordDispute(dispute, userId, 'agency', sub.id)
      await maybeClearBillingHold(userId)
      return
    }
    await setBillingHold(userId)
    await recordDispute(dispute, userId, 'agency', sub.id)
    console.error(
      `[SECURITY][webhook] agency invoice ${invoiceId} (user ${userId}) charged back — dispute ${dispute.id}; ` +
      'account on billing_hold, subscription left for manual review.',
    )
    return
  }

  // ── Hosting subscription (per project) ──
  const { userId, projectId } = meta
  if (!userId || !projectId || !isUuid(projectId)) return

  if (!withdrawn) {
    // Won / inquiry: lift the dispute marker. The subscription stays canceled — the
    // owner can resubscribe; the hold is lifted if nothing else is outstanding.
    await recordDispute(dispute, userId, 'hosting', sub.id)
    const { error } = await supabaseAdmin
      .from('hosting_subscriptions')
      .update({ disputed_at: null, updated_at: now })
      .eq('stripe_subscription_id', sub.id)
      .not('disputed_at', 'is', null)
    if (error && !isMissingColumn(error)) throw new Error(`hosting dispute clear failed: ${error.message}`)
    await maybeClearBillingHold(userId)
    return
  }

  await setBillingHold(userId)
  // Recorded first; a failure (e.g. table not migrated yet) is rethrown only after the
  // hosting below has been stopped, so Stripe retries until the marker lands.
  const recordErr = await recordDispute(dispute, userId, 'hosting', sub.id).then(() => null, (err: unknown) => err)

  // Mark the subscription row (kept across later subscription upserts, which never send
  // disputed_at) so maybeClearBillingHold knows a hosting dispute is still open.
  const { error: markErr } = await supabaseAdmin
    .from('hosting_subscriptions')
    .update({ disputed_at: now, updated_at: now })
    .eq('stripe_subscription_id', sub.id)
    .is('disputed_at', null)
  if (markErr) {
    if (isMissingColumn(markErr)) {
      console.warn('[webhook] hosting_subscriptions.disputed_at missing — run supabase/migration-security3-webhook-secrets-qads.sql')
    } else {
      throw new Error(`hosting dispute mark failed: ${markErr.message}`)
    }
  }

  // Stop the paid hosting: cancel the subscription now (its customer.subscription.deleted
  // event re-syncs the row) and mirror that locally so the hosting gate reacts at once.
  await cancelSubscriptionIfLive(sub.id, `hosting invoice ${invoiceId} charged back`)
  const { error: subErr } = await supabaseAdmin
    .from('hosting_subscriptions')
    .update({ status: 'canceled', updated_at: now })
    .eq('stripe_subscription_id', sub.id)
  if (subErr) throw new Error(`hosting_subscriptions cancel update failed: ${subErr.message}`)

  // No free trial remainder after a chargeback: end it now. The hosting gate then
  // refuses production deploys immediately, and the daily hosting cron swaps the live
  // store for the maintenance page and marks it suspended (its usual, confirmed path).
  const { error: trialErr } = await supabaseAdmin
    .from('projects')
    .update({ hosting_trial_ends_at: now, updated_at: now })
    .eq('id', projectId)
    .eq('user_id', userId)
    .gt('hosting_trial_ends_at', now)
  if (trialErr) throw new Error(`hosting trial end update failed: ${trialErr.message}`)

  console.error(
    `[SECURITY][webhook] hosting invoice ${invoiceId} for project ${projectId} (user ${userId}) charged back — ` +
    `dispute ${dispute.id}; subscription ${sub.id} canceled, trial ended, account on billing_hold.`,
  )
  if (recordErr) throw recordErr
}

// Fallback owners when a subscription's metadata lacks userId.
async function ownerOfProtectionSubscription(subscriptionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_domains')
    .select('user_id')
    .eq('stripe_subscription_id', subscriptionId)
    .limit(1)
  if (error) throw new Error(`protection owner lookup failed: ${error.message}`)
  return ((data ?? [])[0] as { user_id?: string } | undefined)?.user_id ?? null
}

async function ownerOfAgencySubscription(subscriptionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .limit(1)
  if (error) throw new Error(`agency owner lookup failed: ${error.message}`)
  return ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null
}

// Dispute statuses in which the money has actually been taken from us. Inquiries
// (warning_needs_response / warning_under_review / warning_closed) move no money, and
// 'won' means it was reinstated — those reverse nothing (or undo an earlier reversal).
const FUNDS_WITHDRAWN_DISPUTE_STATUSES = new Set<string>(['needs_response', 'under_review', 'lost'])

function disputeWithdrewFunds(dispute: Stripe.Dispute): boolean {
  return FUNDS_WITHDRAWN_DISPUTE_STATUSES.has(dispute.status)
}

// Negative store_earnings rows, keyed for idempotency ('refund:<charge>' holds the
// cumulative refunded amount; 'dispute:<id>' the disputed amount while the funds are
// withdrawn, 0 for inquiries and won disputes). Upserted with the CURRENT value, so
// retries and out-of-order deliveries converge.
async function reverseStoreEarning(
  projectId: string,
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  charge: Stripe.Charge | null,
  dispute: Stripe.Dispute | null,
): Promise<void> {
  let key: string
  let rawAmount: number
  let rawCurrency: string
  let kind: 'refund' | 'dispute'

  if (charge) {
    key = `refund:${charge.id}`
    rawAmount = charge.amount_refunded
    rawCurrency = charge.currency
    kind = 'refund'
  } else if (dispute) {
    key = `dispute:${dispute.id}`
    rawAmount = disputeWithdrewFunds(dispute) ? dispute.amount : 0
    rawCurrency = dispute.currency
    kind = 'dispute'
  } else {
    return
  }
  // Same currency bucket as the sale (store_earnings are booked in the priced currency).
  const { amount, currency } = toPricedAmount(session, rawAmount, rawCurrency)

  const { error } = await upsertTolerant(
    'store_earnings',
    {
      project_id: projectId,
      stripe_session_id: key,
      gross_amount_cents: -amount,
      platform_fee_cents: 0,
      net_amount_cents: -amount,
      currency,
      customer_email: null,
      customer_name: null,
      kind,
      stripe_payment_intent_id: paymentIntentId,
    },
    ['kind', 'stripe_payment_intent_id'],
    { onConflict: 'stripe_session_id' },
  )
  if (error) throw new Error(`store_earnings adjustment failed: ${error.message}`)

  const orderId = session.metadata?.order_id
  if (charge && orderId && charge.refunded) {
    await supabaseAdmin
      .from('store_orders')
      .update({ payment_status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('payment_status', 'paid')
  }
  console.warn(`[webhook] store ${projectId}: ${kind} ${key} → -${amount} ${currency}`)
}

// R4: an UPSERT, not an UPDATE. public.users rows are only created by the Agency flow
// (lib/tier.ts upsertUser), so for an ordinary credit buyer an UPDATE matched 0 rows
// and the hold was silently never applied. The upsert payload carries only id +
// billing_hold, so an existing row keeps its tier / subscription / limits (PostgREST
// only sets the columns sent), and a new row gets the column defaults (tier 'free',
// project_limit 3) — exactly what getUserRecord already reports for a missing row.
//
// Throws on failure so the event is retried (every caller is idempotent): a hold that
// silently isn't applied is exactly the R4 failure.
async function setBillingHold(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('users')
    .upsert({ id: userId, billing_hold: true }, { onConflict: 'id' })
  if (error) {
    console.error(`[SECURITY][webhook] could not set billing_hold for ${userId}:`, error.message)
    throw new Error(`billing_hold upsert for ${userId} failed: ${error.message}`)
  }
}

// Lift the hold once nothing on the account is still charged back or unrecovered: no
// disputed / unrecovered credit pack (purchases), and no open or lost chargeback on a
// domain purchase, hosting, domain protection or Agency invoice (billing_disputes — only
// this webhook writes it). Fails closed: when anything can't be checked the hold stays;
// lookup / update errors throw so Stripe retries.
async function maybeClearBillingHold(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('purchases')
    .select('id')
    .eq('user_id', userId)
    .or('status.in.(disputed,dispute_lost),clawback_shortfall.gt.0')
    .limit(1)
  if (error) throw new Error(`billing_hold purchases check for ${userId} failed: ${error.message}`)
  if ((data ?? []).length > 0) return

  const { data: disputes, error: dispErr } = await supabaseAdmin
    .from('billing_disputes')
    .select('dispute_id')
    .eq('user_id', userId)
    .in('status', ['open', 'lost'])
    .limit(1)
  if (dispErr) {
    if (isMissingRelation(dispErr)) {
      // Can't tell whether a non-credit chargeback is outstanding → keep the hold.
      console.warn(`[webhook] billing_disputes missing — hold kept for ${userId}; run supabase/migration-security3-webhook-secrets-qads.sql`)
      return
    }
    throw new Error(`billing_hold dispute check for ${userId} failed: ${dispErr.message}`)
  }
  if ((disputes ?? []).length > 0) return

  // Belt and braces for rows marked before billing_disputes existed. These can only
  // KEEP a hold, never lift one.
  const { data: domains, error: domErr } = await supabaseAdmin
    .from('user_domains')
    .select('id')
    .eq('user_id', userId)
    .eq('status', DOMAIN_DISPUTED_STATUS)
    .limit(1)
  if (domErr) throw new Error(`billing_hold domain check for ${userId} failed: ${domErr.message}`)
  if ((domains ?? []).length > 0) return

  const { data: hosting, error: hostErr } = await supabaseAdmin
    .from('hosting_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .not('disputed_at', 'is', null)
    .limit(1)
  if (hostErr && !isMissingColumn(hostErr)) {
    throw new Error(`billing_hold hosting check for ${userId} failed: ${hostErr.message}`)
  }
  if ((hosting ?? []).length > 0) return

  const { error: upErr } = await supabaseAdmin.from('users').update({ billing_hold: false }).eq('id', userId)
  if (upErr) throw new Error(`could not clear billing_hold for ${userId}: ${upErr.message}`)
}

type PurchaseRow = {
  id: string
  user_id: string
  credits: number
  refunded_credits: number | null
  clawback_shortfall: number | null
  chargeback_credits: number | null
  status: string | null
}

// State machine on purchases.status (every transition is a compare-and-set, so
// duplicate / concurrent / out-of-order deliveries can't apply anything twice):
//   paid | partially_refunded | refunded  --chargeback-->  disputed  --lost-->  dispute_lost
//                                                           disputed  --won / inquiry closed-->  dispute_won
// refunded_credits = credits reversed so far (refund slice + chargeback slice);
// chargeback_credits = the chargeback slice, so a won dispute restores exactly that.
async function reverseCreditPurchase(
  session: Stripe.Checkout.Session,
  charge: Stripe.Charge | null,
  dispute: Stripe.Dispute | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('purchases')
    .select('id, user_id, credits, refunded_credits, clawback_shortfall, chargeback_credits, status')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (error) {
    // Most likely the clawback columns don't exist yet — fail so Stripe retries once
    // the migration is applied, rather than silently keeping the credits.
    throw new Error(`purchases lookup failed (run migration-security-stripe-payments.sql?): ${error.message}`)
  }
  const purchase = data as PurchaseRow | null
  if (!purchase) return // grant never happened (or legacy row missing) — nothing to reverse

  const credits = Number(purchase.credits) || 0
  const state = purchase.status ?? 'paid'
  const chargedBack = state === 'disputed' || state === 'dispute_lost'

  if (dispute) {
    if (!disputeWithdrewFunds(dispute)) {
      // Won, or an inquiry (warning_*) that never took money: nothing to claw back,
      // and an earlier chargeback clawback is undone.
      await reinstateChargeback(purchase)
      return
    }
    if (!chargedBack) {
      await setBillingHold(purchase.user_id)
      await applyClawback(purchase, credits, 'chargeback', 'disputed') // the whole pack
    }
    if (dispute.status === 'lost') {
      await supabaseAdmin
        .from('purchases')
        .update({ status: 'dispute_lost' })
        .eq('id', purchase.id)
        .eq('status', 'disputed')
    }
    return
  }

  if (charge) {
    if (chargedBack) return // the chargeback already reversed the whole pack
    const fraction = charge.amount > 0 ? Math.min(1, charge.amount_refunded / charge.amount) : 1
    const target = charge.refunded ? credits : Math.min(credits, Math.round(credits * fraction))
    await applyClawback(purchase, target, 'purchase_refund', target >= credits ? 'refunded' : 'partially_refunded')
  }
}

async function applyClawback(
  purchase: PurchaseRow,
  target: number,
  reason: 'purchase_refund' | 'chargeback',
  newStatus: string,
): Promise<void> {
  const already = Number(purchase.refunded_credits) || 0
  const prevStatus = purchase.status ?? 'paid'
  const prevChargeback = Number(purchase.chargeback_credits) || 0
  const delta = target - already
  if (delta <= 0) {
    // Already clawed back — but if the earlier delivery recorded a shortfall and then
    // failed to set the hold (setBillingHold threw), this retry must still set it.
    if ((Number(purchase.clawback_shortfall) || 0) > 0) await setBillingHold(purchase.user_id)
    return
  }

  // Claim this slice of the clawback (compare-and-set on refunded_credits + status) so a
  // duplicate/concurrent delivery can never debit twice.
  const { data: claimed } = await supabaseAdmin
    .from('purchases')
    .update({
      refunded_credits: target,
      status: newStatus,
      ...(reason === 'chargeback' ? { chargeback_credits: delta } : {}),
    })
    .eq('id', purchase.id)
    .eq('refunded_credits', already)
    .eq('status', prevStatus)
    .select('id')
    .maybeSingle()
  if (!claimed) throw new Error(`clawback for purchase ${purchase.id} raced with another delivery — retry`)

  // Debit as much as the user still has (the balance may not go negative); whatever
  // they already spent is recorded as a shortfall and the account is flagged.
  let debited = 0
  for (let attempt = 0; attempt < 3 && debited === 0; attempt++) {
    const balance = await getBalance(purchase.user_id)
    const amount = Math.min(delta, balance)
    if (amount <= 0) break
    const res = await debitCredits(purchase.user_id, amount, reason, purchase.id, { ignoreBillingHold: true })
    if (res.ok) {
      debited = amount
    } else if (res.error !== 'insufficient_credits') {
      // Undo the claim so Stripe's retry does the clawback again.
      await supabaseAdmin
        .from('purchases')
        .update({ refunded_credits: already, status: prevStatus, chargeback_credits: prevChargeback })
        .eq('id', purchase.id)
        .eq('refunded_credits', target)
        .eq('status', newStatus)
      throw new Error(`clawback debit failed: ${res.error}`)
    }
  }

  const shortfall = delta - debited
  if (shortfall > 0) {
    await supabaseAdmin
      .from('purchases')
      .update({ clawback_shortfall: (Number(purchase.clawback_shortfall) || 0) + shortfall })
      .eq('id', purchase.id)
    await setBillingHold(purchase.user_id)
    console.error(
      `[SECURITY][credits] ${reason} on purchase ${purchase.id}: user ${purchase.user_id} had already spent ` +
      `${shortfall} of ${delta} credits — clawed back ${debited}, account flagged (billing_hold) for review.`,
    )
  } else {
    console.warn(`[webhook] ${reason}: clawed back ${debited} credits from ${purchase.user_id} (purchase ${purchase.id})`)
  }
}

// Undo a chargeback clawback after the dispute was won (or turned out to be an inquiry).
async function reinstateChargeback(purchase: PurchaseRow): Promise<void> {
  const state = purchase.status ?? 'paid'
  if (state !== 'disputed' && state !== 'dispute_won') return

  if (state === 'disputed') {
    const already = Number(purchase.refunded_credits) || 0
    const chargebackSlice = Number(purchase.chargeback_credits) || 0

    // What the chargeback actually debited; the rest of its slice was a shortfall.
    const { data: rows, error } = await supabaseAdmin
      .from('credit_ledger')
      .select('delta')
      .eq('user_id', purchase.user_id)
      .eq('ref_id', purchase.id)
      .eq('reason', 'chargeback')
    if (error) throw new Error(`chargeback ledger lookup failed: ${error.message}`)
    const debited = (rows ?? []).reduce((s, r) => s + Math.max(0, -Number((r as { delta: number }).delta)), 0)
    const shortfallPart = Math.max(0, chargebackSlice - debited)

    // Compare-and-set: only the first delivery moves disputed → dispute_won, so the
    // chargeback slice is subtracted from refunded_credits exactly once.
    const { data: claimed } = await supabaseAdmin
      .from('purchases')
      .update({
        status: 'dispute_won',
        refunded_credits: Math.max(0, already - chargebackSlice),
        chargeback_credits: 0,
        clawback_shortfall: Math.max(0, (Number(purchase.clawback_shortfall) || 0) - shortfallPart),
      })
      .eq('id', purchase.id)
      .eq('status', 'disputed')
      .eq('refunded_credits', already)
      .select('id')
      .maybeSingle()
    if (!claimed) throw new Error(`dispute reinstatement for purchase ${purchase.id} raced with another delivery — retry`)
  }

  // Give back what the chargeback debited. refundDebit is capped at (debited under
  // 'chargeback' − already returned under 'chargeback_reversed'), so a retry after a
  // failure here completes it and a duplicate delivery grants nothing.
  const refund = await refundDebit(purchase.user_id, purchase.id, 'chargeback', 'chargeback_reversed')
  if (!refund.ok) throw new Error(`chargeback reversal for purchase ${purchase.id} failed`)
  if (refund.refunded > 0) {
    console.warn(`[webhook] dispute resolved in our favour: returned ${refund.refunded} credits to ${purchase.user_id} (purchase ${purchase.id})`)
  }
  await maybeClearBillingHold(purchase.user_id)
}

// ─── Subscriptions (#52) ─────────────────────────────────────────────────────

function periodEndOf(sub: Stripe.Subscription): string | null {
  // current_period_end moved from the subscription to its items in newer API versions.
  const raw = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? sub.items?.data?.[0]?.current_period_end
  return typeof raw === 'number' ? new Date(raw * 1000).toISOString() : null
}

const TERMINAL_AGENCY_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired'])

async function handleSubscriptionEvent(eventSub: Stripe.Subscription): Promise<void> {
  // Never trust the event payload's status: Stripe doesn't guarantee delivery order and
  // retries old events for days. The live object is authoritative.
  let sub: Stripe.Subscription
  try {
    sub = await stripe.subscriptions.retrieve(eventSub.id)
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })
    if (code.code === 'resource_missing' || code.statusCode === 404) {
      sub = { ...eventSub, status: 'canceled' } as Stripe.Subscription
    } else {
      throw err
    }
  }

  const meta = sub.metadata ?? {}
  const periodEnd = periodEndOf(sub)
  const isActive = sub.status === 'active' || sub.status === 'trialing'
  const customerId = idOf(sub.customer as string | { id: string })

  // ── Agency subscription ─────────────────────────────────────────────────
  if (meta.type === 'agency' && meta.userId) {
    const userId = meta.userId
    const record = await getUserRecord(userId)

    // An event for an OLDER subscription must not clobber the user's current one.
    if (record.stripe_subscription_id && record.stripe_subscription_id !== sub.id && !isActive) return

    if (isActive) {
      await upsertUser(userId, {
        tier: 'agency',
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        subscription_status: sub.status,
        current_period_end: periodEnd,
        project_limit: AGENCY_PROJECT_LIMIT,
      })
    } else {
      // past_due / unpaid / incomplete / canceled — not paid, so no agency limits.
      // Credit balance is kept; excess projects are archived once the subscription is
      // definitively over (a past_due card may still recover).
      await upsertUser(userId, {
        tier: 'credit',
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        subscription_status: sub.status,
        current_period_end: periodEnd,
        project_limit: FREE_PROJECT_LIMIT,
      })
      if (TERMINAL_AGENCY_STATUSES.has(sub.status)) {
        await archiveExcessProjects(userId, FREE_PROJECT_LIMIT)
      }
    }
    return
  }

  // ── Hosting subscription (per-project) ─────────────────────────────────
  const { userId, projectId } = meta
  if (!userId || !projectId || !isUuid(projectId)) return

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  // Never revive / redeploy a deleted store (#37).
  if (!project || project.status === 'deleted') {
    console.error(`[webhook] hosting subscription ${sub.id}: project ${projectId} not owned by ${userId} — ignored`)
    return
  }

  const { error } = await supabaseAdmin
    .from('hosting_subscriptions')
    .upsert(
      {
        user_id: userId,
        project_id: projectId,
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        status: sub.status,
        current_period_end: periodEnd,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' },
    )
  if (error) throw new Error(`hosting_subscriptions upsert failed: ${error.message}`)

  // Suspended store + active subscription again → redeploy the real store (free).
  // Runs after the response so a slow Vercel deploy can't time out the webhook and
  // trigger Stripe retries.
  if (isActive) {
    after(() => restoreSuspendedStore(projectId))
  }

  // Partner commission is booked from invoice.paid (handleInvoicePaid), on what was
  // actually paid — not here from the price list amount on every subscription update.
}

// ─── Partner commission on paid hosting invoices ─────────────────────────────
// Calculation + bookkeeping only, never a payout (see lib/partner-commission.ts's header
// comment). Based on the invoice's real amount_paid (coupons, prorations and credit
// notes included, tax excluded), deduplicated per invoice. Wrapped defensively: a
// failure here must never fail the webhook.

function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  // API 2025-01-27.acacia puts it on invoice.subscription; newer versions under parent.
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription
  return idOf(legacy ?? invoice.parent?.subscription_details?.subscription ?? null)
}

function invoiceTaxCents(invoice: Stripe.Invoice): number {
  const legacyTax = (invoice as unknown as { tax?: number | null }).tax
  if (typeof legacyTax === 'number') return legacyTax
  return (invoice.total_taxes ?? []).reduce((s, t) => s + (Number(t.amount) || 0), 0)
}

async function handleInvoicePaid(eventInvoice: Stripe.Invoice): Promise<void> {
  if (!eventInvoice.id) return
  try {
    // Authoritative copy — never the event payload.
    const invoice = await stripe.invoices.retrieve(eventInvoice.id)
    if (invoice.status !== 'paid') return
    const subId = subscriptionIdOfInvoice(invoice)
    if (!subId) return

    const sub = await stripe.subscriptions.retrieve(subId)
    const meta = sub.metadata ?? {}
    if (meta.type === 'agency') return // commission is only on per-project hosting
    const { userId, projectId } = meta
    if (!userId || !projectId || !isUuid(projectId)) return

    // Same ownership check as the hosting-subscription handler: the payer must own it.
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!project) return

    const amountCents = Math.max(0, (invoice.amount_paid ?? 0) - invoiceTaxCents(invoice))
    if (amountCents <= 0) return

    // Pass the payer (the subscription's verified owner = hosting_subscriptions.user_id)
    // so a partner never earns commission on their own payments (#73).
    const partner = await getActivePartnerForProject(projectId, userId)
    if (!partner) return

    await recordCommission({
      partnerId: partner.partnerId,
      projectId,
      amountCents,
      commissionRateBps: partner.commissionRateBps,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
      reason: 'hosting_subscription_renewal',
      refId: `invoice:${invoice.id}`,
    })
  } catch (err) {
    console.error(`[webhook] partner commission calc failed for invoice ${eventInvoice.id}:`, err)
  }
}

// ─── Hosting restore: redeploy a suspended store after resubscribe ───────────
// Store data is never deleted — the maintenance page is replaced by the latest
// generated code version. Free (no credit debit); failures are non-fatal and the
// user can always redeploy manually from the Studio.
async function restoreSuspendedStore(projectId: string): Promise<void> {
  try {
    // Only a store that was live before and is allowed production again (the
    // subscription we just stored) may be redeployed.
    const gate = await getHostingGate(projectId)
    if (!gate.everLive || !gate.canDeployProduction) return

    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, name, user_id, hosting_suspended_at')
      .eq('id', projectId)
      .maybeSingle()

    if (!project?.hosting_suspended_at) return

    const { data: version } = await supabaseAdmin
      .from('code_versions')
      .select('id, files, version_no')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!version) return

    // Per-project Vercel project + unique store slug (never looked up by name).
    const vercelProjectId = await ensureProjectVercel(projectId)
    const slug = await getOrClaimStoreSlug(projectId, (project.name as string) ?? '')

    const files = buildStoreFiles(version.files as CodeVersionFiles)
    const result = await createPreviewDeployment(
      vercelProjectId,
      files.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding })),
      slug,
    )

    await supabaseAdmin
      .from('projects')
      .update({ hosting_suspended_at: null, updated_at: new Date().toISOString() })
      .eq('id', projectId)

    const { error: restoreInsertErr } = await insertDeploymentRow({
      project_id: projectId,
      user_id: project.user_id as string,
      vercel_project_id: vercelProjectId,
      vercel_deployment_id: result.deploymentId,
      status: 'building',
      url: result.url,
      domain: result.url.replace('https://', ''),
      version: version.version_no,
      code_version_id: version.id,
      target: 'production',
      scaffold_version: SCAFFOLD_VERSION,
    })
    if (restoreInsertErr) console.error(`[webhook] restore deployments insert failed for ${projectId}:`, restoreInsertErr.message)

    console.log(`[webhook] restored suspended store ${projectId} → ${result.url}`)
  } catch (err) {
    console.error(`[webhook] restoreSuspendedStore failed for ${projectId}:`, err)
  }
}

// ─── Agency downgrade: archive projects over the limit ───────────────────────
// Sets projects to 'archived' status so they are hidden but not deleted.
// The user sees a warning banner and can re-activate by upgrading again.
async function archiveExcessProjects(userId: string, limit: number): Promise<void> {
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (!projects || projects.length <= limit) return

  const toArchive = projects.slice(limit).map((p: { id: string }) => p.id)
  await supabaseAdmin
    .from('projects')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .in('id', toArchive)
}

// ─── Customer payment confirmed email ────────────────────────────────────────

async function sendCustomerConfirmation(projectId: string, session: Stripe.Checkout.Session, orderId?: string) {
  const customerEmail = session.customer_details?.email
  if (!customerEmail) return

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest) return

  // Prefer data from store_orders if we have an order ID
  let orderNumber: string
  let total: number
  const currency = (session.currency ?? 'czk').toUpperCase()

  if (orderId) {
    const { data: order } = await supabaseAdmin
      .from('store_orders')
      .select('order_number, total_cents')
      .eq('id', orderId)
      .maybeSingle()
    orderNumber = order?.order_number ?? `ORD-${session.id.slice(-8).toUpperCase()}`
    total = order ? order.total_cents / 100 : (session.amount_total ?? 0) / 100
  } else {
    orderNumber = `ORD-${session.id.slice(-8).toUpperCase()}`
    total = (session.amount_total ?? 0) / 100
  }

  // No hard-coded platform host fallback (#48): without NEXT_PUBLIC_APP_URL the mail
  // simply carries no invoice link. The link is signed (the invoice route needs the
  // owner's session or this token).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const invoiceUrl = orderId && appUrl ? signedInvoiceUrl(orderId, appUrl) : undefined

  const { subject, html } = paymentConfirmedEmail({
    orderNumber,
    customerName: session.customer_details?.name ?? 'zákazníku',
    total,
    currency,
    storeName: manifest.brand.name,
    accentColor: manifest.design.palette.accent,
    // White-label: no Quante address as the merchant contact — omitted when unset.
    merchantEmail: manifest.merchant?.kontakt.email || null,
    merchantName: manifest.merchant?.obchodni_nazev ?? manifest.brand.name,
    invoiceUrl,
  })

  await sendEmail(customerEmail, subject, html)
}

// ─── Record store sale + notify owner ────────────────────────────────────────

async function recordStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  // Only money that actually arrived counts (async methods complete 'unpaid' first).
  if (session.payment_status !== 'paid') return
  if (!isUuid(projectId)) return

  // Priced amount/currency (the presentment values differ under Adaptive Pricing).
  const priced = pricedAmount(session)
  const grossCents = priced.amount ?? 0
  const sessionCurrency = priced.currency || 'eur'
  // Platform fee was removed 2026-07 — kept for legacy sessions created before the change.
  const platformFeeCents = parseInt(session.metadata?.platform_fee_cents ?? '0', 10) || 0
  const netCents = grossCents - platformFeeCents
  const orderId = session.metadata?.order_id

  // Keep store_earnings for backwards compatibility / Stripe-specific reporting.
  // Amounts are in the minor units of `currency`; payouts are computed per currency.
  // Written first, so a failure here (→ 500 → Stripe retry) can't leave the order
  // marked paid with the retry then skipping the booking.
  const { error, written } = await upsertTolerant(
    'store_earnings',
    {
      project_id: projectId,
      stripe_session_id: session.id,
      gross_amount_cents: grossCents,
      platform_fee_cents: platformFeeCents,
      net_amount_cents: netCents,
      currency: sessionCurrency,
      customer_email: session.customer_details?.email ?? null,
      customer_name: session.customer_details?.name ?? null,
      kind: 'sale',
      stripe_payment_intent_id: idOf(session.payment_intent),
    },
    ['kind', 'stripe_payment_intent_id'],
    { onConflict: 'stripe_session_id', ignoreDuplicates: true },
  )
  if (error) throw new Error(`store_earnings insert failed: ${error.message}`)

  // Update store_orders to paid (idempotent) — only when Stripe charged exactly the
  // order's total in the order's currency.
  let shouldNotify: boolean
  if (orderId) {
    const { data: order } = await supabaseAdmin
      .from('store_orders')
      .select('id, project_id, total_cents, currency')
      .eq('id', orderId)
      .maybeSingle()
    const matches = !!order
      && order.project_id === projectId
      && order.total_cents === grossCents
      && String(order.currency ?? '').toLowerCase() === sessionCurrency
    if (!matches) {
      console.error(
        `[webhook] SECURITY: store_sale ${session.id} for project ${projectId} does not match order ${orderId} ` +
        `(charged ${grossCents} ${sessionCurrency}, order ${order?.total_cents} ${order?.currency}) — order not marked paid`,
      )
      // Never tell the merchant/customer an order is paid when we refused to mark it so.
      shouldNotify = false
    } else {
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('store_orders')
        .update({
          payment_status: 'paid',
          status: 'paid',
          payment_ref: session.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('payment_status', 'pending') // only update if still pending (idempotent)
        .select('id, project_id, items')
      if (updErr) throw new Error(`store_orders paid update failed: ${updErr.message}`)
      // Emails + stock only on the pending → paid transition, never on a Stripe retry.
      const transitioned = (updated ?? []) as Array<{ id: string; project_id: string; items: unknown }>
      shouldNotify = transitioned.length > 0
      if (transitioned[0]) await decrementStockForOrder(transitioned[0])
    }
  } else {
    // Legacy sessions without an order: notify only when this delivery booked the sale.
    shouldNotify = written > 0
  }

  if (!shouldNotify) return
  // Best effort: the sale is booked, so a mail failure must not 500 the webhook
  // (a retry would not re-send anyway).
  try {
    await notifyStoreSale(projectId, session)
  } catch (err) {
    console.error(`[webhook] merchant order email failed for ${session.id}:`, err)
  }
  try {
    await sendCustomerConfirmation(projectId, session, orderId)
  } catch (err) {
    console.error(`[webhook] customer confirmation email failed for ${session.id}:`, err)
  }
}

async function notifyStoreSale(projectId: string, session: Stripe.Checkout.Session) {
  if (!process.env.RESEND_API_KEY) return

  const { data: secret } = await supabaseAdmin
    .from('project_secrets')
    .select('user_id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!secret?.user_id) return

  // Get owner's Clerk email (platform user who built the store)
  let ownerEmail: string | null = null
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(secret.user_id as string)
    ownerEmail = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null
  } catch (err) {
    console.error('[webhook] failed to get owner email:', err)
  }
  if (!ownerEmail) return

  // Fetch manifest for branding
  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = versionRow?.manifest as ShopManifest | undefined

  // Fetch order for item details
  const orderId = session.metadata?.order_id
  let orderNumber = `ORD-${session.id.slice(-8).toUpperCase()}`
  let orderItems: Array<{ name: string; quantity: number; price: number; currency: string }> = []
  const currency = (session.currency ?? 'czk').toUpperCase()
  const total = (session.amount_total ?? 0) / 100

  if (orderId) {
    const { data: order } = await supabaseAdmin
      .from('store_orders')
      .select('order_number, items')
      .eq('id', orderId)
      .maybeSingle()
    if (order) {
      orderNumber = order.order_number
      orderItems = ((order.items as Array<{ id: string; name: string; price: number; quantity: number }>) ?? [])
        .map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency }))
    }
  }

  const { subject, html } = merchantNewOrderEmail({
    orderNumber,
    customerName: session.customer_details?.name ?? '—',
    customerEmail: session.customer_details?.email ?? '—',
    items: orderItems,
    total,
    currency,
    paymentMethod: 'Platební karta (Stripe)',
    storeName: manifest?.brand.name ?? 'Váš obchod',
    accentColor: manifest?.design.palette.accent ?? '#6f78e6',
  })

  await sendEmail(ownerEmail, subject, html, 'orders@quantecode.com')
}

// ─── Domain purchase: register + attach to Vercel + save row (#32 / #68) ─────

type PendingDomainPurchase = {
  id: string
  user_id: string
  project_id: string | null
  domain: string
  price: number | string
  status: string
  include_protection: boolean
  stripe_session_id: string | null
  registrant_first_name: string
  registrant_last_name: string
  registrant_address1: string
  registrant_city: string
  registrant_state_province: string | null
  registrant_postal_code: string
  registrant_country: string
  registrant_phone: string
  registrant_email: string
  processing_started_at?: string | null
}

// consumed = registered; failed_refunded = refunded; failed = needs a manual refund.
const TERMINAL_PENDING_STATUSES = new Set(['consumed', 'failed_refunded', 'failed'])
// A 'processing' claim older than this, with no user_domains row, is a crashed delivery.
const DOMAIN_PROCESSING_STALE_MS = 5 * 60 * 1000

// Compare-and-set pending|processing(stale) → processing, stamping the claim time.
async function claimPendingDomainPurchase(pending: PendingDomainPurchase): Promise<boolean> {
  const build = (withStamp: boolean) => {
    let q = supabaseAdmin
      .from('pending_domain_purchases')
      .update(withStamp ? { status: 'processing', processing_started_at: new Date().toISOString() } : { status: 'processing' })
      .eq('id', pending.id)
      .eq('status', pending.status)
    if (pending.status === 'processing' && pending.processing_started_at) {
      q = q.eq('processing_started_at', pending.processing_started_at)
    }
    return q.select('id').maybeSingle()
  }
  let { data, error } = await build(true)
  if (error && isMissingColumn(error)) {
    console.warn('[webhook] pending_domain_purchases.processing_started_at missing — run supabase/migration-security-stripe-payments.sql')
    ;({ data, error } = await build(false))
  }
  if (error) throw new Error(`pending domain claim failed: ${error.message}`)
  return !!data
}

async function refundDomainSession(
  session: Stripe.Checkout.Session,
  domain: string,
  userId: string,
  pendingId: string | null,
  reason: string,
): Promise<void> {
  const paymentIntentId = idOf(session.payment_intent)
  let failureReason: string
  let status = 'failed_refunded'
  if (paymentIntentId) {
    try {
      await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          reason: 'requested_by_customer',
          metadata: { type: 'domain_purchase_failed', domain, userId },
        },
        // One refund per checkout session, however many times the webhook is retried.
        { idempotencyKey: `domain-refund-${session.id}` },
      )
      failureReason = `${reason} — refunded automatically.`
      console.error(`[webhook] Refunded domain purchase for ${domain} (payment_intent ${paymentIntentId}): ${reason}`)
    } catch (refundErr) {
      // Worst case: the purchase failed AND the refund call itself failed. It needs a
      // human to issue the refund from the Stripe dashboard.
      status = 'failed'
      failureReason = `${reason} — automatic refund ALSO failed, needs manual refund.`
      console.error(`[webhook] REFUND FAILED for ${domain} (payment_intent ${paymentIntentId}):`, refundErr)
    }
  } else {
    status = 'failed'
    failureReason = `${reason} — no payment_intent on session ${session.id}, needs manual refund.`
    console.error(`[webhook] No payment_intent on session ${session.id} for failed domain purchase ${domain} — cannot auto-refund.`)
  }

  if (pendingId) {
    let { error } = await supabaseAdmin
      .from('pending_domain_purchases')
      .update({ status, failure_reason: failureReason })
      .eq('id', pendingId)
    if (error && isMissingColumn(error)) {
      ;({ error } = await supabaseAdmin.from('pending_domain_purchases').update({ status }).eq('id', pendingId))
    }
    if (error) console.error('[webhook] could not record domain purchase failure:', error.message)
  }
}

async function handleDomainPurchase(session: Stripe.Checkout.Session, userId: string) {
  const { domain: rawDomain, projectId: metaProjectId, includeProtection, pendingPurchaseId } = session.metadata ?? {}
  if (!rawDomain) return
  const domain = rawDomain.trim().toLowerCase()

  // Async payment methods: wait for checkout.session.async_payment_succeeded.
  if (session.payment_status !== 'paid') return

  // Genuine Stripe retry of a delivery we already handled?
  const { data: handled } = await supabaseAdmin
    .from('user_domains')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (handled) return

  // Load the registrant contact collected (and validated) in /api/domains/purchase
  // before the Stripe charge. It must belong to this user, domain and session.
  const { data: pendingRow } = pendingPurchaseId && isUuid(pendingPurchaseId)
    ? await supabaseAdmin
        .from('pending_domain_purchases')
        .select('*')
        .eq('id', pendingPurchaseId)
        .maybeSingle()
    : { data: null }
  const pending = pendingRow as PendingDomainPurchase | null

  // Terminal states: already registered, or already refunded / handed to manual refund.
  if (pending && TERMINAL_PENDING_STATUSES.has(pending.status)) return

  const pendingMatches = !!pending
    && pending.user_id === userId
    && pending.domain.trim().toLowerCase() === domain
    && (!pending.stripe_session_id || pending.stripe_session_id === session.id)

  if (!pending || !pendingMatches) {
    console.error('[webhook] No matching pending_domain_purchases row for', pendingPurchaseId, '— cannot register without registrant data.')
    // Never touch a pending row that isn't this buyer's; the refund itself is idempotent.
    await refundDomainSession(session, domain, userId, null, 'No registrant data found for this purchase')
    return
  }

  // Expired on our side (e.g. sessions.expire failed in /api/domains/purchase) but the
  // customer paid anyway: the reservation is gone, so the money goes back.
  if (pending.status === 'expired') {
    await refundDomainSession(session, domain, userId, pending.id, 'Purchase had expired before the payment completed')
    return
  }

  // Claim the pending row so concurrent deliveries can't both register. A 'processing'
  // row here has no user_domains row for this session (checked above): either another
  // delivery is mid-flight, or one crashed after claiming. Re-claim only once stale;
  // otherwise fail so Stripe retries later instead of dropping the paid purchase.
  if (pending.status === 'processing') {
    const startedMs = pending.processing_started_at ? Date.parse(pending.processing_started_at) : NaN
    if (!Number.isFinite(startedMs)) {
      throw new Error(
        `domain purchase ${pending.id} (${domain}) is 'processing' with no start time — ` +
        'cannot tell in-flight from crashed; needs manual review (run migration-security-stripe-payments.sql).',
      )
    }
    if (Date.now() - startedMs < DOMAIN_PROCESSING_STALE_MS) {
      throw new Error(`domain purchase ${pending.id} is being processed by another delivery — retry later`)
    }
    console.warn(`[webhook] re-claiming stale domain purchase ${pending.id} (${domain})`)
  } else if (pending.status !== 'pending') {
    console.error(`[webhook] domain purchase ${pending.id} has unknown status '${pending.status}' — refunding`)
    await refundDomainSession(session, domain, userId, pending.id, `Purchase in unexpected state '${pending.status}'`)
    return
  }
  if (!(await claimPendingDomainPurchase(pending))) {
    throw new Error(`domain purchase ${pending.id} was claimed by a concurrent delivery — retry later`)
  }

  // The amount charged must be the amount quoted for this pending purchase (in the
  // priced currency — the presentment currency differs under Adaptive Pricing).
  const expectedCents = Math.round(Number(pending.price) * 100)
  const priced = pricedAmount(session)
  if (priced.amount !== expectedCents || priced.currency !== 'usd') {
    await refundDomainSession(session, domain, userId, pending.id, 'Charged amount does not match the quoted price')
    return
  }

  // Only attach to a project the buyer actually owns.
  let projectId: string | null = null
  if (metaProjectId && isUuid(metaProjectId)) {
    const { data: owned } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', metaProjectId)
      .eq('user_id', userId)
      .maybeSingle()
    projectId = owned ? metaProjectId : null
  }

  // Claim the domain name BEFORE registering: user_domains.domain is UNIQUE, so if any
  // user (including a squatting "connect" row) already holds it, we refund instead of
  // silently keeping the money.
  const claim = await insertTolerant(
    'user_domains',
    {
      user_id: userId,
      project_id: projectId,
      domain,
      status: 'registering',
      protection_enabled: false,
      dns_verified: false,
      stripe_session_id: session.id,
      stripe_payment_intent_id: idOf(session.payment_intent),
    },
    ['stripe_session_id'],
    'id',
  )
  if (claim.error || !claim.data) {
    if (claim.error?.code === '23505') {
      // A row for THIS session means a (slow) earlier delivery got there first — not a
      // conflict. Anyone else's row → refund.
      const { data: holder } = await supabaseAdmin
        .from('user_domains')
        .select('id, stripe_session_id')
        .eq('domain', domain)
        .maybeSingle()
      if (holder && (holder as { stripe_session_id?: string | null }).stripe_session_id === session.id) return
      await refundDomainSession(session, domain, userId, pending.id, 'Domain is already claimed on Quante')
      return
    }
    // Unknown DB error: release the pending claim and let Stripe retry.
    await supabaseAdmin.from('pending_domain_purchases').update({ status: 'pending' }).eq('id', pending.id)
    throw new Error(`user_domains claim failed: ${claim.error?.message}`)
  }
  const domainRowId = claim.data.id as string

  let namecheapOrderId: string | null = null
  try {
    const result = await registerDomain(domain, {
      firstName: pending.registrant_first_name,
      lastName: pending.registrant_last_name,
      address1: pending.registrant_address1,
      city: pending.registrant_city,
      stateProvince: pending.registrant_state_province ?? '',
      postalCode: pending.registrant_postal_code,
      country: pending.registrant_country,
      phone: pending.registrant_phone,
      email: pending.registrant_email,
    }, 1)
    namecheapOrderId = result.orderId
  } catch (err) {
    console.error('[webhook] Namecheap registration failed:', err)
    // The customer paid for a domain they didn't get — release the name and refund.
    await supabaseAdmin.from('user_domains').delete().eq('id', domainRowId).eq('status', 'registering')
    await refundDomainSession(session, domain, userId, pending.id, 'Domain registration failed after payment')
    return
  }

  await supabaseAdmin
    .from('pending_domain_purchases')
    .update({ status: 'consumed' })
    .eq('id', pending.id)

  // Auto-configure DNS at Namecheap (A @ → Vercel, CNAME www → cname.vercel-dns.com)
  try {
    await setDnsToVercel(domain)
  } catch (err) {
    console.error('[webhook] Namecheap DNS auto-config failed:', err)
  }

  // Attach to Vercel if the (owned) project already has a Vercel project.
  let vercelProjectId: string | null = null
  if (projectId) {
    try {
      const { data: project } = await supabaseAdmin
        .from('projects').select('vercel_project_id').eq('id', projectId).maybeSingle()
      if (project?.vercel_project_id) {
        const ownVercelId = await ensureProjectVercel(projectId)
        await attachDomain(ownVercelId, domain)
        vercelProjectId = ownVercelId
        // www variant is non-critical — Vercel redirects it to the apex
        try { await attachDomain(ownVercelId, `www.${domain}`) } catch { /* non-fatal */ }
      }
    } catch (err) {
      console.error('[webhook] Vercel attach failed:', err)
    }
  }

  const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
  await supabaseAdmin
    .from('user_domains')
    .update({
      status: 'active',
      registered_at: new Date().toISOString(),
      expires_at: expiresAt,
      namecheap_order_id: namecheapOrderId,
      vercel_project_id: vercelProjectId,
      // set once Vercel confirms propagation (verify route); auto-config just points DNS
      dns_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', domainRowId)

  // Paid protection add-on: only recorded as enabled once a subscription exists AND is
  // actually being paid (#68). Both the pending row and the session must have asked for it.
  if (includeProtection === 'true' && pending.include_protection && session.customer) {
    const protectionPriceId = process.env.DOMAIN_PROTECTION_STRIPE_PRICE_ID
    if (protectionPriceId) {
      try {
        const sub = await stripe.subscriptions.create(
          {
            customer: idOf(session.customer) as string,
            items: [{ price: protectionPriceId }],
            metadata: { type: 'domain_protection', userId, domain },
          },
          { idempotencyKey: `domain-protection-${session.id}` },
        )
        if (sub.status === 'active' || sub.status === 'trialing') {
          await supabaseAdmin.from('user_domains')
            .update({ stripe_subscription_id: sub.id, protection_enabled: true })
            .eq('id', domainRowId)
        } else {
          // No usable payment method → the subscription can't be charged; don't leave
          // an unpaid subscription around or mark protection as on.
          console.error(`[webhook] protection subscription ${sub.id} for ${domain} is ${sub.status} — canceled, protection not enabled`)
          try { await stripe.subscriptions.cancel(sub.id) } catch { /* best effort */ }
        }
      } catch (err) {
        console.error('[webhook] protection subscription creation failed:', err)
      }
    }
  }
}
