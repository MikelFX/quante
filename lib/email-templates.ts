// Branded transactional email templates for CZ e-commerce stores.
// All functions return HTML strings ready to send via Resend.

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
  paymentMethod: 'stripe' | 'comgate' | 'gopay' | 'dobirka' | 'prevod'
  shippingMethod?: string
  zasilkovnaBranchName?: string
  shippingAddress?: {
    ulice: string
    mesto: string
    psc: string
  }
  // Store branding
  storeName: string
  accentColor: string
  merchantEmail: string
  merchantName: string
  bankovniUcet?: string
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Platební karta',
  comgate: 'Online platba',
  gopay: 'Online platba',
  dobirka: 'Dobírka',
  prevod: 'Bankovní převod',
}

function fmt(amount: number, currency: string) {
  return `${amount.toFixed(2).replace('.', ',')} ${currency}`
}

function itemRows(items: OrderItem[], currency: string) {
  return items.map((item) => `
    <tr>
      <td style="padding:10px 16px;font-size:14px;border-bottom:1px solid #f0f0f0">${item.name}</td>
      <td style="padding:10px 16px;font-size:14px;text-align:center;border-bottom:1px solid #f0f0f0;color:#666">${item.quantity}×</td>
      <td style="padding:10px 16px;font-size:14px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600">${fmt(item.price * item.quantity, currency)}</td>
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
      <div style="background:${accentColor};padding:24px 28px">
        <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em">${storeName}</p>
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
          Číslo účtu: <strong>${d.bankovniUcet ?? '—'}</strong><br>
          Variabilní symbol: <strong>${d.orderNumber}</strong><br>
          Částka: <strong>${fmt(d.total, d.currency)}</strong>
        </p>
      </div>`
    : isDobirka
    ? `<p style="font-size:13px;color:#555;line-height:1.6;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
        Platíte při převzetí zásilky. Připravte si prosím přesnou hotovost nebo platební kartu.
      </p>`
    : ''

  const shippingNote = d.zasilkovnaBranchName
    ? `<p style="font-size:13px;color:#555">Výdejní místo Zásilkovna: <strong>${d.zasilkovnaBranchName}</strong></p>`
    : d.shippingAddress
    ? `<p style="font-size:13px;color:#555">Adresa doručení: ${d.shippingAddress.ulice}, ${d.shippingAddress.psc} ${d.shippingAddress.mesto}</p>`
    : ''

  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Objednávka přijata ✓</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Děkujeme za váš nákup, ${d.customerName}!</p>

    <p style="margin:0 0 4px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.06em">Číslo objednávky</p>
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#111;font-family:monospace">${d.orderNumber}</p>

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
      ${d.shippingCost > 0 ? `<tr><td style="padding:6px 16px;font-size:13px;color:#666">Doprava</td><td style="padding:6px 16px;font-size:13px;text-align:right">${fmt(d.shippingCost, d.currency)}</td></tr>` : ''}
      ${d.dobirkaFee > 0 ? `<tr><td style="padding:6px 16px;font-size:13px;color:#666">Dobírka</td><td style="padding:6px 16px;font-size:13px;text-align:right">${fmt(d.dobirkaFee, d.currency)}</td></tr>` : ''}
      <tr style="border-top:2px solid #111">
        <td style="padding:10px 16px;font-size:15px;font-weight:700">Celkem</td>
        <td style="padding:10px 16px;font-size:15px;font-weight:700;text-align:right">${fmt(d.total, d.currency)}</td>
      </tr>
    </table>

    <p style="font-size:13px;color:#666;margin:0 0 4px">Způsob platby: <strong>${PAYMENT_LABELS[d.paymentMethod] ?? d.paymentMethod}</strong></p>
    ${shippingNote}
    ${paymentNote}
  `

  const footer = `
    <p style="margin:0;font-size:12px;color:#999;line-height:1.6">
      Dotazy? Napište nám na <a href="mailto:${d.merchantEmail}" style="color:#6f78e6">${d.merchantEmail}</a><br>
      <strong>${d.merchantName}</strong>
    </p>
  `

  return {
    subject: `Potvrzení objednávky ${d.orderNumber} — ${d.storeName}`,
    html: baseWrapper(d.storeName, d.accentColor, content, footer),
  }
}

// ─── Payment confirmed ────────────────────────────────────────────────────────

export function paymentConfirmedEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'total' | 'currency' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'> & { invoiceUrl?: string }): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Platba přijata ✓</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vaše platba byla úspěšně zpracována, ${d.customerName}.</p>

    <p style="margin:0 0 4px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.06em">Objednávka</p>
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;font-family:monospace">${d.orderNumber}</p>
    <p style="margin:0 0 20px;font-size:15px;font-weight:700">Zaplaceno: ${fmt(d.total, d.currency)}</p>

    <p style="font-size:14px;color:#555;line-height:1.7">
      Vaše objednávka je nyní potvrzena a bude co nejdříve připravena k odeslání.
      O expedici vás budeme informovat dalším e-mailem.
    </p>

    ${d.invoiceUrl ? `
    <a href="${d.invoiceUrl}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#f4f4f6;color:#111;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">
      Zobrazit fakturu →
    </a>` : ''}
  `

  return {
    subject: `Platba přijata — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, `<p style="margin:0;font-size:12px;color:#999">Dotazy: <a href="mailto:${d.merchantEmail}" style="color:#6f78e6">${d.merchantEmail}</a> · <strong>${d.merchantName}</strong></p>`),
  }
}

// ─── Shipping notification ────────────────────────────────────────────────────

export function shippingEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'> & { trackingUrl?: string; trackingCode?: string; carrier?: string }): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Zásilka odeslána ✈</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vaše objednávka ${d.orderNumber} je na cestě!</p>
    ${d.carrier ? `<p style="font-size:14px;color:#555">Dopravce: <strong>${d.carrier}</strong></p>` : ''}
    ${d.trackingCode ? `<p style="font-size:14px;color:#555">Číslo zásilky: <strong style="font-family:monospace">${d.trackingCode}</strong></p>` : ''}
    ${d.trackingUrl ? `
      <a href="${d.trackingUrl}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Sledovat zásilku →
      </a>` : ''}
  `

  return {
    subject: `Zásilka odeslána — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, `<p style="margin:0;font-size:12px;color:#999">Dotazy: <a href="mailto:${d.merchantEmail}" style="color:#6f78e6">${d.merchantEmail}</a> · <strong>${d.merchantName}</strong></p>`),
  }
}

// ─── Refund confirmation ──────────────────────────────────────────────────────

export function refundEmail(d: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'total' | 'currency' | 'storeName' | 'accentColor' | 'merchantEmail' | 'merchantName'>): { subject: string; html: string } {
  const content = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">Vrácení peněz potvrzeno</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Vracíme vám platbu za objednávku ${d.orderNumber}, ${d.customerName}.</p>

    <p style="font-size:15px;font-weight:700;margin:0 0 12px">Vracená částka: ${fmt(d.total, d.currency)}</p>
    <p style="font-size:14px;color:#555;line-height:1.7">
      Peníze by měly dorazit na váš účet do 3–5 pracovních dnů v závislosti na vaší bance.
    </p>
  `

  return {
    subject: `Vrácení platby — ${d.orderNumber}`,
    html: baseWrapper(d.storeName, d.accentColor, content, `<p style="margin:0;font-size:12px;color:#999">Dotazy: <a href="mailto:${d.merchantEmail}" style="color:#6f78e6">${d.merchantEmail}</a> · <strong>${d.merchantName}</strong></p>`),
  }
}

// ─── Resend helper ────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string, from = 'objednavky@quante.io'): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) console.error('[email] Resend error:', res.status, await res.text())
    return res.ok
  } catch (err) {
    console.error('[email] send failed:', err)
    return false
  }
}

// Looks up the configured from-address for a project (falls back to platform default).
// Call this before sendEmail when you have a projectId available.
export async function getProjectFromEmail(projectId: string): Promise<string> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data } = await supabaseAdmin
      .from('project_secrets')
      .select('resend_from_email')
      .eq('project_id', projectId)
      .maybeSingle()
    return (data?.resend_from_email as string | null) ?? 'objednavky@quante.io'
  } catch {
    return 'objednavky@quante.io'
  }
}
