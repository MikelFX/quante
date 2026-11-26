// ChatGPT Ads measurement pixel (OpenAI Ads Manager, owner 2026-11-25) — the pure rules.
// Only on quantecode.com (the Quante products + app), never on assetradigital.agency, never on a
// customer's store (stores are separate deployments; the Studio's store preview runs under
// /preview here and is skipped), and only after the visitor agreed to marketing cookies.
// The loader is components/consent/MarketingConsent.tsx. Plain rules, tested in
// __tests__/marketing-pixel.test.mjs.
import { APP_HOST_PATTERN, pageLang } from './domains.ts'

/** Pixel id from ChatGPT Ads Manager → Conversions. Public by design (it is in the page source). */
export const OAI_PIXEL_ID = process.env.NEXT_PUBLIC_OAI_PIXEL_ID || '2jbZ3Jc65W5dKCPcDFZm2y'
/** Debug logging in the browser console while the owner checks events arrive in Ads Manager.
 *  On with NEXT_PUBLIC_OAI_PIXEL_DEBUG=1 (Vercel env, then Redeploy); remove it to switch off. */
export const OAI_PIXEL_DEBUG = process.env.NEXT_PUBLIC_OAI_PIXEL_DEBUG === '1'
export const OAI_PIXEL_SRC = 'https://bzrcdn.openai.com/sdk/oaiq.min.js'

/** localStorage key of the visitor's choice (per host — consent is never shared across hosts). */
export const CONSENT_KEY = 'q:consent:v1'
/** Window event that opens the consent bar again (footer link „Nastavení cookies“). */
export const CONSENT_OPEN_EVENT = 'q:consent:open'

export type Consent = { marketing: boolean; at: string }

const APP_HOST = new RegExp('^' + APP_HOST_PATTERN + '$', 'i')

/** Pages on the app host that must never carry the pixel: the store preview (a customer's store),
 *  the supplier's order link and invoices (tokens / third parties' data in the URL). */
const NEVER = ['/preview', '/supplier-order', '/invoice']

/** Whether this page may carry the pixel at all (consent is checked separately). */
export function pixelAllowed(hostname: string, pathname: string): boolean {
  if (!APP_HOST.test(hostname)) return false
  return !NEVER.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** The stored choice, or null when the visitor has not decided (or the value is broken). */
export function parseConsent(raw: string | null): Consent | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (v && typeof v.marketing === 'boolean' && typeof v.at === 'string') return { marketing: v.marketing, at: v.at }
  } catch {}
  return null
}

export function consentValue(marketing: boolean, now = new Date()): string {
  return JSON.stringify({ marketing, at: now.toISOString() })
}

/** The bootstrap that runs once the visitor agreed: OpenAI's own snippet (queue + async SDK),
 *  consent set before init (the SDK otherwise assumes consent), then init. Runs once per page load. */
export function pixelBootstrap(pixelId = OAI_PIXEL_ID, debug = OAI_PIXEL_DEBUG): string {
  return (
    '!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;' +
    'var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(j,f);}' +
    `(window,document,"script",${JSON.stringify(OAI_PIXEL_SRC)});` +
    'oaiq("consent",true);' +
    `oaiq("init",${JSON.stringify({ pixelId, debug })});`
  )
}

/** Words of the consent bar: Czech on the Quante pages, English on /en and in the app. */
export function consentCopy(pathname: string) {
  return pageLang(pathname) === 'cs'
    ? {
        text: 'Nezbytné cookies potřebujeme k provozu. S vaším souhlasem použijeme i marketingové cookies (měření reklam v ChatGPT od OpenAI), abychom věděli, které reklamy fungují.',
        more: 'Více informací',
        accept: 'Povolit marketing',
        reject: 'Jen nezbytné',
        label: 'Souhlas s cookies',
        settings: 'Nastavení cookies',
      }
    : {
        text: 'We need essential cookies to run the site. With your consent we also use marketing cookies (OpenAI’s ChatGPT ads measurement) to learn which ads work.',
        more: 'Learn more',
        accept: 'Allow marketing',
        reject: 'Essential only',
        label: 'Cookie consent',
        settings: 'Cookie settings',
      }
}
