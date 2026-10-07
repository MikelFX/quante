// The Quante modules as presented on the AssetraDigital website (homepage cards, /quante and
// /quante/<slug>). This file is data — the Qgent knowledge base is built from it too.
//
// Status is what the code in this repo actually ships (verified 2026-10-07). Never present
// something as done that is not:
//  - generate: /new → /api/quante/generate, build check + automatic fixes (MAX_AUTO_FIX_ATTEMPTS)
//  - qdit:     the Studio visual editor (lib/editor/*), desktop only
//  - qads:     /qads — ad photos and videos from uploaded product photos, download only
//  - qscan, qails, qgent: no product code yet → 'dev': labelled „Ve vývoji“, no way into the app,
//    no dates promised.

export type ModuleStatus = 'live' | 'dev'
export type ModuleSlug = 'generate' | 'qscan' | 'qgent' | 'qdit' | 'qads' | 'qails'

export interface QuanteModule {
  slug: ModuleSlug
  name: string
  /** one-line description used on the homepage card */
  short: string
  /** small mono tag on the card */
  tag: string
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

/** Quante app entry points (Clerk sends signed-out visitors to /login first). */
export const quanteApp = {
  dashboard: '/dashboard',
  signup: '/signup',
  newStore: '/new',
  qads: '/qads',
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
      { title: 'Kód je váš', text: 'Celý projekt si kdykoli stáhnete jako ZIP, zdarma.' },
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
    short: 'Sken stávajícího e-shopu podle adresy, rovnou do Quante.',
    tag: 'sken',
    status: 'dev',
    shapes: ['SCAN'],
    lead: 'Sken stávajícího e-shopu podle adresy. Převezme kategorie, produkty a ceny a přenese je rovnou do Quante.',
    features: [
      { title: 'Stačí adresa', text: 'Zadáte adresu e-shopu, který už máte. Nic neexportujete ručně.' },
      { title: 'Kategorie, produkty a ceny', text: 'Qscan projde obchod a sesbírá, co v něm je.' },
      { title: 'Rovnou do Quante', text: 'Ze skenu vznikne nový obchod v Quante, na kterém dál pracujete.' },
    ],
    note: 'Qscan je ve vývoji a termín zatím neuvádíme. Chcete převést e-shop už teď? Domluvte si konzultaci.',
    links: [
      { to: 'generate', text: 'Naskenovaný obchod postaví Quante Generate.' },
      { to: 'qdit', text: 'Úpravy po převodu uděláte v Qdit.' },
    ],
  },
  {
    slug: 'qgent',
    name: 'Qgent',
    short: 'Agent, který s vámi projde celý e-shop a po vašem potvrzení ho upraví.',
    tag: 'agent',
    status: 'dev',
    shapes: ['AGENT'],
    lead: 'Agent, který s vámi projde celý e-shop, navrhne úpravy a provede je, až je potvrdíte.',
    features: [
      { title: 'Projde e-shop s vámi', text: 'Stránku po stránce upozorní, co chybí nebo nefunguje.' },
      { title: 'Nejdřív náhled', text: 'Každou změnu ukáže předem a provede ji až po vašem potvrzení.' },
      { title: 'Všechno jde vrátit', text: 'Každá změna se zapíše a jde vrátit zpátky.' },
      { title: 'Peníze a doprava zvlášť', text: 'Platby, dopravu ani ceny nezmění bez samostatného potvrzení.' },
      { title: 'Podklady pro reklamy', text: 'Sbírá informace o e-shopu, ze kterých Qads připraví reklamy.' },
    ],
    note: 'Qgent je ve vývoji a termín zatím neuvádíme. Na webu AssetraDigital bude i jako asistent, který odpoví na otázky návštěvníků.',
    links: [
      { to: 'qdit', text: 'Co navrhne, můžete místo potvrzení upravit ručně v Qdit.' },
      { to: 'qads', text: 'Informace o e-shopu předá Qads pro reklamy.' },
    ],
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
      { to: 'qgent', text: 'Qgent vám bude úpravy navrhovat sám.' },
    ],
    app: { label: 'Otevřít Quante', href: quanteApp.dashboard },
  },
  {
    slug: 'qads',
    name: 'Qads',
    short: 'Reklamní videa a fotky pro váš e-shop, připravené ke stažení.',
    tag: 'reklamy',
    status: 'live',
    shapes: ['ADS'],
    lead: 'Reklamní fotky a videa z fotek vašeho produktu. Hotové soubory si stáhnete a použijete, kde chcete.',
    features: [
      { title: 'Z fotky produktu', text: 'Nahrajete jednu až čtyři fotky produktu, napíšete název a krátký popis.' },
      { title: 'Formáty pro sítě', text: '9:16, 4:5, 1:1 a 16:9, až čtyři varianty od každého formátu.' },
      { title: 'Pět stylů', text: 'Packshot, lifestyle, UGC, filmový a minimalistický.' },
      { title: 'Videa 4 až 10 sekund', text: 'Krátká videa pro reklamy i příběhy.' },
      { title: 'Reklamní texty', text: 'Háček, text, titulek, výzva k akci, scénář a titulky. Česky, slovensky, anglicky nebo německy.' },
      { title: 'Ke stažení', text: 'Každý soubor zvlášť nebo vše jako ZIP. Qads nic nepublikuje, kam reklamy dáte, je na vás.' },
    ],
    note: 'Fotky a videa vznikají přes Higgsfield. Kredity se platí předem a za položky, které se nepovedou, se vrátí.',
    links: [
      { to: 'generate', text: 'Reklamy na produkty z obchodu, který postavil Quante Generate.' },
      { to: 'qgent', text: 'Qgent bude Qads předávat informace o vašem e-shopu.' },
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
  { slug: 'qgent', title: 'Kontrola', text: 'Qgent projde celý e-shop a navrhne úpravy, které po potvrzení provede.' },
  { slug: 'qads', title: 'Propagace', text: 'Qads připraví reklamní fotky a videa ke stažení.' },
  { slug: 'qails', title: 'Komunikace', text: 'Qails sjednotí e-maily všech obchodů na jednom místě.' },
]

export const moduleHref = (m: Pick<QuanteModule, 'slug'>) => '/quante/' + m.slug
export const moduleBySlug = (slug: string) => modules.find((m) => m.slug === slug)
