// HTML invoice generator — produces a print-ready HTML document.
// Used for email attachments and /invoice/[orderId] pages.
//
// SECURITY: customer name/email/address and item names come from anonymous shoppers
// (public store checkout); merchant fields come from the merchant. The HTML is served
// as text/html on the Quante origin, so EVERY interpolated value is escaped.

import { createHmac, timingSafeEqual } from 'crypto'
import { escapeHtml } from '@/lib/html'
import type { Merchant } from '@/types/manifest'

export interface InvoiceData {
  invoiceNumber: string
  orderNumber: string
  issuedAt: Date
  dueAt?: Date
  merchant: Merchant
  customer: {
    name: string
    email: string
    address?: { ulice: string; mesto: string; psc: string }
  }
  items: Array<{ name: string; quantity: number; unitPrice: number; vatRate?: number }>
  currency: string
  note?: string
}

const e = escapeHtml

function num(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function fmt(n: number, currency: string) {
  return `${num(n).toFixed(2).replace('.', ',')} ${e(currency)}`
}

function dateStr(d: Date) {
  return e(d.toLocaleDateString('cs-CZ'))
}

export function generateInvoiceHtml(d: InvoiceData): string {
  const platceDph = d.merchant.platce_dph === true
  const items = d.items.map((i) => ({
    name: i.name,
    quantity: num(i.quantity),
    unitPrice: num(i.unitPrice),
    vatRate: i.vatRate === undefined ? 21 : num(i.vatRate),
  }))
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const vatTotal = platceDph
    ? items.reduce((s, i) => {
        const base = (i.unitPrice * i.quantity) / (1 + i.vatRate / 100)
        return s + (i.unitPrice * i.quantity - base)
      }, 0)
    : 0

  const itemRows = items.map((item) => {
    const lineTotal = item.unitPrice * item.quantity
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0">${e(item.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center">${item.quantity}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right">${fmt(item.unitPrice, d.currency)}</td>
      ${platceDph ? `<td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center">${item.vatRate} %</td>` : ''}
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${fmt(lineTotal, d.currency)}</td>
    </tr>`
  }).join('')

  const m = d.merchant
  const sidloMerchant = `${e(m.sidlo?.ulice)}, ${e(m.sidlo?.psc)} ${e(m.sidlo?.mesto)}`
  const sidloCustomer = d.customer.address
    ? `${e(d.customer.address.ulice)}, ${e(d.customer.address.psc)} ${e(d.customer.address.mesto)}`
    : '—'

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <title>Faktura ${e(d.invoiceNumber)}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    body { font-family: -apple-system, sans-serif; color: #111; font-size: 14px; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 24px; }
    h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: .06em; padding: 0 0 8px; font-weight: 500; }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
    <div>
      <h1>${e(m.obchodni_nazev)}</h1>
      <p style="margin:0;color:#666;font-size:13px">${sidloMerchant}</p>
      <p style="margin:2px 0 0;color:#666;font-size:13px">${e(m.kontakt?.email)} · ${e(m.kontakt?.telefon)}</p>
    </div>
    <div style="text-align:right">
      <p style="margin:0;font-size:24px;font-weight:700">Faktura</p>
      <p style="margin:2px 0 0;font-size:18px;font-family:monospace;color:#333">${e(d.invoiceNumber)}</p>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:32px;padding:20px;background:#f9f9f9;border-radius:10px">
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Dodavatel</p>
      <p style="margin:0;font-weight:600">${e(m.obchodni_nazev)}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#555">IČO: ${e(m.ico)}</p>
      ${m.dic ? `<p style="margin:2px 0 0;font-size:13px;color:#555">DIČ: ${e(m.dic)}</p>` : ''}
      ${!platceDph ? `<p style="margin:2px 0 0;font-size:12px;color:#999">Neplátce DPH</p>` : ''}
    </div>
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Odběratel</p>
      <p style="margin:0;font-weight:600">${e(d.customer.name)}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#555">${e(d.customer.email)}</p>
      ${d.customer.address ? `<p style="margin:2px 0 0;font-size:13px;color:#555">${sidloCustomer}</p>` : ''}
    </div>
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Datum</p>
      <p style="margin:0;font-size:13px">Vystaveno: <strong>${dateStr(d.issuedAt)}</strong></p>
      ${d.dueAt ? `<p style="margin:2px 0 0;font-size:13px">Splatnost: <strong>${dateStr(d.dueAt)}</strong></p>` : ''}
      <p style="margin:4px 0 0;font-size:12px;color:#666">Objednávka: ${e(d.orderNumber)}</p>
    </div>
  </div>

  <table style="margin-bottom:8px">
    <thead>
      <tr style="border-bottom:2px solid #111">
        <th style="text-align:left">Popis</th>
        <th style="text-align:center">Ks</th>
        <th style="text-align:right">Jedn. cena</th>
        ${platceDph ? `<th style="text-align:center">DPH</th>` : ''}
        <th style="text-align:right">Celkem</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div style="margin-left:auto;width:280px;padding:16px;background:#f9f9f9;border-radius:8px">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:14px">
      <span style="color:#555">Mezisoučet</span>
      <span>${fmt(subtotal - vatTotal, d.currency)}</span>
    </div>
    ${platceDph ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:14px">
      <span style="color:#555">DPH celkem</span>
      <span>${fmt(vatTotal, d.currency)}</span>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:2px solid #111;font-size:17px;font-weight:700">
      <span>Celkem k úhradě</span>
      <span>${fmt(subtotal, d.currency)}</span>
    </div>
  </div>

  ${d.note ? `<p style="margin:24px 0 0;font-size:13px;color:#666;padding:12px 16px;background:#fffbeb;border-radius:8px">${e(d.note)}</p>` : ''}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999">
    <p style="margin:0">
      ${e(m.obchodni_nazev)} · IČO ${e(m.ico)}${m.dic ? ` · DIČ ${e(m.dic)}` : ''} · ${sidloMerchant}
    </p>
  </div>
</body>
</html>`
}

// ─── Signed invoice links ─────────────────────────────────────────────────────
// Customers have no Quante account, so the invoice link emailed to them carries an
// HMAC token bound to the order id. The project owner can always open the invoice
// through their Clerk session instead. FAILS CLOSED: without INVOICE_LINK_SECRET no
// token is minted or accepted (links then work for the signed-in owner only).

function invoiceSecret(): string | null {
  const s = process.env.INVOICE_LINK_SECRET
  return s && s.length >= 16 ? s : null
}

/** HMAC token authorising read access to one invoice; null when the secret is not configured. */
export function invoiceAccessToken(orderId: string): string | null {
  const secret = invoiceSecret()
  if (!secret) return null
  return createHmac('sha256', secret).update(`invoice:v1:${orderId}`).digest('base64url')
}

export function verifyInvoiceAccessToken(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false
  const expected = invoiceAccessToken(orderId)
  if (!expected) return false
  const a = Buffer.from(token, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function invoicePath(orderId: string): string {
  const token = invoiceAccessToken(orderId)
  const path = `/invoice/${encodeURIComponent(orderId)}`
  return token ? `${path}?t=${token}` : path
}

/**
 * Absolute invoice URL (with an access token when one can be minted), or null when no
 * platform base URL is configured. Never falls back to a hard-coded host (audit #48:
 * the old fallback domain was not owned by Quante and would receive the token).
 */
export function signedInvoiceUrlOrNull(orderId: string, baseUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!baseUrl) {
    console.error('[invoice] NEXT_PUBLIC_APP_URL is not set — cannot build an absolute invoice link')
    return null
  }
  return `${baseUrl.replace(/\/$/, '')}${invoicePath(orderId)}`
}

/**
 * Invoice URL for emails / the store admin. Same as signedInvoiceUrlOrNull, but when
 * NEXT_PUBLIC_APP_URL is missing it fails closed to a host-less path (logged) instead
 * of pointing at any hard-coded domain.
 */
export function signedInvoiceUrl(orderId: string, baseUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  return signedInvoiceUrlOrNull(orderId, baseUrl) ?? invoicePath(orderId)
}
