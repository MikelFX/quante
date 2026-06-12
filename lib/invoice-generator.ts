// HTML invoice generator — produces a print-ready HTML document.
// Used for email attachments and /invoice/[orderId] pages.

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

function fmt(n: number, currency: string) {
  return `${n.toFixed(2).replace('.', ',')} ${currency}`
}

function dateStr(d: Date) {
  return d.toLocaleDateString('cs-CZ')
}

export function generateInvoiceHtml(d: InvoiceData): string {
  const platceDph = d.merchant.platce_dph
  const subtotal = d.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const vatTotal = platceDph
    ? d.items.reduce((s, i) => {
        const rate = i.vatRate ?? 21
        const base = (i.unitPrice * i.quantity) / (1 + rate / 100)
        return s + (i.unitPrice * i.quantity - base)
      }, 0)
    : 0

  const itemRows = d.items.map((item) => {
    const lineTotal = item.unitPrice * item.quantity
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0">${item.name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center">${item.quantity}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right">${fmt(item.unitPrice, d.currency)}</td>
      ${platceDph ? `<td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center">${item.vatRate ?? 21} %</td>` : ''}
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${fmt(lineTotal, d.currency)}</td>
    </tr>`
  }).join('')

  const sidloMerchant = `${d.merchant.sidlo.ulice}, ${d.merchant.sidlo.psc} ${d.merchant.sidlo.mesto}`
  const sidloCustomer = d.customer.address
    ? `${d.customer.address.ulice}, ${d.customer.address.psc} ${d.customer.address.mesto}`
    : '—'

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <title>Faktura ${d.invoiceNumber}</title>
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
      <h1>${d.merchant.obchodni_nazev}</h1>
      <p style="margin:0;color:#666;font-size:13px">${sidloMerchant}</p>
      <p style="margin:2px 0 0;color:#666;font-size:13px">${d.merchant.kontakt.email} · ${d.merchant.kontakt.telefon}</p>
    </div>
    <div style="text-align:right">
      <p style="margin:0;font-size:24px;font-weight:700">Faktura</p>
      <p style="margin:2px 0 0;font-size:18px;font-family:monospace;color:#333">${d.invoiceNumber}</p>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:32px;padding:20px;background:#f9f9f9;border-radius:10px">
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Dodavatel</p>
      <p style="margin:0;font-weight:600">${d.merchant.obchodni_nazev}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#555">IČO: ${d.merchant.ico}</p>
      ${d.merchant.dic ? `<p style="margin:2px 0 0;font-size:13px;color:#555">DIČ: ${d.merchant.dic}</p>` : ''}
      ${!platceDph ? `<p style="margin:2px 0 0;font-size:12px;color:#999">Neplátce DPH</p>` : ''}
    </div>
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Odběratel</p>
      <p style="margin:0;font-weight:600">${d.customer.name}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#555">${d.customer.email}</p>
      ${d.customer.address ? `<p style="margin:2px 0 0;font-size:13px;color:#555">${sidloCustomer}</p>` : ''}
    </div>
    <div>
      <p style="margin:0 0 2px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em">Datum</p>
      <p style="margin:0;font-size:13px">Vystaveno: <strong>${dateStr(d.issuedAt)}</strong></p>
      ${d.dueAt ? `<p style="margin:2px 0 0;font-size:13px">Splatnost: <strong>${dateStr(d.dueAt)}</strong></p>` : ''}
      <p style="margin:4px 0 0;font-size:12px;color:#666">Objednávka: ${d.orderNumber}</p>
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

  ${d.note ? `<p style="margin:24px 0 0;font-size:13px;color:#666;padding:12px 16px;background:#fffbeb;border-radius:8px">${d.note}</p>` : ''}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999">
    <p style="margin:0">
      ${d.merchant.obchodni_nazev} · IČO ${d.merchant.ico}${d.merchant.dic ? ` · DIČ ${d.merchant.dic}` : ''} · ${sidloMerchant}
    </p>
  </div>
</body>
</html>`
}
