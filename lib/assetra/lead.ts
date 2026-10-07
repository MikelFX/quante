// AssetraDigital lead form (homepage „Odeslat poptávku“): input validation and the
// notification e-mail. Pure functions, no imports from the app — tested in
// __tests__/assetra-leads.test.mjs.

export const LEAD_NEEDS = ['Firemní web', 'E-shop', 'Správa', 'Něco jiného'] as const
export type LeadNeed = (typeof LEAD_NEEDS)[number]

export interface LeadInput {
  jmeno: string
  kontakt: string
  potreba: LeadNeed | ''
  zprava: string
}

export type LeadCheck =
  | { ok: true; lead: LeadInput; contactEmail: string | null; spam: false }
  | { ok: true; spam: true }
  | { ok: false; error: string }

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const PHONE_RE = /^[+\d\s().-]{9,24}$/
/** Humans need a moment to fill the form in; bots submit instantly. */
export const MIN_FILL_MS = 2500

// One-line fields lose control chars and line breaks; the message keeps line breaks only.
const line = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max) : ''

export function checkLead(body: unknown): LeadCheck {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Honeypot filled or submitted faster than a person can type: pretend success, store nothing.
  const ms = typeof b.ms === 'number' ? b.ms : Number(b.ms)
  if ((typeof b.web === 'string' && b.web.trim() !== '') || !Number.isFinite(ms) || ms < MIN_FILL_MS) {
    return { ok: true, spam: true }
  }

  const jmeno = line(b.jmeno, 120)
  const kontakt = line(b.kontakt, 160)
  const zprava = text(b.zprava, 4000)
  const potrebaRaw = line(b.potreba, 40)
  const potreba = (LEAD_NEEDS as readonly string[]).includes(potrebaRaw) ? (potrebaRaw as LeadNeed) : ''

  if (!kontakt) return { ok: false, error: 'Vyplňte prosím telefon nebo e-mail, ať se vám můžeme ozvat.' }
  const isEmail = EMAIL_RE.test(kontakt) && kontakt.length <= 254
  const digits = kontakt.replace(/\D/g, '').length
  const isPhone = PHONE_RE.test(kontakt) && digits >= 9 && digits <= 15 && (kontakt.match(/\+/g) ?? []).length <= 1
  if (!isEmail && !isPhone) {
    return { ok: false, error: 'Kontakt vypadá neúplně. Napište prosím celý e-mail nebo telefon.' }
  }
  if (typeof b.zprava === 'string' && b.zprava.trim().length > 4000) {
    return { ok: false, error: 'Zpráva je moc dlouhá. Zkraťte ji prosím na 4 000 znaků.' }
  }

  return { ok: true, spam: false, lead: { jmeno, kontakt, potreba, zprava }, contactEmail: isEmail ? kontakt : null }
}

const esc = (s: string) =>
  s.replace(/[&<>"'`]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[ch] ?? ch)

export function leadSubject(lead: LeadInput) {
  const who = lead.jmeno || lead.kontakt
  return `Nová poptávka z webu: ${lead.potreba || 'bez výběru'} · ${who}`.slice(0, 200)
}

/** The notification for AssetraDigital. Every value is HTML-escaped. */
export function leadEmailHtml(lead: LeadInput, meta: { id: string | null; stored: boolean; at: Date }) {
  const row = (k: string, v: string, pre = false) =>
    `<tr><td style="padding:10px 14px;font-size:12px;color:#5a615d;border-bottom:1px solid #e4e7e4;vertical-align:top;white-space:nowrap">${k}</td>` +
    `<td style="padding:10px 14px;font-size:14px;color:#0b0d0c;border-bottom:1px solid #e4e7e4${pre ? ';white-space:pre-wrap' : ''}">${v || '<span style="color:#a7aca9">—</span>'}</td></tr>`
  const when = meta.at.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="margin:0 0 4px;font:600 11px/1 monospace;letter-spacing:.14em;text-transform:uppercase;color:#057a56">Assetra Digital · web</p>
  <h2 style="margin:0 0 18px;font-size:22px;color:#0b0d0c">Nová poptávka</h2>
  <table style="width:100%;border-collapse:collapse;background:#eef0ee;border-radius:12px;overflow:hidden">
    ${row('Jméno a firma', esc(lead.jmeno))}
    ${row('Kontakt', esc(lead.kontakt))}
    ${row('Co potřebuje', esc(lead.potreba))}
    ${row('Zpráva', esc(lead.zprava), true)}
  </table>
  <p style="margin:16px 0 0;font-size:12px;color:#5a615d">${esc(when)}${meta.id ? ` · ID ${esc(meta.id)}` : ''}${meta.stored ? '' : ' · <b style="color:#b45309">neuloženo v databázi — tabulka leads chybí nebo selhala, tento e-mail je jediná kopie</b>'}</p>
</div>`
}
