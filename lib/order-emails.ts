// Shared "payment succeeded" email pair: payment confirmation to the customer
// + new-order notification to the merchant. Used by Comgate/GoPay/PayPal
// webhook handlers so every provider has the same complete email chain.
//
// Also home of loadStoreEmailContext(): the one place that resolves a store's
// branding + merchant contact for transactional mail, for both legacy manifest
// stores (manifest_versions) and code-gen stores (code_versions data/config.ts +
// project_secrets.merchant_json). White-label: it never falls back to a Quante
// address as the merchant contact — a missing contact is simply omitted.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { paymentConfirmedEmail, merchantNewOrderEmail, sendEmail, getProjectFromEmail, isValidEmail } from '@/lib/email-templates'
import { signedInvoiceUrl } from '@/lib/invoice-generator'
import { getHostingGate } from '@/lib/hosting/gate'
import { parseConfigFile, CONFIG_FILE } from '@/lib/store-config'
import type { Merchant, ShopManifest } from '@/types/manifest'
import type { BusinessInfo } from '@/types/business'

export interface PaidOrderRow {
  id: string
  project_id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  customer_phone?: string | null
  total_cents: number
  currency: string
  payment_method?: string | null
  shipping_method?: string | null
  shipping_address?: { ulice: string; mesto: string; psc: string; zeme?: string } | null
  items?: Array<{ id: string; name: string; price: number; quantity: number }> | null
}

export interface StoreEmailContext {
  storeName: string
  accentColor: string
  /** Merchant's own contact address; null when not configured (omitted from mails). */
  merchantEmail: string | null
  merchantName: string
  bankAccount: string | null
  /** Full merchant record for invoices; null when the merchant hasn't filled it in. */
  merchant: Merchant | null
  manifest: ShopManifest | null
}

function businessToMerchant(b: BusinessInfo | null): Merchant | null {
  if (!b || !b.name) return null
  return {
    obchodni_nazev: b.name,
    ico: b.taxId ?? '',
    dic: b.vatId || undefined,
    platce_dph: b.vatRegistered === true,
    sidlo: { ulice: b.street ?? '', mesto: b.city ?? '', psc: b.postalCode ?? '', zeme: b.country ?? '' },
    kontakt: { email: b.email ?? '', telefon: b.phone ?? '' },
    bankovni_ucet: b.bankAccount || undefined,
    zodpovedna_osoba: b.responsiblePerson || undefined,
  }
}

export async function loadStoreEmailContext(projectId: string): Promise<StoreEmailContext | null> {
  const [{ data: versionRow }, { data: codeRow }, { data: secrets }] = await Promise.all([
    supabaseAdmin
      .from('manifest_versions')
      .select('manifest')
      .eq('project_id', projectId)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('code_versions')
      .select('files')
      .eq('project_id', projectId)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('project_secrets')
      .select('merchant_json')
      .eq('project_id', projectId)
      .maybeSingle(),
  ])

  const manifest = (versionRow?.manifest as ShopManifest | undefined) ?? null
  const files = (codeRow?.files as Record<string, string> | undefined) ?? null
  const config = files?.[CONFIG_FILE] ? parseConfigFile(files[CONFIG_FILE]) : null
  const business = (secrets?.merchant_json as BusinessInfo | null) ?? null

  // Code-gen stores are what actually runs today; the manifest is the legacy model.
  const storeName = config?.brand.name ?? manifest?.brand.name ?? null
  if (!storeName) return null
  const accentColor = config?.design.colors.accent ?? manifest?.design.palette.accent ?? '#111111'

  const merchant = (config ? businessToMerchant(business) : null) ?? manifest?.merchant ?? businessToMerchant(business)
  const rawEmail = merchant?.kontakt.email ?? null

  return {
    storeName,
    accentColor,
    merchantEmail: isValidEmail(rawEmail) ? rawEmail : null,
    merchantName: merchant?.obchodni_nazev || storeName,
    bankAccount: merchant?.bankovni_ucet ?? null,
    merchant,
    manifest,
  }
}

// ─── Daily mail budget for unpaid (offline) orders — final audit F8 ─────────────
//
// An offline order (dobirka / prevod) is created from the public checkout for any
// typed-in address, with no payment behind it. Every platform-sent mail such an order
// triggers while nobody has confirmed its payment — the checkout's customer
// confirmation + merchant notice, and later a "shipped" (or "refunded") mail — must win
// a slot from one per-store daily budget: at most UNPAID_MAIL_DAILY_TRIAL per rolling 24
// hours for stores without a paid hosting plan, UNPAID_MAIL_DAILY_PAID for paying ones.
// Atomic in the DB via reserve_unpaid_mail_slot() (supabase/migration-security4-mail-
// guards.sql). Until that migration has run (or if the RPC errors) the fallback is a
// non-atomic count of the store's offline orders of the last 24 hours plus an in-memory
// per-instance cap. A refused slot only suppresses mail — orders and status changes
// always go through.

const OFFLINE_METHODS = new Set(['dobirka', 'prevod'])
export const UNPAID_MAIL_DAILY_TRIAL = 40
export const UNPAID_MAIL_DAILY_PAID = 400
const DAY_MS = 24 * 60 * 60_000

export function unpaidMailDailyLimit(paidHosting: boolean): number {
  return paidHosting ? UNPAID_MAIL_DAILY_PAID : UNPAID_MAIL_DAILY_TRIAL
}

/** An offline (COD / bank transfer) order whose payment nobody has confirmed. */
export function isUnconfirmedOfflineOrder(o: { payment_method?: string | null; payment_status?: string | null }): boolean {
  return OFFLINE_METHODS.has(o.payment_method ?? '') && o.payment_status !== 'paid'
}

export async function reserveUnpaidMailSlot(projectId: string, paidHosting: boolean): Promise<boolean> {
  const limit = unpaidMailDailyLimit(paidHosting)
  try {
    const { data, error } = await supabaseAdmin.rpc('reserve_unpaid_mail_slot', {
      p_project_id: projectId,
      p_limit: limit,
    })
    if (!error) {
      if (data === 'ok') return true
      console.warn('[order-emails] unpaid-order mail daily cap reached — mail skipped', { projectId, cap: data })
      return false
    }
    console.error('[order-emails] reserve_unpaid_mail_slot failed — using fallback daily cap (run migration-security4-mail-guards.sql):', error.message)
  } catch (err) {
    console.error('[order-emails] reserve_unpaid_mail_slot threw — using fallback daily cap:', err instanceof Error ? err.message : err)
  }
  // Fallback: shared across instances but not atomic (the store's offline orders of the
  // last 24 hours), plus the per-instance counter of mails actually sent.
  try {
    const { count, error } = await supabaseAdmin
      .from('store_orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('payment_method', [...OFFLINE_METHODS])
      .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
    if (!error && (count ?? 0) > limit) {
      console.warn('[order-emails] unpaid-order mail daily cap reached (order count) — mail skipped', { projectId })
      return false
    }
  } catch { /* fall through to the in-memory cap */ }
  const allowed = rateLimit(`unpaid-order-mail-day:${projectId}`, limit, DAY_MS).allowed
  if (!allowed) console.warn('[order-emails] unpaid-order mail daily cap reached (in-memory) — mail skipped', { projectId })
  return allowed
}

/**
 * Merchant new-order notice of an unpaid order: the merchant address is set by the
 * merchant and never verified, so it is capped per RECIPIENT across all stores (DB,
 * reserve_merchant_notice_slot()) with the same daily limit as the store's budget.
 */
export async function reserveMerchantNoticeSlot(projectId: string, email: string, paidHosting: boolean): Promise<boolean> {
  const recipient = email.trim().toLowerCase()
  if (!recipient) return false
  const limit = unpaidMailDailyLimit(paidHosting)
  try {
    const { data, error } = await supabaseAdmin.rpc('reserve_merchant_notice_slot', {
      p_project_id: projectId,
      p_email: recipient,
      p_limit: limit,
    })
    if (!error) {
      if (data === 'ok') return true
      console.warn('[order-emails] merchant notice daily cap reached for this address — notice skipped', { projectId, cap: data })
      return false
    }
    console.error('[order-emails] reserve_merchant_notice_slot failed — using in-memory cap (run migration-security4-mail-guards.sql):', error.message)
  } catch (err) {
    console.error('[order-emails] reserve_merchant_notice_slot threw — using in-memory cap:', err instanceof Error ? err.message : err)
  }
  return rateLimit(`merchant-notice-to:${recipient}`, limit, DAY_MS).allowed
}

// Legacy manifest stores record the shipping method type ('zasilkovna', …); show the
// merchant a readable name. Code-gen stores already record the merchant's label.
const LEGACY_SHIPPING_LABELS: Record<string, string> = {
  zasilkovna: 'Zásilkovna',
  packeta_international: 'Packeta International',
  dhl: 'DHL Express',
  ppl: 'PPL',
  dpd: 'DPD',
  balikovna: 'Balíkovna',
  osobni_odber: 'Osobní odběr',
  custom: 'Doručení',
}

export function shippingMethodLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  return LEGACY_SHIPPING_LABELS[value] ?? value
}

export async function sendPaymentSuccessEmails(order: PaidOrderRow): Promise<void> {
  const ctx = await loadStoreEmailContext(order.project_id)
  if (!ctx) return

  const from = await getProjectFromEmail(order.project_id, ctx.storeName)
  const currency = order.currency.toUpperCase()
  const total = order.total_cents / 100
  const sends: Promise<boolean>[] = []

  // Customer mail goes only to the address stored on the order itself.
  if (order.customer_email && isValidEmail(order.customer_email)) {
    const { subject, html } = paymentConfirmedEmail({
      orderNumber: order.order_number,
      customerName: order.customer_name ?? 'zákazníku',
      total,
      currency,
      storeName: ctx.storeName,
      accentColor: ctx.accentColor,
      merchantEmail: ctx.merchantEmail,
      merchantName: ctx.merchantName,
      invoiceUrl: signedInvoiceUrl(order.id),
    })
    sends.push(sendEmail(order.customer_email, subject, html, from))
  }

  if (ctx.merchantEmail) {
    const { subject, html } = merchantNewOrderEmail({
      orderNumber: order.order_number,
      customerName: order.customer_name ?? '—',
      customerEmail: order.customer_email ?? '—',
      customerPhone: order.customer_phone ?? undefined,
      items: (order.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, currency })),
      total,
      currency,
      paymentMethod: order.payment_method ?? '—',
      shippingMethod: shippingMethodLabel(order.shipping_method),
      shippingAddress: order.shipping_address ?? undefined,
      storeName: ctx.storeName,
      accentColor: ctx.accentColor,
    })
    sends.push(sendEmail(ctx.merchantEmail, subject, html, from))
  }

  await Promise.all(sends)
}

/**
 * Daily per-store budget check for mails about an offline order nobody has paid yet
 * (COD / bank transfer). Paid-hosting stores get the higher cap. Returns true when the
 * mail may be sent. Orders that are paid or online are never budgeted here.
 */
export async function reserveUnpaidMailSlotIfNeeded(
  projectId: string,
  order: { payment_method?: string | null; payment_status?: string | null },
): Promise<boolean> {
  if (!isUnconfirmedOfflineOrder(order)) return true
  const gate = await getHostingGate(projectId)
  const paidHosting = gate.hasActiveSubscription === true || gate.agency === true
  return reserveUnpaidMailSlot(projectId, paidHosting)
}
