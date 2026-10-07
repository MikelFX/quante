// AssetraDigital website copy, taken 1:1 from design/assetradigital-design-v2.dc.html.
// This file is data, not markup: the pages render it and the Qgent knowledge base is built
// from it. Anything we do not know yet is `null` and renders as a visible [placeholder] —
// never invent company data, prices, contacts or promises.

export const company = {
  name: 'AssetraDigital s.r.o.',
  ico: null as string | null, // [IČO] — the company is being founded
  seat: null as string | null, // [sídlo]
  registry: null as string | null, // [obchodní rejstřík]
}

export const contact = {
  phone: null as string | null, // [telefon]
  email: null as string | null, // [e-mail]
  responseTime: null as string | null, // „Ozveme se do [doba]“
}

export const nav = [
  { id: 'sluzby', label: 'Služby', num: '01' },
  { id: 'cenik', label: 'Ceník', num: '03' },
  { id: 'prace', label: 'Ukázka práce', num: '05' },
  { id: 'quante', label: 'Quante', num: '06' },
] as const

export const cta = { label: 'Domluvit konzultaci', target: 'kontakt' } as const

export const hero = {
  pill: { badge: '0 Kč', text: 'předem · weby a e-shopy na míru' },
  title: 'Web nebo e-shop bez vstupní investice',
  lead: 'Navrhneme a postavíme ho na míru. Vy platíte měsíční paušál, ve kterém je hosting, správa i drobné úpravy.',
  secondaryCta: { label: 'Prohlédnout ceník', target: 'cenik' },
  checks: ['Vlastní kód bez šablon', 'České platby a doprava', 'Konzultace zdarma'],
  integrations: [
    { n: 'Comgate', d: 'platby' },
    { n: 'Zásilkovna', d: 'výdejní místa' },
    { n: 'PPL', d: 'doprava' },
    { n: 'Fakturoid', d: 'faktury' },
  ],
  tapeWords: ['Web', 'E-shop', 'Správa', '0 Kč předem', 'Vlastní kód'],
}

/** The two ways in: we build it for you, or you build it yourself in Quante. */
export const paths = [
  {
    kicker: 'Uděláme to za vás',
    title: 'Web nebo e-shop na míru',
    text: 'Navrhneme, postavíme a spravujeme. Bez vstupní investice, za měsíční paušál.',
    cta: { label: 'Domluvit konzultaci', href: '#kontakt' },
  },
  {
    kicker: 'Udělejte si to sami',
    title: 'Quante',
    text: 'Celý e-shop na jednom místě: vygenerovat, upravit, propagovat a spravovat.',
    cta: { label: 'Prohlédnout Quante', href: '/quante' },
  },
] as const

export const services = {
  label: 'Služby',
  title: 'Co pro vás uděláme',
  items: [
    { title: 'Firemní web', features: [{ b: 'Rychlý' }, { t: 'Funguje v mobilu' }, { t: 'Vlastní design' }, { t: 'Formulář' }, { t: 'Základ SEO' }] },
    { title: 'E-shop', features: [{ b: 'Doprava', t: 'Zásilkovna, PPL' }, { b: 'Platby', t: 'Comgate, QR, dobírka' }, { t: 'Vlastní administrace' }, { t: 'Faktury přes Fakturoid' }] },
    { title: 'Správa a hosting', features: [{ b: 'Hosting' }, { t: 'Zálohy' }, { t: 'Aktualizace' }, { t: 'Drobné úpravy' }] },
  ],
}

export const contract = {
  label: 'Smlouva',
  title: 'Pravidla ve smlouvě',
  sub: 'Čtyři věci, které platí v každé naší smlouvě.',
  rules: [
    { title: 'Doména patří vám', code: 'vlastník: vy' },
    { title: 'Kód a data předáme', code: 'předání: kód + data' },
    { title: 'Pevná cena a jasný rozsah', code: 'cena: pevná' },
    { title: 'Platby jdou rovnou vám', code: 'platby → váš účet' },
  ],
}

export const pricing = {
  label: 'Ceník',
  title: 'Ceník',
  subscription: {
    upfront: '0 Kč',
    minMonths: 24,
    plans: [
      { name: 'Web', monthly: '990', includes: ['Návrh a stavba na míru', 'Hosting, správa a zálohy', 'Drobné úpravy'], hot: false },
      { name: 'E-shop', monthly: '2 490', includes: ['Návrh a stavba na míru', 'Doprava, platby a faktury napojené', 'Hosting, správa a zálohy', 'Drobné úpravy'], hot: true },
    ],
  },
  oneOff: {
    web: '14 900',
    eshop: '49 900',
    management: null as string | null, // „Správa od [cena] měsíčně“
    hourly: null as string | null, // „Práce navíc [sazba] za hodinu“
  },
  vat: null as string | null, // „Ceny jsou uvedeny [bez DPH / s DPH]“
}

export const steps = {
  label: 'Postup',
  title: 'Jak spolupráce probíhá',
  steps: [
    { hash: 'a3f9c21', title: 'Konzultace', text: 'Zdarma. Probereme, co potřebujete a co dává smysl.' },
    { hash: '9c2f7d1', title: 'Nabídka a návrh', text: 'Pevná cena, jasný rozsah a návrh vzhledu.' },
    { hash: 'e07a3b5', title: 'Stavba', text: 'Postavíme web na míru ve vlastním kódu.' },
    { hash: 'f1d9c84', title: 'Spuštění a správa', text: 'Spustíme na vaší doméně a dál se o web staráme.' },
  ],
}

export const work = {
  label: 'Ukázka práce',
  title: 'Harwo',
  sub: 'Zmenšený návrh e-shopu pro velkoobchod s potravinami.',
  /** Shown only as a design draft until Harwo agrees to publication. */
  approved: false,
  spec: [
    { dt: 'Vzhled', dd: 'Přírodní' },
    { dt: 'Katalog', dd: 'Kategorie' },
    { dt: 'Objednávka', dd: 'S IČO' },
    { dt: 'Filtr', dd: 'Chlazené a mražené' },
  ],
}

export const contactSection = {
  label: 'Kontakt',
  title: ['Pojďme', 'to probrat'],
  needs: ['Firemní web', 'E-shop', 'Správa', 'Něco jiného'],
}

export const legalPages = [
  { slug: 'obchodni-podminky', title: 'Obchodní podmínky' },
  { slug: 'ochrana-osobnich-udaju', title: 'Ochrana osobních údajů' },
  { slug: 'vzorova-smlouva', title: 'Vzorová smlouva' },
] as const
