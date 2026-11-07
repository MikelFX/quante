// The Quante modules as presented on the AssetraDigital website (homepage cards, /quante and
// /quante/<slug>). This file is data — the Qgent knowledge base is built from it too.
//
// Status is what the code in this repo actually ships (verified 2026-10-08). Never present
// something as done that is not:
//  - generate: /new → /api/quante/generate, build check + automatic fixes (MAX_AUTO_FIX_ATTEMPTS)
//  - qdit:     the Studio visual editor (lib/editor/*), desktop only
//  - qads:     /qads — ad photos and videos from uploaded product photos, download only
//  - qgent:    /qgent — 20 agents review a store by its address (/api/qgent/swarm) or build a new
//              store from it (Qscan + /api/quante/generate), verified 2026-11-04; Studio → Qgent
//              (app/api/projects/[id]/qgent, lib/qgent/shop.ts) + the website assistant (app/api/qgent/public)
//  - qscan:    /qscan → /api/qscan (lib/qscan/*): reads a store by its address (platform APIs,
//              JSON-LD, pages), copies its photos and short videos, then builds a new store via
//              /api/quante/generate (verified 2026-10-28)
//  - qails: no product code yet → 'dev': labelled „Ve vývoji“, no way into the app,
//    no dates promised.

import { appHref, quanteHref } from '@/lib/domains'
import { MODULES_EN, QUANTE_FLOW_EN, QUANTE_INTRO_EN, QUANTE_START_EN, statusLineEn } from './modules-en'

/** Quante pages exist in Czech (quantecode.com/) and English (quantecode.com/en, ./modules-en.ts). */
export type Locale = 'cs' | 'en'

export type ModuleStatus = 'live' | 'dev'
export type ModuleSlug = 'generate' | 'qscan' | 'qgent' | 'qdit' | 'qads' | 'qails'

export interface QuanteModule {
  slug: ModuleSlug
  name: string
  /** one-line description used on the homepage card */
  short: string
  /** small mono tag on the card */
  tag: string
  /** short highlight in the products menu and footer (modules in development get „Ve vývoji“) */
  badge?: string
  status: ModuleStatus
  /** particle shapes of the module page zone */
  shapes: string[]
  /** opening paragraph of the module page */
  lead: string
  /** what it does — cards on the module page */
  features: { title: string; text: string }[]
  /** a short practical note under the features (limits, where to find it) */
  note?: string
  /** how it hands over to the other modules */
  links: { to: ModuleSlug; text: string }[]
  /** the way into the app — only for live modules */
  app?: { label: string; href: string }
}

/** Quante app entry points (Clerk sends signed-out visitors to /login first). The app has its own
 *  host (lib/domains.ts), so in production these are absolute. */
export const quanteApp = {
  dashboard: appHref('/dashboard'),
  signup: appHref('/signup'),
  newStore: appHref('/new'),
  qads: appHref('/qads'),
  qscan: appHref('/qscan'),
  qgent: appHref('/qgent'),
  agency: appHref('/billing#agency'),
  /** The onboarding wizard (app/start): who you are → what first → straight into the module. */
  start: appHref('/start'),
} as const

/** /quante "Kde začít": three goals, each opens the app's onboarding with the goal already picked. */
export const quanteStart = {
  title: 'Co chcete udělat jako první?',
  sub: 'Vyberte cíl a Quante vás zavede rovnou do správného produktu s vyplněným zadáním.',
  goals: [
    { goal: 'ads', module: 'Qads', title: 'Reklamy na produkt', text: 'Reklamní videa a fotky, AI tvůrce, který produkt představí, nebo plán na 30 dní.', href: appHref('/start?goal=ads') },
    { goal: 'scan', module: 'Qscan', title: 'Převést můj e-shop', text: 'Zadáte adresu a Qscan z produktů, fotek a textů postaví nový obchod.', href: appHref('/start?goal=scan') },
    { goal: 'new', module: 'Generate', title: 'Nový e-shop', text: 'Popíšete, co prodáváte, a Quante postaví celý obchod i s pokladnou.', href: appHref('/start?goal=new') },
    { goal: 'qgent', module: 'Qgent', title: 'Zkontrolovat můj e-shop', text: 'Zadáte adresu a 20 agentů ho projde vrstvu po vrstvě. Návrhy přijmete, nebo odmítnete.', href: appHref('/qgent') },
  ],
} as const

// Order of the cards on the homepage and /quante (as in the design).
export const modules: QuanteModule[] = [
  {
    slug: 'generate',
    name: 'Quante Generate',
    short: 'Celý e-shop z textového zadání.',
    tag: 'generátor',
    status: 'live',
    shapes: ['GEN'],
    lead: 'Popíšete obchod a Quante ho postaví: napíše kód e-shopu, nasadí ho na Vercel a hlídá, aby se sestavil.',
    features: [
      { title: 'Zadání v chatu', text: 'Quante se ptá jako designér: co prodáváte, komu, jaký vzhled chcete a co ne. Z odpovědí sestaví zadání.' },
      { title: 'Kód pro každý obchod', text: 'Stránky a vzhled píše pro každý e-shop zvlášť. Košík a pokladna stojí na ověřeném jádru, takže fungují vždy.' },
      { title: 'Sestaví a opraví se sám', text: 'Obchod se zkušebně sestaví na Vercelu. Když build selže, Quante přečte chybu, opraví kód a zkusí to znovu, až pětkrát.' },
      { title: 'Úpravy větou', text: 'Změnu popíšete v chatu a Quante ji zapracuje.' },
      { title: 'Vlastní administrace', text: 'Objednávky, produkty a zákazníci. Platby přes Comgate, GoPay nebo PayPal, štítky Zásilkovny, GLS a DHL.' },
      { title: 'Kód je váš', text: 'Celý projekt si stáhnete jako ZIP. Platíte jednou za obchod, každé další stažení je zdarma.' },
    ],
    note: 'Když se obchod nepodaří sestavit ani po pěti opravách, kredity za generování se vrátí. Opravy samotné jsou zdarma.',
    links: [
      { to: 'qscan', text: 'Qscan sem převede váš stávající e-shop podle adresy.' },
      { to: 'qdit', text: 'Detaily pak doladíte ručně přímo na stránce.' },
      { to: 'qads', text: 'K hotovým produktům připravíte reklamní fotky a videa.' },
    ],
    app: { label: 'Vytvořit e-shop', href: quanteApp.newStore },
  },
  {
    slug: 'qscan',
    name: 'Qscan',
    short: 'Stávající e-shop podle adresy převede do nového, lepšího obchodu v Quante.',
    tag: 'sken',
    badge: 'Nové',
    status: 'live',
    shapes: ['SCAN'],
    lead: 'Zadáte adresu e-shopu nebo webu. Qscan z něj vezme produkty, ceny, fotky, videa a texty a Quante z nich postaví nový, graficky mnohem lepší obchod.',
    features: [
      { title: 'Stačí adresa', text: 'Shopify, WooCommerce, Shoptet i obyčejný web. Nic neexportujete ručně.' },
      { title: 'Produkty, fotky, videa', text: 'Projde obchod a sesbírá produkty s cenami a variantami, fotky, videa, texty, barvy a písma.' },
      { title: 'Fotky u nás', text: 'Fotky a videa zkopíruje k nám, takže nový obchod funguje, i když ten starý vypnete.' },
      { title: 'Nový obchod v Quante', text: 'Ze skenu vznikne běžný obchod v Quante, který dál upravujete ve Studiu.' },
      { title: 'Hosting, nebo kód', text: 'Hotový obchod u nás hostujete měsíčně nebo ročně, nebo si stáhnete celý kód.' },
    ],
    note: 'Skenujte jen obchod, který je váš nebo jehož obsah smíte použít. Videa vložená z YouTube a Vimea se nekopírují. Sken je zdarma, postavení obchodu stojí jako běžné vygenerování.',
    links: [
      { to: 'generate', text: 'Naskenovaný obchod postaví Quante Generate.' },
      { to: 'qdit', text: 'Úpravy po převodu uděláte v Qdit.' },
      { to: 'qgent', text: '20 agentů Qgent projde starý e-shop a jejich přijaté návrhy dostane i ten nový.' },
    ],
    app: { label: 'Naskenovat e-shop', href: quanteApp.qscan },
  },
  {
    slug: 'qgent',
    name: 'Qgent',
    short: '20 agentů najednou projde váš e-shop, navrhne úpravy, nebo z něj postaví nový.',
    tag: '20 agentů',
    badge: '20 agentů',
    status: 'live',
    shapes: ['AGENT'],
    lead: 'Dvacet agentů najednou projde váš e-shop vrstvu po vrstvě, navrhne úpravy a vy si vyberete, které chcete.',
    features: [
      { title: 'Stačí adresa', text: 'Zadáte adresu e-shopu a agenti si přečtou úvodní stránku a jednu stránku produktu. Nic neinstalujete.' },
      { title: '20 specialistů naráz', text: 'Každý agent hlídá něco jiného: nadpisy, texty, tlačítka, produkty, ceny, dopravu, důvěru, SEO, přístupnost, mobil, rychlost i právní minimum.' },
      { title: 'Živě po vrstvách', text: 'Díváte se, jak agenti procházejí stránku vrstvu po vrstvě, a návrhy přibývají hned, jak je najdou.' },
      { title: 'Chcete, nebo nechcete', text: 'Každý návrh přijmete, nebo odmítnete. Na vašem webu se nic nemění a nic neukládáme.' },
      { title: 'Nový e-shop podle starého', text: 'Agenti z adresy postaví nový obchod v Quante i s návrhy, které jste přijali. Na stavbu se díváte část po části.' },
      { title: 'Ve Studiu u vašeho obchodu', text: 'U obchodu z Quante projde Qgent i kód. Každou změnu ukáže předem, provede ji až po potvrzení a jde vrátit. Platby, dopravu a ceny nezmění bez samostatného potvrzení.' },
    ],
    note: 'Agenty pošlete jen na e-shop, který je váš nebo jehož obsah smíte použít. Kontrolu kódu obchodu z Quante najdete ve Studiu v režimu „Qgent“. Na webu AssetraDigital Qgent odpovídá i na otázky návštěvníků.',
    links: [
      { to: 'qscan', text: 'Nový obchod podle starého staví agenti nad skenem z Qscan.' },
      { to: 'generate', text: 'Nový obchod postaví Quante Generate i s přijatými návrhy.' },
      { to: 'qdit', text: 'Co navrhne, můžete místo potvrzení upravit ručně v Qdit.' },
      { to: 'qads', text: 'Informace o e-shopu předá Qads pro reklamy.' },
    ],
    app: { label: 'Poslat 20 agentů', href: quanteApp.qgent },
  },
  {
    slug: 'qdit',
    name: 'Qdit',
    short: 'Ruční úpravy přímo na stránce: klik, přepsat, přesunout.',
    tag: 'editor',
    status: 'live',
    shapes: ['EDIT'],
    lead: 'Ruční úpravy přímo na stránce. Kliknete na text a přepíšete ho, prvky přesunete nebo smažete. AI použijete, jen když chcete.',
    features: [
      { title: 'Klik a přepsat', text: 'Text upravíte dvojklikem přímo v živém náhledu obchodu.' },
      { title: 'Vzhled podle zařízení', text: 'Písmo, barvy, rozložení, odsazení a rámečky zvlášť pro počítač, tablet a mobil.' },
      { title: 'Přesunout, přidat, smazat', text: 'Prvky posunete výš nebo níž, přidáte tlačítko, nadpis, text nebo obrázek.' },
      { title: 'AI na vyžádání', text: 'Na vybraný prvek se můžete zeptat Quante nebo nechat AI vytvořit nový.' },
      { title: 'Nic se nerozbije zákazníkům', text: 'Úpravy se ukládají jako koncept. Zákazníci je uvidí až po kliknutí na Publikovat.' },
      { title: 'Chráněné části', text: 'Košík, pokladnu a právní stránky editor nemění, aby obchod vždy fungoval.' },
    ],
    note: 'Editor najdete ve Studiu u každého obchodu pod tlačítkem „Edit visually“. Funguje na počítači.',
    links: [
      { to: 'generate', text: 'Upravujete obchod, který postavil Quante Generate.' },
      { to: 'qgent', text: 'Qgent vám úpravy navrhne sám.' },
    ],
    app: { label: 'Otevřít Quante', href: quanteApp.dashboard },
  },
  {
    slug: 'qads',
    name: 'Qads',
    short: 'Reklamní videa a fotky pro váš e-shop, připravené ke stažení.',
    tag: 'reklamy',
    badge: 'Nové',
    status: 'live',
    shapes: ['ADS'],
    lead: 'Reklamní fotky a videa z fotek vašeho produktu. Hotové soubory si stáhnete a použijete, kde chcete.',
    features: [
      { title: 'Z fotky produktu', text: 'Nahrajete jednu až čtyři fotky produktu, napíšete název a krátký popis.' },
      { title: 'Formáty pro sítě', text: '9:16, 4:5, 1:1 a 16:9, až čtyři varianty od každého formátu.' },
      { title: 'Pět stylů', text: 'Packshot, lifestyle, UGC, filmový a minimalistický.' },
      { title: 'Videa v 1080p, 4 až 30 sekund', text: 'Ostrá videa pro reklamy i příběhy.' },
      { title: 'Character', text: 'Vytvoříte si AI postavu a ta o produktu namluví svislé video na 10 nebo 15 sekund, s hlasem a pohybem rtů. Scénář napíše AI podle fotky produktu.' },
      { title: 'Reklamní texty', text: 'Háček, text, titulek, výzva k akci, scénář a titulky. Česky, slovensky, anglicky nebo německy.' },
      { title: 'Ke stažení', text: 'Každý soubor zvlášť nebo vše jako ZIP. Qads nic nepublikuje, kam reklamy dáte, je na vás.' },
    ],
    note: 'Fotky a videa vznikají přes Higgsfield. Kredity se platí předem a za položky, které se nepovedou, se vrátí.',
    links: [
      { to: 'generate', text: 'Reklamy na produkty z obchodu, který postavil Quante Generate.' },
      { to: 'qgent', text: 'Qgent předá Qads informace o vašem e-shopu.' },
    ],
    app: { label: 'Otevřít Qads', href: quanteApp.qads },
  },
  {
    slug: 'qails',
    name: 'Qails',
    short: 'E-maily všech vašich obchodů na jednom místě.',
    tag: 'e-maily',
    status: 'dev',
    shapes: ['@'],
    lead: 'E-maily všech vašich obchodů na jednom místě, oddělené podle obchodu.',
    features: [
      { title: 'Jedna schránka', text: 'Objednávky, dotazy a reklamace ze všech obchodů pohromadě.' },
      { title: 'Podle obchodu', text: 'Každá zpráva nese obchod, ke kterému patří.' },
      { title: 'Hledání napříč obchody', text: 'Jedno hledání projde e-maily všech obchodů.' },
    ],
    note: 'Qails je ve vývoji a termín zatím neuvádíme.',
    links: [
      { to: 'generate', text: 'E-maily obchodů, které postavil Quante Generate.' },
      { to: 'qgent', text: 'Qgent bude mít přehled i o tom, na co se zákazníci ptají.' },
    ],
  },
]

export const quanteIntro = {
  label: 'Quante',
  title: 'Quante',
  sub: 'Celý e-shop na jednom místě: vygenerovat, upravit, propagovat a spravovat.',
}

/** /quante — how the modules fit together, in the order a shop goes through them. */
export const quanteFlow: { slug: ModuleSlug; title: string; text: string }[] = [
  { slug: 'qscan', title: 'Převod', text: 'Qscan přenese stávající e-shop podle adresy.' },
  { slug: 'generate', title: 'Stavba', text: 'Quante Generate postaví e-shop ze zadání a ohlídá, aby se sestavil.' },
  { slug: 'qdit', title: 'Doladění', text: 'V Qdit upravíte texty, vzhled a rozložení přímo na stránce.' },
  { slug: 'qgent', title: 'Kontrola', text: 'Dvacet agentů Qgent projde e-shop vrstvu po vrstvě a vy přijmete návrhy, které chcete.' },
  { slug: 'qads', title: 'Propagace', text: 'Qads připraví reklamní fotky a videa ke stažení.' },
  { slug: 'qails', title: 'Komunikace', text: 'Qails sjednotí e-maily všech obchodů na jednom místě.' },
]

/** The module page — on quantecode.com in production (lib/domains.ts quanteHref); English at /en/<slug>. */
export const moduleHref = (m: Pick<QuanteModule, 'slug'>, locale: Locale = 'cs') =>
  quanteHref(locale === 'en' ? '/en/' + m.slug : '/quante/' + m.slug)
/** The Quante overview (quantecode.com/ in production, English /en), optionally at one of its sections. */
export const quanteHome = (hash = '', locale: Locale = 'cs') => quanteHref((locale === 'en' ? '/en' : '/quante') + hash)

/** The modules in a language: the Czech data with the English words swapped in (./modules-en.ts). */
export function modulesFor(locale: Locale): QuanteModule[] {
  if (locale === 'cs') return modules
  return modules.map((m) => {
    const en = MODULES_EN[m.slug]
    return {
      ...m,
      short: en.short,
      tag: en.tag,
      badge: m.badge === undefined ? undefined : en.badge,
      lead: en.lead,
      features: en.features,
      note: en.note,
      links: m.links.map((l) => ({ to: l.to, text: en.links[l.to] ?? l.text })),
      app: m.app && { label: en.appLabel ?? m.app.label, href: m.app.href },
    }
  })
}

export function quanteIntroFor(locale: Locale) {
  return locale === 'en' ? { ...quanteIntro, sub: QUANTE_INTRO_EN.sub } : quanteIntro
}

export function quanteFlowFor(locale: Locale) {
  return locale === 'en' ? quanteFlow.map((f) => ({ slug: f.slug, ...QUANTE_FLOW_EN[f.slug] })) : quanteFlow
}

export function quanteStartFor(locale: Locale) {
  if (locale === 'cs') return quanteStart
  return {
    title: QUANTE_START_EN.title,
    sub: QUANTE_START_EN.sub,
    goals: quanteStart.goals.map((g) => ({ ...g, ...QUANTE_START_EN.goals[g.goal] })),
  }
}

/** The products menu and footer list: every module with its page, short line and highlight. */
export function productLinks(locale: Locale = 'cs') {
  return modulesFor(locale).map((m) => ({
    slug: m.slug,
    name: m.name,
    short: m.short,
    href: moduleHref(m, locale),
    app: m.app,
    badge: m.status === 'dev' ? (locale === 'en' ? 'In development' : 'Ve vývoji') : m.badge,
    dev: m.status === 'dev',
  }))
}
export const moduleBySlug = (slug: string, locale: Locale = 'cs') => modulesFor(locale).find((m) => m.slug === slug)

const CS_LIVE = ['Žádný modul zatím nefunguje', 'Jeden modul funguje', 'Dva moduly fungují', 'Tři moduly fungují', 'Čtyři moduly fungují', 'Pět modulů funguje', 'Šest modulů funguje']

/** „Čtyři moduly fungují … Qscan a Qails jsou ve vývoji.“ — computed, so it follows `status`. */
export function modulesStatusLine(locale: Locale = 'cs'): string {
  const live = modules.filter((m) => m.status === 'live').length
  const dev = modules.filter((m) => m.status === 'dev').map((m) => m.name)
  if (locale === 'en') return statusLineEn(live, dev)
  const devText = !dev.length ? '' : dev.length === 1 ? ` ${dev[0]} je ve vývoji.` : ` ${dev.slice(0, -1).join(', ')} a ${dev[dev.length - 1]} jsou ve vývoji.`
  return `${CS_LIVE[live] ?? `${live} modulů funguje`}${live ? ` a můžete ${live === 1 ? 'ho' : 'je'} používat hned.` : '.'}${devText}`
}

/** The same Quante page in the other language: / ↔ /en, /quante/<slug> ↔ /en/<slug>. */
export function otherLocalePath(pathname: string, locale: Locale): string {
  const slug = (locale === 'en' ? /^\/en\/([a-z]+)\/?$/ : /^\/quante\/([a-z]+)\/?$/).exec(pathname)?.[1]
  const m = slug ? moduleBySlug(slug) : undefined
  if (locale === 'en') return m ? '/quante/' + m.slug : '/quante'
  return m ? '/en/' + m.slug : '/en'
}
