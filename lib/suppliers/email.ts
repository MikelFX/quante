// Supplier catalog (CLAUDE.md §13r): the e-mail a supplier receives for a paid order. Pure (only
// the HTML escaping helpers), tested in __tests__/supplier-catalog.test.mjs.
//
// It goes to the supplier's ORDER address that the operator entered in Admin, never to an
// address taken from a feed or a customer. Everything the shopper or the merchant typed is
// escaped. The supplier needs the customer's delivery details to ship — that is the purpose of
// dropshipping and the reason the merchant connects a supplier (CLAUDE.md §13r, privacy note).

import { escapeHtml as e, safeHttpUrl } from '../html.ts'

export interface SupplierOrderMail {
  supplierName: string
  storeName: string
  orderNumber: string
  orderDate: string
  confirmUrl: string
  /** Who buys from the supplier (invoice address); null when the merchant has not filled it in. */
  merchant: { name: string; ico: string; dic: string; address: string; email: string; phone: string } | null
  shipTo: {
    name: string
    street: string
    city: string
    postalCode: string
    country: string
    phone: string
    email: string
    pickupPoint: string | null
    shippingMethod: string | null
  }
  lines: Array<{ externalId: string; ean: string; name: string; quantity: number; wholesaleCents: number }>
  currency: string
}

function money(cents: number, currency: string): string {
  const v = (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')
  return `${v.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency.toUpperCase() === 'CZK' ? 'Kč' : currency.toUpperCase()}`
}

export function supplierOrderEmail(d: SupplierOrderMail): { subject: string; html: string } {
  const url = safeHttpUrl(d.confirmUrl) ?? ''
  const total = d.lines.reduce((s, l) => s + l.wholesaleCents * l.quantity, 0)
  const rows = d.lines.map((l) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace">${e(l.externalId)}${l.ean ? `<br><span style="color:#888">EAN ${e(l.ean)}</span>` : ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${e(l.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${l.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e(money(l.wholesaleCents, d.currency))}</td>
      </tr>`).join('')
  const m = d.merchant
  const merchant = m
    ? `${e(m.name)}${m.ico ? `, IČO ${e(m.ico)}` : ''}${m.dic ? `, DIČ ${e(m.dic)}` : ''}<br>${e(m.address)}<br>${e(m.email)}${m.phone ? ` · ${e(m.phone)}` : ''}`
    : `${e(d.storeName)} (fakturační údaje obchodník zatím nevyplnil — odpovězte na tento e-mail)`
  const s = d.shipTo
  const pickup = s.pickupPoint ? `<br><b>Výdejní místo:</b> ${e(s.pickupPoint)}` : ''
  const method = s.shippingMethod ? `<br><b>Doprava zvolená zákazníkem:</b> ${e(s.shippingMethod)}` : ''
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">Objednávka k odeslání</h2>
  <p style="margin:0 0 16px;color:#555">${e(d.storeName)} · č. ${e(d.orderNumber)} · ${e(d.orderDate)} · zaplaceno</p>
  <p>Dobrý den,<br>prosíme o odeslání níže uvedeného zboží přímo zákazníkovi obchodu ${e(d.storeName)}. Balte prosím bez vašich propagačních materiálů a bez dokladu s cenami.</p>
  <h3 style="margin:20px 0 6px">Doručit na</h3>
  <p style="margin:0">${e(s.name)}<br>${e(s.street)}<br>${e(s.postalCode)} ${e(s.city)}<br>${e(s.country)}<br>Tel.: ${e(s.phone || '—')} · ${e(s.email)}${pickup}${method}</p>
  <h3 style="margin:20px 0 6px">Zboží</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="background:#f6f6f6"><th style="padding:6px 8px;text-align:left">Kód</th><th style="padding:6px 8px;text-align:left">Název</th><th style="padding:6px 8px;text-align:right">Ks</th><th style="padding:6px 8px;text-align:right">Cena/ks</th></tr>
    ${rows}
    <tr><td colspan="3" style="padding:8px;text-align:right"><b>Celkem (nákupní ceny)</b></td><td style="padding:8px;text-align:right"><b>${e(money(total, d.currency))}</b></td></tr>
  </table>
  <h3 style="margin:20px 0 6px">Fakturujte</h3>
  <p style="margin:0">${merchant}</p>
  ${url ? `<p style="margin:28px 0"><a href="${e(url)}" style="background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Zadat číslo zásilky</a></p>
  <p style="color:#555;font-size:13px">Po odeslání prosím zadejte číslo zásilky přes tlačítko výše — zákazník dostane odkaz na sledování. Pokud zboží odeslat nemůžete, napište tam důvod.</p>` : ''}
  <p style="color:#888;font-size:12px;margin-top:32px">Objednávku předala platforma Quante jménem obchodu ${e(d.storeName)}. Odpovědí na tento e-mail píšete obchodníkovi.</p>
</body></html>`
  return { subject: `Objednávka k odeslání: ${d.storeName} č. ${d.orderNumber}`.slice(0, 200), html }
}
