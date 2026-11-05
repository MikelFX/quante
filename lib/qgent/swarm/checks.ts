// Qgent swarm: the checks that need no model — rules in code over the page facts and layers
// (layers.ts). They run first, so the first agents report within a second of the page arriving,
// and the model is told about them so it does not repeat them. Pure (tests load this file).
//
// Texts are in Czech for Czech / Slovak pages and in English otherwise; the model's findings are
// written in the page's language too.

import type { Layer, PageFacts } from './layers.ts'
import type { Severity, SwarmFinding } from './model.ts'

export type Lang = 'cs' | 'en'

interface Rule {
  agent: string
  severity: Severity
  title: Record<Lang, string>
  why: Record<Lang, string>
  /** the layer the finding points at, if any */
  layer?: (layers: Layer[]) => Layer | undefined
  after?: Record<Lang, string>
}

const has = (hay: string, words: RegExp) => words.test(hay)

const first = (kind: Layer['kind'] | Layer['kind'][], flag?: string) => (layers: Layer[]) =>
  layers.find((l) => (Array.isArray(kind) ? kind.includes(l.kind) : l.kind === kind) && (!flag || l.flags?.includes(flag)))

/** Links inside the first <nav>: the layers after it that are nested deeper than it. */
export function menuLinks(layers: Layer[]): number {
  const i = layers.findIndex((l) => l.kind === 'nav')
  if (i < 0) return 0
  let n = 0
  for (let j = i + 1; j < layers.length && layers[j].depth > layers[i].depth; j++) if (layers[j].kind === 'link') n++
  return n
}

/** Which rules fire for this page. Each rule is one finding. */
function rules(f: PageFacts, layers: Layer[], productPage: PageFacts | null): Rule[] {
  const out: Rule[] = []
  const all = productPage ? `${f.hay} ${productPage.hay}` : f.hay

  if (!f.title) out.push({ agent: 'seo', severity: 'high', title: { cs: 'Stránka nemá titulek', en: 'The page has no title' }, why: { cs: 'Titulek je první, co lidé vidí ve výsledcích Googlu a v záložce prohlížeče.', en: 'The title is the first thing people see in Google results and in the browser tab.' } })
  else if (f.title.length > 65) out.push({ agent: 'seo', severity: 'low', title: { cs: `Titulek je dlouhý (${f.title.length} znaků)`, en: `The title is long (${f.title.length} characters)` }, why: { cs: 'Google zobrazí zhruba 60 znaků, zbytek usekne.', en: 'Google shows about 60 characters and cuts the rest.' } })
  else if (f.title.length < 15) out.push({ agent: 'seo', severity: 'medium', title: { cs: 'Titulek je moc krátký', en: 'The title is too short' }, why: { cs: 'Krátký titulek neříká, co prodáváte, a nesbírá hledané výrazy.', en: 'A short title doesn’t say what you sell and misses search terms.' } })
  if (!f.description) out.push({ agent: 'seo', severity: 'medium', title: { cs: 'Chybí meta popis', en: 'No meta description' }, why: { cs: 'Bez něj si Google vybere náhodný kus textu ze stránky.', en: 'Without one, Google picks a random piece of text from the page.' } })
  else if (f.description.length > 165) out.push({ agent: 'seo', severity: 'low', title: { cs: 'Meta popis je delší, než Google zobrazí', en: 'The meta description is longer than Google shows' }, why: { cs: 'Ve výsledcích se ukáže zhruba 155 znaků.', en: 'Results show about 155 characters.' } })

  if (f.h1 === 0) out.push({ agent: 'scout', severity: 'medium', title: { cs: 'Na stránce není hlavní nadpis (h1)', en: 'The page has no main heading (h1)' }, why: { cs: 'Vyhledávače i čtečky obrazovky podle něj poznají, o čem stránka je.', en: 'Search engines and screen readers use it to tell what the page is about.' }, layer: first('header') })
  else if (f.h1 > 1) out.push({ agent: 'scout', severity: 'low', title: { cs: `Stránka má ${f.h1} hlavní nadpisy (h1)`, en: `The page has ${f.h1} main headings (h1)` }, why: { cs: 'Jeden jasný hlavní nadpis je silnější než několik.', en: 'One clear main heading is stronger than several.' }, layer: first('h1') })

  if (f.imagesNoAlt > 0) out.push({ agent: 'alt', severity: f.imagesNoAlt > 5 ? 'medium' : 'low', title: { cs: `Obrázky bez alt textu (${f.imagesNoAlt})`, en: `Images without alt text (${f.imagesNoAlt})` }, why: { cs: 'Alt text čte nevidomým čtečka a Google podle něj řadí obrázky ve vyhledávání.', en: 'Screen readers read it to blind shoppers and Google ranks images by it.' }, layer: first('image', 'no-alt') })

  if (!f.lang) out.push({ agent: 'access', severity: 'low', title: { cs: 'Stránka neuvádí svůj jazyk', en: 'The page doesn’t declare its language' }, why: { cs: 'Čtečky obrazovky pak čtou český text anglickou výslovností.', en: 'Screen readers then read the text with the wrong pronunciation.' } })
  if (f.linksNoText > 0) out.push({ agent: 'access', severity: 'low', title: { cs: `Odkazy bez textu (${f.linksNoText})`, en: `Links without text (${f.linksNoText})` }, why: { cs: 'Ikona bez popisku je pro čtečku jen „odkaz“. Přidejte aria-label.', en: 'An icon without a label is just “link” to a screen reader. Add an aria-label.' }, layer: first(['link', 'button'], 'no-text') })
  const unlabeled = layers.filter((l) => l.kind === 'input' && l.flags?.includes('no-label')).length
  if (unlabeled) out.push({ agent: 'access', severity: 'low', title: { cs: `Pole formuláře bez popisku (${unlabeled})`, en: `Form fields without a label (${unlabeled})` }, why: { cs: 'Placeholder zmizí při psaní a čtečka pole nepojmenuje.', en: 'A placeholder disappears while typing and screen readers can’t name the field.' }, layer: first('input', 'no-label') })

  if (!f.viewport) out.push({ agent: 'mobile', severity: 'high', title: { cs: 'Stránka není nastavená pro mobily', en: 'The page isn’t set up for phones' }, why: { cs: 'Chybí meta viewport, telefon ukáže zmenšenou desktopovou verzi. Většina nákupů je přitom z mobilu.', en: 'There is no viewport meta, so phones show a shrunken desktop page — and most shopping happens on phones.' } })
  const navLinks = menuLinks(layers)
  if (navLinks > 14) out.push({ agent: 'nav', severity: 'low', title: { cs: `V menu je ${navLinks} odkazů`, en: `The menu has ${navLinks} links` }, why: { cs: 'Na telefonu se v tolika položkách nikdo nevyzná. Seskupte je do pár kategorií.', en: 'Nobody finds their way through that many on a phone. Group them into a few categories.' }, layer: first('nav') })

  if (f.bytes > 600_000) out.push({ agent: 'speed', severity: 'medium', title: { cs: `HTML má ${Math.round(f.bytes / 1024)} kB`, en: `The HTML weighs ${Math.round(f.bytes / 1024)} kB` }, why: { cs: 'Těžká stránka se na mobilních datech načítá dlouho a lidé odcházejí.', en: 'A heavy page loads slowly on mobile data and people leave.' } })
  if (f.thirdPartyScripts > 12) out.push({ agent: 'speed', severity: 'medium', title: { cs: `Skripty z cizích serverů (${f.thirdPartyScripts})`, en: `Scripts from other servers (${f.thirdPartyScripts})` }, why: { cs: 'Každý měřicí kód a widget zpomalí první načtení.', en: 'Every tracker and widget slows down the first load.' } })
  if (f.images > 12 && f.imagesLazy < f.images / 3) out.push({ agent: 'speed', severity: 'low', title: { cs: 'Obrázky se načítají všechny najednou', en: 'All images load at once' }, why: { cs: 'Obrázky pod okrajem obrazovky mohou počkat (loading="lazy").', en: 'Images below the fold can wait (loading="lazy").' }, layer: first('image') })
  if (!f.https) out.push({ agent: 'trust', severity: 'high', title: { cs: 'Web neběží na HTTPS', en: 'The site isn’t on HTTPS' }, why: { cs: 'Prohlížeč ho označí jako nezabezpečený a lidé nezaplatí.', en: 'Browsers mark it “not secure” and people won’t pay.' } })

  if (!f.hasTel && !f.hasMailto && !has(all, /kontakt|contact|impressum|[\w.+-]+@[\w-]+\.[a-z]{2,}|\+?\d{3}[ \u00a0]?\d{3}[ \u00a0]?\d{3}/)) out.push({ agent: 'trust', severity: 'high', title: { cs: 'Není vidět, jak vás kontaktovat', en: 'No visible way to contact you' }, why: { cs: 'Neznámému obchodu bez telefonu nebo e-mailu lidé nevěří.', en: 'People don’t trust an unknown store without a phone or e-mail.' }, layer: first('footer') })
  if (!has(all, /doprav|doruč|zásilk|posíl|dodání|dodac|shipping|delivery|versand|lieferung/)) out.push({ agent: 'shipping', severity: 'medium', title: { cs: 'Chybí informace o dopravě', en: 'No delivery information' }, why: { cs: 'Cena a doba doručení je nejčastější důvod, proč lidé košík opustí. Ukažte ji dřív než v pokladně.', en: 'Delivery cost and time are the top reason carts are abandoned. Show them before checkout.' } })
  if (!has(all, /vrácen|reklamac|odstoupen|return|refund|widerruf|rückgabe/)) out.push({ agent: 'shipping', severity: 'medium', title: { cs: 'Chybí informace o vrácení zboží', en: 'No returns information' }, why: { cs: 'Jasné vrácení zboží snižuje riziko nákupu u neznámého obchodu.', en: 'Clear returns lower the risk of buying from an unknown store.' } })
  if (!has(all, /obchodní podmínky|obchodni-podminky|vop|terms|agb/)) out.push({ agent: 'legal', severity: 'high', title: { cs: 'Nenašli jsme obchodní podmínky', en: 'No terms and conditions found' }, why: { cs: 'E-shop v EU je musí mít dostupné před objednávkou.', en: 'An EU e-shop must show them before the order.' }, layer: first('footer') })
  if (!has(all, /ochrana osobních|osobních údajů|gdpr|privacy|datenschutz/)) out.push({ agent: 'legal', severity: 'high', title: { cs: 'Nenašli jsme zásady ochrany osobních údajů', en: 'No privacy policy found' }, why: { cs: 'GDPR vyžaduje, abyste lidem řekli, co s jejich údaji děláte.', en: 'GDPR requires telling people what you do with their data.' }, layer: first('footer') })
  if (!has(all, /cookie/)) out.push({ agent: 'legal', severity: 'medium', title: { cs: 'Chybí informace o cookies', en: 'No cookie information' }, why: { cs: 'Měřicí a marketingové cookies potřebují souhlas návštěvníka.', en: 'Analytics and marketing cookies need the visitor’s consent.' } })

  if (!f.ogImage || !f.ogTitle) out.push({ agent: 'social', severity: 'low', title: { cs: 'Sdílený odkaz nemá obrázek ani titulek', en: 'Shared links have no image or title' }, why: { cs: 'Na Facebooku a v Messengeru se pak odkaz ukáže jako holý text (chybí og:image / og:title).', en: 'On Facebook and in chats the link shows as plain text (no og:image / og:title).' } })
  if (!has(all, /newsletter|odebír|novinky e-mailem|subscribe|anmelden/)) out.push({ agent: 'social', severity: 'low', title: { cs: 'Žádné přihlášení k newsletteru', en: 'No newsletter sign-up' }, why: { cs: 'E-mail je nejlevnější cesta, jak zákazníka přivést zpátky.', en: 'E-mail is the cheapest way to bring a customer back.' }, layer: first('footer') })

  const types = (productPage ?? f).jsonLdTypes.map((t) => t.toLowerCase())
  if (productPage && !types.includes('product')) out.push({ agent: 'schema', severity: 'medium', title: { cs: 'Produkt nemá strukturovaná data', en: 'The product has no structured data' }, why: { cs: 'Bez JSON-LD Product Google neukáže cenu a dostupnost přímo ve výsledcích.', en: 'Without JSON-LD Product, Google can’t show price and availability in results.' } })
  if (!f.jsonLdTypes.some((t) => /organization|store|localbusiness|website/i.test(t))) out.push({ agent: 'schema', severity: 'low', title: { cs: 'Chybí strukturovaná data o obchodě', en: 'No structured data about the store' }, why: { cs: 'Organization / WebSite pomáhá Googlu ukázat logo a název obchodu.', en: 'Organization / WebSite helps Google show your logo and name.' } })

  const cards = layers.filter((l) => l.kind === 'product').length
  const prices = layers.filter((l) => l.kind === 'price').length
  if (cards >= 3 && prices === 0) out.push({ agent: 'price', severity: 'medium', title: { cs: 'U produktů na úvodní stránce nejsou ceny', en: 'Products on the home page show no prices' }, why: { cs: 'Lidé chtějí cenu vidět hned; bez ní na produkt často ani nekliknou.', en: 'People want to see the price right away; without it many don’t click.' }, layer: first('product') })
  const buttons = layers.filter((l) => l.kind === 'button')
  if (!buttons.length) out.push({ agent: 'cta', severity: 'medium', title: { cs: 'Na stránce není žádné výrazné tlačítko', en: 'No clear button on the page' }, why: { cs: 'Návštěvník potřebuje jasný další krok — „Nakoupit“, „Vybrat kávu“.', en: 'Visitors need one clear next step — “Shop now”, “Find your size”.' }, layer: first('h1') })
  const vague = buttons.find((b) => /^(klikněte zde|více|vice|zde|click here|more|read more|learn more|submit|odeslat)$/i.test(b.text.trim()))
  if (vague) out.push({ agent: 'cta', severity: 'low', title: { cs: `Tlačítko „${vague.text}“ neříká, co se stane`, en: `The button “${vague.text}” doesn’t say what happens` }, why: { cs: 'Konkrétní popisek („Zobrazit kávy“) má vyšší proklik.', en: 'A specific label (“See the coffees”) gets more clicks.' }, layer: () => vague })

  return out
}

/** The checks' findings for a page (and, if one was read, a product page), in the page's language unless `forceLang`. */
export function runChecks(home: PageFacts, layers: Layer[], productPage: PageFacts | null = null, forceLang?: Lang): SwarmFinding[] {
  const lang: Lang = forceLang ?? (/^(cs|sk)/.test(home.lang) || (!home.lang && /[ěščřžůň]/.test(home.hay.slice(0, 4000))) ? 'cs' : 'en')
  return rules(home, layers, productPage).map((r, i) => ({
    id: `c-${i + 1}`,
    agent: r.agent,
    layer: r.layer?.(layers)?.id ?? null,
    severity: r.severity,
    title: r.title[lang],
    why: r.why[lang],
    before: '',
    after: r.after?.[lang] ?? '',
    source: 'check' as const,
  }))
}
