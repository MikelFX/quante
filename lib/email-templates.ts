// Branded transactional email templates for CZ e-commerce stores.
// All functions return HTML strings ready to send via Resend.
//
// SECURITY: every value interpolated into these templates can come from an anonymous
// shopper (checkout body → store_orders), a merchant, or the AI (store name / colours).
// Everything goes through escapeHtml, colours through safeColor, and every href
// through safeHref (https only). Never interpolate a raw value into markup here.

import { escapeHtml, safeHttpUrl } from '@/lib/html'

export interface OrderItem {
  name: string
  quantity: number
  price: number
  currency: string
}

export interface OrderEmailData {
  orderNumber: string
  customerName: string
  customerEmail: string
  items: OrderItem[]
  subtotal: number
  shippingCost: number
  dobirkaFee: number
  total: number
  currency: string
  paymentMethod: 'stripe' | 'comgate' | 'gopay' | 'paypal' | 'dobirka' | 'prevod'
  shippingMethod?: string
  zasilkovnaBranchName?: string
  shippingAddress?: {
    ulice: string
    mesto: string
    psc: string
    zeme?: string
  }
  // Store branding
  storeName: string
  accentColor: string
  /** Merchant contact shown to the customer. Omitted from the email when missing (white-label: never a Quante address). */
  merchantEmail?: string | null
  merchantName: string
  bankovniUcet?: string
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Platební karta',
  comgate: 'Online platba',
  gopay: 'Online platba',
  paypal: 'PayPal',
  dobirka: 'Dobírka',
  prevod: 'Bankovní převod',
}

const e = escapeHtml

// Platform-owned sending domains. A merchant may never send "as" these (except via the
// fixed platform mailboxes below), and a Quante address is never shown to a store's
// customers as the merchant contact.
const PLATFORM_EMAIL_DOMAINS = ['quantecode.com', 'quante.vercel.app']
const PLATFORM_MAILBOXES = new Set(['objednavky', 'orders', 'contact', 'billing', 'support', 'info', 'noreply', 'no-reply'])
export const PLATFORM_ORDER_SENDER = 'objednavky@quantecode.com'

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** A single, plain email address (no display name, no list, no CR/LF), max 254 chars. */
export function isValidEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v)
}

function emailDomain(addr: string): string {
  return addr.slice(addr.lastIndexOf('@') + 1).toLowerCase()
}

function isPlatformDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  const hostingRoot = (process.env.HOSTING_ROOT_DOMAIN ?? 'stores.quantecode.com').toLowerCase()
  return [...PLATFORM_EMAIL_DOMAINS, hostingRoot, 'vercel.app'].some((p) => d === p || d.endsWith(`.${p}`))
}

// Accent colour goes into a style attribute — only a plain hex colour is allowed.
function safeColor(c: unknown, fallback = '#111111'): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : fallback
}

// https-only link target, already escaped for an attribute; null when unsafe.
function safeHref(u: unknown): string | null {
  const url = safeHttpUrl(u)
  if (!url || !url.startsWith('https://')) return null
  return e(url)
}

// Merchant- or shopper-authored text in store mails (store / merchant name, product
// names, shipping label, carrier, customer name, bank account …) is plain text, never a
// link (final audit F8):
//   - the text is NFKC-normalised and every IDNA label separator (U+3002, U+FF0E,
//     U+FF61) becomes '.', so full-width / ideographic dots can't smuggle a domain past
//     the rules below;
//   - explicit links (scheme URLs, www. hosts, mailto:/javascript:/data: tokens) are
//     removed and the result is length-capped;
//   - the dot of anything left that still looks like a host — `label.label` with a
//     letter after the dot, or a dotted IPv4 address — is replaced by a middle dot
//     (U+00B7). That is not a label separator in any URL / IDNA parser (unlike a
//     zero-width space, which data detectors may skip, or U+2024, which NFKC maps back
//     to '.'), so no mail client can turn "evil.example/login" or "45.12.3.4/login"
//     into a link.
// Returns raw text — still escape it (e) before putting it in markup.
const HOST_DOT = '\u00B7'
export function linkFreeText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  let s = v.normalize('NFKC')
    .replace(/[\u3002\uFF0E\uFF61]/g, '.')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g, ' ')
  s = s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ')
    .replace(/\bwww\.\S*/gi, ' ')
    .replace(/\b(?:mailto|javascript|vbscript|data|file|tel|sms):\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`
  return s
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (ip) => ip.replace(/\./g, HOST_DOT))
    .replace(/([\p{L}\p{N}_-])\.(?=\p{L})/gu, `$1${HOST_DOT}`)
}

// Tracking links become the "Sledovat zásilku" button of the shipped mail. Only carrier
// tracking pages qualify (final audit F8 follow-up): a link to any other host is
// dropped (the tracking number itself is still shown), so a caller that can set the
// URL (the store-key order API, a fulfillment provider) can't put its own page behind
// the button of a platform-sent mail.
const CARRIER_TRACKING_DOMAINS = [
  // Packeta / Zásilkovna
  'packeta.com', 'packeta.cz', 'packeta.sk', 'zasilkovna.cz',
  // GLS
  'gls-group.eu', 'gls-group.com', 'gls-czech.com', 'gls-slovakia.sk', 'gls-pakete.de', 'mygls.cz', 'mygls.sk', 'mygls.hu',
  // DHL / Deutsche Post
  'dhl.com', 'dhl.de', 'dhl.cz', 'dhl.sk', 'dhlparcel.cz', 'dhlparcel.sk', 'deutschepost.de',
  // PPL, DPD, Czech / Slovak post and other CZ / SK carriers
  'ppl.cz', 'dpd.com', 'dpd.cz', 'dpd.sk', 'dpd.de', 'postaonline.cz', 'ceskaposta.cz', 'balikovna.cz', 'posta.sk',
  'wedo.cz', 'geis-group.cz', 'geis.cz', 'toptrans.cz', 'sps-sro.sk', 'intime.cz', 'fofr.cz',
  // International carriers, fulfillment and tracking aggregators
  'ups.com', 'fedex.com', 'tnt.com', 'usps.com', 'royalmail.com', 'inpost.pl', 'inpost.eu', 'inpost.cz',
  'hermesworld.com', 'myhermes.de', 'evri.com', 'postnl.nl', 'bpost.be', 'posti.fi', 'postnord.com',
  'getbyrd.com', 'byrd.io', '17track.net', 'aftership.com', 'parcelsapp.com',
]

/** https URL on a known carrier tracking host, or null. */
export function carrierTrackingUrl(u: unknown): string | null {
  const url = safeHttpUrl(u)
  if (!url || !url.startsWith('https://')) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
  return CARRIER_TRACKING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? url : null
}

// Shopper-authored name used in a greeting ("Děkujeme …, <name>") — link-free.
function greetingName(name: unknown): string {
  return linkFreeText(name, 80) || 'zákazníku'
}

/** Product names in customer mails (F8): plain text, at most 80 characters. */
export const MAIL_PRODUCT_NAME_MAX = 80
/** Store / merchant names in customer mails. */
const MAIL_NAME_MAX = 80

function num(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function fmt(amount: number, currency: string) {
  return `${num(amount).toFixed(2).replace('.', ',')} ${e(currency)}`
}

// Merchant contact line for customer-facing footers. A missing or platform-owned
// address is omitted entirely rather than showing a Quante mailbox (white-label).
function contactLine(merchantEmail: string | null | undefined, merchantName: string): string {
  const email = isValidEmail(merchantEmail) && !isPlatformDomain(emailDomain(merchantEmail)) ? merchantEmail : null
  const cleanName = linkFreeText(merchantName, MAIL_NAME_MAX)
  const name = cleanName ? `<strong>${e(cleanName)}</strong>` : ''
  if (!email) return name ? `<p style="margin:0;font-size:12px;color:#999">${name}</p>` : ''
  return `<p style="margin:0;font-size:12px;color:#999;line-height:1.6">Dotazy? Napište nám na <a href="mailto:${e(email)}" style="color:#6f78e6">${e(email)}</a>${name ? `<br>${name}` : ''}</p>`
}

// Shopper-authored address — link-free like every other free text in these mails.
function addressLine(a?: { ulice: string; mesto: string; psc: string; zeme?: string } | null): string {
  if (!a) return ''
  const t = (v: unknown, max: number) => e(linkFreeText(v, max))
  return `${t(a.ulice, 200)}, ${t(a.psc, 20)} ${t(a.mesto, 120)}${a.zeme ? `, ${t(a.zeme, 60)}` : ''}`
}

function itemRows(items: OrderItem[], currency: string) {
  return items.map((item) => `
    <tr>
      <td style="padding:10px 16px;font-size:14px;border-bottom:1px solid #f0f0f0">${e(linkFreeText(item.name, MAIL_PRODUCT_NAME_MAX))}</td>
      <td style="padding:10px 16px;font-size:14px;text-align:center;border-bottom:1px solid #f0f0f0;color:#666">${num(item.quantity)}×</td>
      <td style="padding:10px 16px;font-size:14px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600">${fmt(num(item.price) * num(item.quantity), currency)}</td>
    </tr>`).join('')
}

function baseWrapper(storeName: string, accentColor: string, content: string, footer: string) {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
      <!-- Header -->
      <div style="background:${safeColor(accentColor)};padding:24px 28px">
        <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em">${e(linkFreeText(storeName, MAIL_NAME_MAX))}</p>
      </div>
      <!-- Body -->
      <div style="padding:28px">
        ${content}
      </div>
      <!-- Footer -->
      <div style="background:#fafafa;border-top:1px solid #f0f0f0;padding:16px 28px">
        ${footer}
      </div>
    </div>
  </div>
</body>
</html>`
}

// ─── Order confirmation ────────────────────────────────────────────────────────

export function orderConfirmationEmail(d: OrderEmailData): { subject: string; html: string } {
  const isPrevod = d.paymentMethod === 'prevod'
  const isDobirka = d.paymentMethod === 'dobirka'

  const paymentNote = isPrevod
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin:16px 0">
        <p style="margin:0 0 6px;font-weight:600;font-size:13px;color:#92400e">Platební instrukce</p>
        <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6">
          Číslo účtu: <strong>${d.bankovniUcet ? e(linkFreeText(d.bankovniUcet, 80)) || '—' : '—'}</strong><br>
          Variabilní symbol: <strong>${e(d.orderNumber)}</strong><br>
          Částka: <strong>${fmt(d.total, d.currency)}</strong>
        </p>
      </div>`
    : isDobirka
    ? `<p style="font-size:13px;color:#555;line-height:1.6;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
        Platíte při převzetí zásilky. Připravte si prosím přesnou hotovost nebo platební kartu.
      </p>`
    : ''

  const shippingNote = d.zasilkovnaBranchName
    ? `<p style="font-size:13px;color:#555">Výdejní místo Zásilkovna: <strong>${e(linkFreeText(d.zasilkovnaBranchName, 120))}</strong></p>`
    : d.shippingAddress
    ? `<p style="font-size:13px;color:#555">Adresa doručení: ${addressLine(d.shippingAddress)}</p>`
    : ''

  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Objednávka přijata ✓</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Děkujeme za váš nákup, ${e(greetingName(d.customerName))}!</p>

    <p style="margin:0 0 4px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.06em">Číslo objednávky</p>
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#111;font-family:monospace">${e(d.orderNumber)}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
      <thead>
        <tr style="background:#f9f9f9">
          <th style="padding:10px 16px;font-size:11px;color:#999;text-align:left;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #f0f0f0">Zboží</th>
          <th style="padding:10px 16px;font-size:11px;color:#999;text-align:center;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #f0f0f0">Ks</th>
          <th style="padding:10px 16px;font-size:11px;color:#999;text-align:right;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #f0f0f0">Cena</th>
        </tr>
      </thead>
      <tbody>${itemRows(d.items, d.currency)}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:6px 16px;font-size:13px;color:#666">Zboží celkem</td>
        <td style="padding:6px 16px;font-size:13px;text-align:right">${fmt(d.subtotal, d.currency)}</td>
      </tr>
      ${num(d.shippingCost) > 0 ? `<tr><td style="padding:6px 16px;font-size:13px;color:#666">Doprava</td><td style="padding:6px 16px;font-size:13px;text-align:right">${fmt(d.shippingCost, d.currency)}</td></tr>` : ''}
      ${num(d.dobirkaFee) > 0 ? `<tr><td style="padding:6px 16px;font-size:13px;color:#666">Dobírka</td><td style="padding:6px 16px;font-size:13px;text-align:right">${fmt(d.dobirkaFee, d.currency)}</td></tr>` : ''}
      <tr style="border-top:2px solid #111">
        <td style="padding:10px 16px;font-size:15px;font-weight:700">Celkem</td>
        <td style="padding:10px 16px;font-size:15px;font-weight:700;text-align:right">${fmt(d.total, d.currency)}</td>
      </tr>
    </table>

    <p style="font-size:13px;color:#666;margin:0 0 4px">Způsob platby: <strong>${e(PAYMENT_LABELS[d.paymentMethod] ?? d.paymentMethod)}</strong></p>
    ${shippingNote}
    ${paymentNote}
  `

  return {
    subject: `Potvrzení objednávky ${d.orderNumber} — ${linkFreeText(d.storeName, MAIL_NAME_MAX)}`,
    html: baseWrapper(d.storeName, d.accentColor, content, contactLine(d.merchantEmail, d.merchantName)),
  }
}

// ─── Payment confirmed ────────────────────────────────────────────────────────

export function paymentConfirmedEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'total' | 'currency' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'> & { invoiceUrl?: string }): { subject: string; html: string } {
  const invoiceHref = safeHref(d.invoiceUrl)
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Platba přijata ✓</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vaše platba byla úspěšně zpracována, ${e(greetingName(d.customerName))}.</p>

    <p style="margin:0 0 4px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.06em">Objednávka</p>
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;font-family:monospace">${e(d.orderNumber)}</p>
    <p style="margin:0 0 20px;font-size:15px;font-weight:700">Zaplaceno: ${fmt(d.total, d.currency)}</p>

    <p style="font-size:14px;color:#555;line-height:1.7">
      Vaše objednávka je nyní potvrzena a bude co nejdříve připravena k odeslání.
      O expedici vás budeme informovat dalším e-mailem.
    </p>

    ${invoiceHref ? `
    <a href="${invoiceHref}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#f4f4f6;color:#111;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">
      Zobrazit fakturu →
    </a>` : ''}
  `

  return {
    subject: `Platba přijata — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, contactLine(d.merchantEmail, d.merchantName)),
  }
}

// ─── Shipping notification ────────────────────────────────────────────────────

export function shippingEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'> & { trackingUrl?: string; trackingCode?: string; carrier?: string }): { subject: string; html: string } {
  // The button only for a carrier tracking page; carrier name and tracking number can be
  // caller-chosen text (store-key order API), so they are link-free too.
  const tracking = carrierTrackingUrl(d.trackingUrl)
  const trackingHref = tracking ? e(tracking) : null
  const carrier = linkFreeText(d.carrier, 60)
  const trackingCode = linkFreeText(d.trackingCode, 100)
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Zásilka odeslána ✈</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vaše objednávka ${e(d.orderNumber)} je na cestě!</p>
    ${carrier ? `<p style="font-size:14px;color:#555">Dopravce: <strong>${e(carrier)}</strong></p>` : ''}
    ${trackingCode ? `<p style="font-size:14px;color:#555">Číslo zásilky: <strong style="font-family:monospace">${e(trackingCode)}</strong></p>` : ''}
    ${trackingHref ? `
      <a href="${trackingHref}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Sledovat zásilku →
      </a>` : ''}
  `

  return {
    subject: `Zásilka odeslána — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, contactLine(d.merchantEmail, d.merchantName)),
  }
}

// ─── Refund confirmation ──────────────────────────────────────────────────────

export function refundEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'total' | 'currency' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'>): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Vrácení peněz potvrzeno</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vracíme vám platbu za objednávku ${e(d.orderNumber)}, ${e(greetingName(d.customerName))}.</p>

    <p style="font-size:15px;font-weight:700;margin:0 0 12px">Vracená částka: ${fmt(d.total, d.currency)}</p>
    <p style="font-size:14px;color:#555;line-height:1.7">
      Peníze by měly dorazit na váš účet do 3–5 pracovních dnů v závislosti na vaší bance.
    </p>
  `

  return {
    subject: `Vrácení platby — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, contactLine(d.merchantEmail, d.merchantName)),
  }
}

// ─── Merchant: new order notification ────────────────────────────────────────

export interface MerchantOrderEmailData {
  orderNumber: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  items: OrderItem[]
  total: number
  currency: string
  paymentMethod: string
  shippingMethod?: string
  shippingAddress?: { ulice: string; mesto: string; psc: string; zeme?: string }
  storeName: string
  accentColor: string
  adminUrl?: string  // link to the Studio admin orders tab
}

// SECURITY (final audit F8 follow-up): the merchant address this goes to is set by the
// merchant and never verified, and unpaid orders reach it straight from the public
// checkout — so every free text here (product names, shopper name / phone / address,
// shipping label, store name) is link-free and length-capped like the customer mails.
export function merchantNewOrderEmail(d: MerchantOrderEmailData): { subject: string; html: string } {
  const storeName = linkFreeText(d.storeName, MAIL_NAME_MAX)
  const shippingMethod = linkFreeText(d.shippingMethod, 80)
  const customerPhone = linkFreeText(d.customerPhone, 40)
  const rows = d.items.map((i) => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0">${e(linkFreeText(i.name, MAIL_PRODUCT_NAME_MAX))}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid #f0f0f0;color:#666">${num(i.quantity)}×</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600">${fmt(num(i.price) * num(i.quantity), d.currency)}</td>
    </tr>`).join('')

  const adminHref = safeHref(d.adminUrl)
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Nová objednávka</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Objednávka #${e(d.orderNumber)} dorazila do vašeho obchodu.</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      <thead>
        <tr style="background:#f9f9f9">
          <th style="padding:8px 12px;font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:.05em;color:#666">Produkt</th>
          <th style="padding:8px 12px;font-size:12px;text-align:center;text-transform:uppercase;letter-spacing:.05em;color:#666">Množství</th>
          <th style="padding:8px 12px;font-size:12px;text-align:right;text-transform:uppercase;letter-spacing:.05em;color:#666">Cena</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:10px 12px;font-size:14px;font-weight:700">Celkem</td>
          <td style="padding:10px 12px;font-size:15px;font-weight:700;text-align:right">${fmt(d.total, d.currency)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="background:#f9f9f9;border-radius:8px;padding:14px 16px;margin:0 0 16px;font-size:13px;line-height:1.7;color:#444">
      <p style="margin:0 0 4px"><strong>Zákazník:</strong> ${e(linkFreeText(d.customerName, 120) || '—')} (${e(d.customerEmail)}${customerPhone ? `, ${e(customerPhone)}` : ''})</p>
      ${d.shippingAddress ? `<p style="margin:0 0 4px"><strong>Adresa:</strong> ${addressLine(d.shippingAddress)}</p>` : ''}
      ${shippingMethod ? `<p style="margin:0 0 4px"><strong>Doprava:</strong> ${e(shippingMethod)}</p>` : ''}
      <p style="margin:0"><strong>Platba:</strong> ${e(linkFreeText(d.paymentMethod, 40))}</p>
    </div>

    ${adminHref ? `<a href="${adminHref}" style="display:inline-block;padding:10px 20px;background:${safeColor(d.accentColor)};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:4px">Zobrazit objednávku →</a>` : ''}
  `

  return {
    subject: `Nová objednávka #${d.orderNumber} — ${num(d.total).toFixed(2).replace('.', ',')} ${d.currency}`,
    html: baseWrapper(d.storeName, d.accentColor, content, `<p style="margin:0;font-size:12px;color:#999">Správa obchodu: <strong>${e(storeName)}</strong></p>`),
  }
}

// ─── Merchant: low stock alert ────────────────────────────────────────────────

export interface LowStockEmailData {
  productName: string
  variantName?: string
  stockQty: number
  threshold: number
  storeName: string
  accentColor: string
  adminUrl?: string
}

export function merchantLowStockEmail(d: LowStockEmailData): { subject: string; html: string } {
  // Link-free like the other merchant mails (unverified merchant address).
  const productName = linkFreeText(d.productName, MAIL_PRODUCT_NAME_MAX)
  const variantName = linkFreeText(d.variantName, MAIL_PRODUCT_NAME_MAX)
  const storeName = linkFreeText(d.storeName, MAIL_NAME_MAX)
  const productLabel = variantName ? `${productName} — ${variantName}` : productName
  const adminHref = safeHref(d.adminUrl)
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Upozornění: Nízký sklad</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Produkt v obchodě <strong>${e(storeName)}</strong> dosáhl kritické hranice zásob.</p>

    <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;margin:0 0 20px">
      <p style="margin:0 0 6px;font-weight:600;font-size:15px;color:#c2410c">${e(productLabel)}</p>
      <p style="margin:0;font-size:14px;color:#9a3412">Zbývá <strong>${num(d.stockQty)} ks</strong> (práh upozornění: ${num(d.threshold)} ks)</p>
    </div>

    ${adminHref ? `<a href="${adminHref}" style="display:inline-block;padding:10px 20px;background:${safeColor(d.accentColor)};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Doplnit zásoby →</a>` : ''}
  `

  return {
    subject: `Nízký sklad: ${productLabel} (${num(d.stockQty)} ks) — ${storeName}`,
    html: baseWrapper(d.storeName, d.accentColor, content, `<p style="margin:0;font-size:12px;color:#999">Upozornění z obchodu <strong>${e(storeName)}</strong></p>`),
  }
}

// ─── Platform: hosting expiry reminder (to store owner) ──────────────────────

export interface HostingReminderEmailData {
  storeName: string
  storeUrl: string | null
  endsAt: string          // ISO date
  daysLeft: number        // 7 or 1
  isTrial: boolean
  projectUrl: string      // link to the Studio
}

export function hostingReminderEmail(d: HostingReminderEmailData): { subject: string; html: string } {
  const endDate = new Date(d.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const what = d.isTrial ? 'free hosting trial' : 'hosting plan'
  const urgency = d.daysLeft === 1 ? 'tomorrow' : `in ${num(d.daysLeft)} days`
  const storeHref = safeHref(d.storeUrl)
  const projectHref = safeHref(d.projectUrl)

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem;color:#111">
      <h2 style="margin:0 0 8px;font-size:20px">Your ${what} ends ${urgency}</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6">
        The ${what} for <strong>${e(d.storeName)}</strong> ends on <strong>${e(endDate)}</strong>.
        After that your store${storeHref ? ` at <a href="${storeHref}" style="color:#6f78e6">${e((d.storeUrl ?? '').replace('https://', ''))}</a>` : ''} will be paused and visitors will see a maintenance page.
      </p>
      <div style="background:#f6f6f8;border-radius:8px;padding:14px 16px;margin:0 0 20px">
        <p style="margin:0;font-size:13px;color:#555;line-height:1.6">
          Keep your store live with a hosting plan: <strong>$99 / year</strong> or <strong>$9.99 / month</strong>.
          Your store data is never deleted — you can reactivate anytime.
        </p>
      </div>
      ${projectHref ? `<a href="${projectHref}" style="display:inline-block;padding:10px 20px;background:#6f78e6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Subscribe now →</a>` : ''}
      <p style="margin:24px 0 0;font-size:12px;color:#999">Sent by Quante · quantecode.com</p>
    </div>
  `
  return {
    subject: `Your ${what} for ${d.storeName} ends ${urgency}`,
    html,
  }
}

// ─── Platform: hosting suspended (to store owner) ─────────────────────────────

export interface HostingSuspendedEmailData {
  storeName: string
  storeUrl: string | null
  projectUrl: string
}

export function hostingSuspendedEmail(d: HostingSuspendedEmailData): { subject: string; html: string } {
  const storeHref = safeHref(d.storeUrl)
  const projectHref = safeHref(d.projectUrl)
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:2rem 1rem;color:#111">
      <h2 style="margin:0 0 8px;font-size:20px">Your store has been paused</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6">
        Hosting for <strong>${e(d.storeName)}</strong> has expired.
        ${storeHref ? `Visitors to <a href="${storeHref}" style="color:#6f78e6">${e((d.storeUrl ?? '').replace('https://', ''))}</a> now see a maintenance page.` : 'Visitors now see a maintenance page.'}
      </p>
      <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;margin:0 0 20px">
        <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.6">
          <strong>Nothing is lost.</strong> Your store, products and orders are safely stored for at least 90 days.
          Subscribe ($99 / year or $9.99 / month) and your store goes back online automatically.
        </p>
      </div>
      ${projectHref ? `<a href="${projectHref}" style="display:inline-block;padding:10px 20px;background:#6f78e6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Restore my store →</a>` : ''}
      <p style="margin:24px 0 0;font-size:12px;color:#999">Sent by Quante · quantecode.com</p>
    </div>
  `
  return {
    subject: `${d.storeName} is paused — hosting expired`,
    html,
  }
}

// ─── Resend helper ────────────────────────────────────────────────────────────

// Display names end up in a mail header: strip anything that could break out of it
// (quotes, angle brackets, CR/LF, control chars) and anything impersonating Quante.
export function sanitizeDisplayName(name: unknown): string {
  if (typeof name !== 'string') return ''
  // No links or addresses in a display name either (F8): scheme URLs / www. hosts are
  // dropped, '@' and dotted IPv4 addresses are removed, and a bare host ("paypal.com",
  // also with full-width / ideographic dots after NFKC) keeps only its first label, so
  // neither "support@bank.example" nor "paypal.com Security" can pose as the sender.
  const clean = name
    .normalize('NFKC')
    .replace(/[\u3002\uFF0E\uFF61]/g, '.')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ')
    .replace(/\bwww\.\S*/gi, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF"<>\\@]/g, ' ')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ' ')
    .replace(/([\p{L}\p{N}_-]+)(?:\.(?=\p{L})[\p{L}\p{N}_-]+)+/gu, '$1')
    .replace(/\s+/g, ' ').trim().slice(0, 60)
  if (/quante/i.test(clean)) return ''
  return clean
}

/**
 * Re-builds a From header from `Name <addr>` or a bare address. A platform-domain
 * address is only allowed for the fixed platform mailboxes; anything unparsable or
 * disallowed falls back to the platform order sender. Returns a header-safe string.
 */
function normalizeFrom(from: string): string {
  const m = from.match(/^\s*(?:"?([^"<>\r\n]*?)"?\s*)?<([^<>\s]+)>\s*$/)
  const rawName = m ? (m[1] ?? '') : ''
  const addr = (m ? m[2] : from.trim()) ?? ''
  if (!isValidEmail(addr)) return PLATFORM_ORDER_SENDER

  const domain = emailDomain(addr)
  if (isPlatformDomain(domain)) {
    const local = addr.slice(0, addr.lastIndexOf('@')).toLowerCase()
    if (!PLATFORM_MAILBOXES.has(local) || !PLATFORM_EMAIL_DOMAINS.includes(domain)) return PLATFORM_ORDER_SENDER
    // Platform's own mailboxes may carry the "Quante" display name (billing mails).
    const name = rawName.replace(/[\u0000-\u001f\u007f"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    return name ? `"${name}" <${addr}>` : addr
  }
  const name = sanitizeDisplayName(rawName)
  return name ? `"${name}" <${addr}>` : addr
}

export async function sendEmail(to: string, subject: string, html: string, from = PLATFORM_ORDER_SENDER): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  // Exactly one plain recipient — never a list, a display-name string or a header injection.
  if (!isValidEmail(to)) {
    console.error('[email] refusing to send: invalid recipient')
    return false
  }
  const safeSubject = String(subject ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').slice(0, 250)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: normalizeFrom(from), to, subject: safeSubject, html }),
    })
    if (!res.ok) console.error('[email] Resend error:', res.status, await res.text())
    return res.ok
  } catch (err) {
    console.error('[email] send failed:', err)
    return false
  }
}

/**
 * From header for a project's store mail. The merchant's own resend_from_email is used
 * only when its domain (or a parent of it) is a custom domain VERIFIED for this project
 * and is not a platform domain; otherwise the platform order mailbox is used. The store
 * name, when given, is only ever used as the display name.
 */
export async function getProjectFromEmail(projectId: string, storeName?: string): Promise<string> {
  const displayName = sanitizeDisplayName(storeName)
  const fallback = displayName ? `"${displayName}" <${PLATFORM_ORDER_SENDER}>` : PLATFORM_ORDER_SENDER
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data } = await supabaseAdmin
      .from('project_secrets')
      .select('resend_from_email')
      .eq('project_id', projectId)
      .maybeSingle()
    const configured = typeof data?.resend_from_email === 'string' ? data.resend_from_email.trim() : ''
    if (!configured || !isValidEmail(configured)) return fallback

    const domain = emailDomain(configured)
    if (isPlatformDomain(domain)) return fallback

    const verified = await getVerifiedProjectDomains(projectId)
    const ok = verified.some((d) => domain === d || domain.endsWith(`.${d}`))
    if (!ok) return fallback
    return displayName ? `"${displayName}" <${configured}>` : configured
  } catch {
    return fallback
  }
}

async function getVerifiedProjectDomains(projectId: string): Promise<string[]> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const out = new Set<string>()
  const { data: rows } = await supabaseAdmin
    .from('user_domains')
    .select('domain, status, dns_verified')
    .eq('project_id', projectId)
  for (const r of (rows ?? []) as Array<{ domain: string | null; status: string | null; dns_verified: boolean | null }>) {
    if (r.domain && (r.status === 'active' || r.dns_verified === true)) out.add(r.domain.toLowerCase().replace(/^www\./, ''))
  }
  const { data: proj } = await supabaseAdmin
    .from('projects')
    .select('custom_domain, custom_domain_verified')
    .eq('id', projectId)
    .maybeSingle()
  const p = proj as { custom_domain?: string | null; custom_domain_verified?: boolean | null } | null
  if (p?.custom_domain && p.custom_domain_verified) out.add(p.custom_domain.toLowerCase().replace(/^www\./, ''))
  return [...out].filter((d) => !isPlatformDomain(d))
}
