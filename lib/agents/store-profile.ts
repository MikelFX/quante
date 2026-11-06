// Store profile for AI agents (pure, no I/O): one store's home page → who runs it and how it sells:
// name, platform, language, currency, contact e-mails and phones, company ids (IČO, VAT), address,
// social profiles, payment and shipping methods it mentions, and links to its shipping, returns,
// terms, privacy and contact pages. Lead-gen, supplier-vetting and shopping agents call this before
// they buy or write. Only what the page itself publishes; nothing is guessed (absent = null / []).
// Tested in __tests__/agent-tools.test.mjs.
import { absUrl, cleanText, detectPlatform, extractJsonLd, extractPage, type ScanPlatform } from '@/lib/qscan/extract'
import { isValidIco } from './company'

type Json = Record<string, unknown>

export type PolicyKind = 'shipping' | 'returns' | 'terms' | 'privacy' | 'contact' | 'about' | 'faq'

export interface StoreProfile {
  url: string
  name: string | null
  title: string | null
  description: string | null
  platform: ScanPlatform
  language: string | null
  currency: string | null
  logo: string | null
  image: string | null
  contact: { emails: string[]; phones: string[]; address: string | null }
  company: { legalName: string | null; ico: string[]; vatIds: string[] }
  socials: Array<{ platform: string; url: string }>
  payments: string[]
  shipping: string[]
  policies: Partial<Record<PolicyKind, string>>
  /** Products marked up on the home page itself (a hint for lookup_product). */
  productsOnPage: number
}

const POLICY_WORDS: Array<[PolicyKind, RegExp]> = [
  ['returns', /vr[aá]cen|reklamac|returns?\b|refund|odstoupen|r[uü]ckgabe|widerruf|zwrot|retour/i],
  ['shipping', /doprav|doru[cč]en|shipping|delivery|versand|lieferung|wysy[lł]k|dostaw|po[sš]tovn[eé]/i],
  ['terms', /obchodn[ií] podm|\bvop\b|terms|conditions|\bagb\b|regulamin|podm[ií]nky/i],
  ['privacy', /ochrana osobn|osobn[ií]ch [uú]daj|gdpr|privacy|datenschutz|prywatno/i],
  ['contact', /kontakt|contact/i],
  ['about', /o n[aá]s|about|[uü]ber uns|o nas/i],
  ['faq', /\bfaq\b|[cč]ast[eé] dotazy|nej[cč]ast[eě]j[sš][ií]|ot[aá]zky|h[aä]ufige/i],
]

const PAYMENT_WORDS: Array<[string, RegExp]> = [
  ['card', /platebn[ií] kart|kartou|credit card|debit card|card payment|pay by card|kreditkarte|\bvisa\b|mastercard/i],
  ['paypal', /paypal/i], ['apple_pay', /apple ?pay/i], ['google_pay', /google ?pay/i],
  ['stripe', /stripe/i], ['klarna', /klarna/i], ['gopay', /gopay/i], ['comgate', /comgate/i],
  ['thepay', /thepay/i], ['twisto', /twisto/i], ['skip_pay', /skip ?pay|mall ?pay/i], ['przelewy24', /przelewy24/i],
  ['bank_transfer', /bankovn[ií]m? p[rř]evod|bank transfer|[uü]berweisung|p[rř]evodem/i],
  ['cash_on_delivery', /dob[ií]rk|cash on delivery|nachnahme|za pobraniem/i],
  ['crypto', /bitcoin|crypto|usdc/i],
]

const SHIPPING_WORDS: Array<[string, RegExp]> = [
  ['packeta', /z[aá]silkovn|packeta/i], ['ppl', /\bppl\b/i], ['dpd', /\bdpd\b/i], ['gls', /\bgls\b/i],
  ['ceska_posta', /[cč]esk[aá] po[sš]ta|bal[ií]kovn/i], ['dhl', /\bdhl\b/i], ['ups', /\bups\b/i],
  ['fedex', /fedex/i], ['wedo', /wedo/i], ['inpost', /inpost|paczkomat/i], ['alzabox', /alzabox/i],
  ['personal_pickup', /osobn[ií] (odb[eě]r|vyzvednut)|click ?& ?collect|abholung/i],
]

const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24}/gi
const ONE_EMAIL = /^[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24}$/i
const NOT_EMAIL = /\.(png|jpe?g|gif|webp|svg|avif|css|js)$|@\dx\.|example\.(com|org)|sentry|wixpress|domain\.com/i

/** Every `<a href>` with its visible text. */
function anchors(html: string, base: string): Array<{ href: string; text: string; raw: string }> {
  const out: Array<{ href: string; text: string; raw: string }> = []
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const raw = m[1].match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const h = (raw?.[1] ?? raw?.[2] ?? raw?.[3] ?? '').trim()
    if (!h) continue
    const abs = /^(mailto|tel):/i.test(h) ? h : absUrl(h, base)
    if (abs) out.push({ href: abs, text: cleanText(m[2]).slice(0, 80), raw: h })
  }
  return out
}

function walk(objs: Json[], visit: (o: Json) => void) {
  const seen = new Set<unknown>()
  const go = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { v.forEach((x) => go(x, depth + 1)); return }
    visit(v as Json)
    for (const x of Object.values(v as Json)) go(x, depth + 1)
  }
  objs.forEach((o) => go(o, 0))
}

const ORG_TYPES = /Organization|LocalBusiness|Store|OnlineStore|Corporation|WebSite/
const typesOf = (o: Json) => (Array.isArray(o['@type']) ? o['@type'] : [o['@type']]).map(String)
const text = (v: unknown) => (typeof v === 'string' ? cleanText(v) : '')

function addressText(a: unknown): string | null {
  if (typeof a === 'string') return cleanText(a) || null
  if (!a || typeof a !== 'object') return null
  const o = a as Json
  const parts = [o.streetAddress, o.postalCode, o.addressLocality, o.addressRegion, text(o.addressCountry) || (o.addressCountry as Json | undefined)?.name]
    .map(text).filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

const PHONE_OK = (p: string) => p.replace(/\D/g, '').length >= 7 && p.replace(/\D/g, '').length <= 15

/** The company numbers printed on the page: Czech IČO (check digit verified) and EU VAT ids. */
export function companyIds(visibleText: string): { ico: string[]; vatIds: string[] } {
  const ico = new Set<string>()
  for (const m of visibleText.matchAll(/\bI[CČ]O?\s*[:.]?\s*(\d{2}\s?\d{3}\s?\d{3})\b/gi)) {
    const v = m[1].replace(/\s/g, '')
    if (isValidIco(v)) ico.add(v)
  }
  const vat = new Set<string>()
  for (const m of visibleText.matchAll(/\b(?:DI[CČ]|I[CČ] ?DPH|VAT(?: ?(?:ID|No\.?|number|reg\.?))?|USt-?Id(?:Nr)?\.?|NIP|TVA|IVA|BTW)\s*[:.]?\s*((?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)\s?[0-9A-Z]{2}[0-9A-Z ]{0,12})/gi)) {
    const v = m[1].toUpperCase().replace(/\s/g, '').slice(0, 14)
    if (/^[A-Z]{2}[0-9A-Z]{8,12}$/.test(v)) vat.add(v)
  }
  return { ico: [...ico].slice(0, 3), vatIds: [...vat].slice(0, 3) }
}

/** Home page HTML → the store's profile. */
export function storeProfile(html: string, pageUrl: string): StoreProfile {
  const page = extractPage(html, pageUrl)
  const noScript = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|noscript|template|style)\b[\s\S]*?<\/\1>/gi, ' ')
  const visible = cleanText(noScript).slice(0, 200_000)
  const links = anchors(noScript, pageUrl)
  const host = new URL(pageUrl).host.replace(/^www\./, '')

  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const a of links) {
    if (/^mailto:/i.test(a.raw)) {
      const e = decodeURIComponent(a.raw.slice(7).split('?')[0]).trim().toLowerCase()
      if (ONE_EMAIL.test(e) && !NOT_EMAIL.test(e)) emails.add(e)
    }
    if (/^tel:/i.test(a.raw)) {
      const p = decodeURIComponent(a.raw.slice(4)).replace(/[^\d+]/g, '')
      if (PHONE_OK(p)) phones.add(p)
    }
  }
  for (const m of visible.matchAll(EMAIL)) {
    const e = m[0].toLowerCase().replace(/\.$/, '')
    if (!NOT_EMAIL.test(e)) emails.add(e)
  }

  // schema.org Organization / LocalBusiness: legal name, address, phone, e-mail, sameAs profiles
  let legalName: string | null = null
  let address: string | null = null
  const socials = [...page.socials]
  walk(extractJsonLd(html), (o) => {
    if (!typesOf(o).some((t) => ORG_TYPES.test(t))) return
    legalName ??= text(o.legalName) || null
    address ??= addressText(o.address)
    const tel = text(o.telephone).replace(/[^\d+]/g, '')
    if (tel && PHONE_OK(tel)) phones.add(tel)
    const em = text(o.email).replace(/^mailto:/i, '').toLowerCase()
    if (ONE_EMAIL.test(em) && !NOT_EMAIL.test(em)) emails.add(em)
    const same = Array.isArray(o.sameAs) ? o.sameAs : o.sameAs ? [o.sameAs] : []
    for (const s of same) {
      if (typeof s !== 'string') continue
      try {
        const h = new URL(s).hostname.replace(/^www\./, '')
        const platform = h.split('.').slice(-2)[0]
        if (h !== host && !socials.some((x) => x.platform === platform)) socials.push({ platform, url: s })
      } catch { /* not a URL */ }
    }
  })

  const policies: Partial<Record<PolicyKind, string>> = {}
  for (const a of links) {
    if (!/^https?:/i.test(a.href)) continue
    let u: URL
    try { u = new URL(a.href) } catch { continue }
    if (u.host.replace(/^www\./, '') !== host) continue
    const hay = `${a.text} ${decodeURIComponent(u.pathname).replace(/[-_/]+/g, ' ')}`
    for (const [kind, re] of POLICY_WORDS) if (!policies[kind] && re.test(hay)) { policies[kind] = a.href; break }
  }

  const hay = `${visible} ${noScript.match(/<img\b[^>]*>/gi)?.join(' ') ?? ''}`
  const ids = companyIds(visible)
  return {
    url: page.url,
    name: page.siteName || legalName || null,
    title: page.title || null,
    description: page.description || null,
    platform: detectPlatform(html),
    language: page.lang || null,
    currency: page.products.find((p) => p.currency)?.currency ?? page.currencyHint,
    logo: page.logo,
    image: page.ogImage,
    contact: { emails: [...emails].slice(0, 5), phones: [...phones].slice(0, 5), address },
    company: { legalName, ...ids },
    socials: socials.slice(0, 10),
    payments: PAYMENT_WORDS.filter(([, re]) => re.test(hay)).map(([k]) => k),
    shipping: SHIPPING_WORDS.filter(([, re]) => re.test(hay)).map(([k]) => k),
    policies,
    productsOnPage: page.products.length,
  }
}
