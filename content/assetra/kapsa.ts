// Kapsa: an AI personal-finance coach for people in Czechia (owner, 2026-11). A product of
// AssetraDigital with its own app, domain and deployment: NOT part of Quante and not a
// Quante module, so it is never listed in content/assetra/modules.ts or the „Produkty Quante“ menu.
// Data, not markup: the website page /kapsa renders it, the Qgent knowledge base and the agent
// pages are built from it. Only facts the owner gave: every feature below exists in the app.
// Unknown facts are null and render as visible [placeholders]: the app's address (the owner sends
// it later) and the price. Never type a price or a date here.

/** Same words as the Quante modules: 'dev' = „Ve vývoji“, no way into the app yet. */
export type KapsaStatus = 'live' | 'dev'

export const kapsa = {
  name: 'Kapsa',
  status: 'dev' as KapsaStatus,
  /** The Kapsa app (its own domain). null = [placeholder] until the owner gives it. */
  appUrl: null as string | null,
  /** null = [placeholder]. Never type a price into copy. */
  price: null as string | null,
  path: '/kapsa',

  hero: {
    tag: 'AI kouč osobních financí',
    promise: 'Každý den víte, kolik můžete utratit, a máte plán, jak se zbavit dluhů.',
    lead: 'Kapsa je aplikace pro lidi v Česku, která hlídá výplatu, rozpočty a dluhy. Ukáže vám, kolik můžete utratit dnes, aby peníze vydržely do další výplaty, a spočítá, jak dluhy splatit rychleji.',
    cta: 'Otevřít Kapsu',
    secondaryCta: { label: 'Co Kapsa umí', target: 'co-umi' },
    checks: ['Česky', 'V telefonu jako aplikace', 'Soukromá data'],
  },

  /** Meta description (≤155 characters). */
  description: 'Kapsa: AI kouč osobních financí. Denní limit do výplaty, rozpočty, plán splácení dluhů a nápady na přivýdělek. Produkt AssetraDigital.',

  features: {
    label: 'Co umí',
    title: 'Co Kapsa umí',
    items: [
      {
        title: 'Kolik můžete utratit dnes',
        text: 'Zadáte čistou výplatu, den výplaty, pravidelné platby a rozpočty. Kapsa z nich spočítá denní limit, tedy kolik můžete utratit dnes, aby peníze vydržely do další výplaty.',
      },
      {
        title: 'Utratil jsi dnes něco?',
        text: 'Kapsa se vás každý den zeptá právě takhle. Odpovíte a máte přehled, jak na tom jste.',
      },
      {
        title: 'Večerní připomínka',
        text: 'Když jste ještě nic nezapsali, Kapsa vám kolem 19:00 pošle do telefonu připomínku. Když už máte zapsáno, neruší.',
      },
      {
        title: 'Rozpočty po kategoriích',
        text: 'Nájem, jídlo, cigarety, předplatné nebo cokoliv dalšího. Každá kategorie má svůj rozpočet.',
      },
      {
        title: 'Kam jde výplata',
        text: 'Na jednom místě vidíte, kolik z výplaty spotřebují pravidelné platby, rozpočty a splátky dluhů.',
      },
      {
        title: 'Co vidím',
        text: 'Kapsa sama upozorní, když utrácíte rychleji, než výplata stačí, když přečerpáte rozpočet, nebo kolik vás za rok stojí cigarety a předplatné.',
      },
      {
        title: 'Další krok',
        text: 'Karta Další krok vám řekne, na co se zaměřit teď: nejdřív rezerva na jeden měsíc, pak dluhy s vysokým úrokem, potom rezerva na tři měsíce a nakonec růst.',
      },
      {
        title: 'Plán splácení dluhů',
        text: 'Ke každému dluhu zadáte zůstatek, úrok (RPSN) a měsíční splátku. Vyberete lavinu, která splácí nejdřív dluh s nejvyšším úrokem, nebo sněhovou kouli, která splácí nejdřív nejmenší dluh.',
      },
      {
        title: 'Splátka navíc',
        text: 'Posuvníkem přidáte k splátkám částku navíc každý měsíc. Hned vidíte, kolik přesně ušetříte na úrocích a kdy budete bez dluhů.',
      },
      {
        title: 'Můžu si to dovolit?',
        text: 'Zadáte cenu věci, kterou chcete koupit. Kapsa ukáže, jaký by pak byl váš denní limit a kolik byste ušetřili na úrocích, kdybyste stejnou částku poslali na dluh.',
      },
      {
        title: 'AI kouč',
        text: 'Útratu napíšete do chatu jako zprávu, třeba „dnes 180 jídlo, 135 cigára“, a kouč ji zapíše. Udělá i celý rozbor vašich financí a navrhne konkrétní a reálné nápady na přivýdělek podle toho, co umíte a kolik máte času.',
      },
    ],
  },

  steps: {
    label: 'Jak to funguje',
    title: 'Jak Kapsa funguje',
    steps: [
      { hash: '5e1b0c7', title: 'Zadáte své finance', text: 'Čistou výplatu a den výplaty, pravidelné platby, rozpočty a dluhy.' },
      { hash: 'a94d2f3', title: 'Každý den denní limit', text: 'Kapsa ukáže, kolik můžete dnes utratit, a zeptá se, jestli jste dnes něco utratili.' },
      { hash: '3c7e8b1', title: 'Plán a další krok', text: 'Uvidíte, kam jde výplata, jak splatit dluhy a na co se zaměřit jako další.' },
    ],
  },

  /** What Kapsa does not do and how its numbers are made. Shown as-is, never softened. */
  honest: {
    label: 'Na rovinu',
    title: 'Co Kapsa dělá a co ne',
    items: [
      {
        title: 'Nevybírá finanční produkty',
        text: 'AI kouč nedoporučuje konkrétní finanční produkty, banky, úvěry, akcie ani kryptoměny. Pomáhá s rozpočtem, dluhy a nápady na přivýdělek. Když je situace vážná, doporučí bezplatnou dluhovou poradnu.',
      },
      {
        title: 'Čísla počítá kód, ne AI',
        text: 'Ušetřené úroky a datum, kdy budete bez dluhů, Kapsa počítá přesně pevnými výpočty v kódu. AI si tato čísla nevymýšlí.',
      },
      {
        title: 'Vaše data jsou soukromá',
        text: 'Data v Kapse jsou soukromá. Každý uživatel vidí jen svoje.',
      },
    ],
  },

  install: 'Kapsu si přidáte na plochu telefonu a otevíráte ji jako aplikaci (PWA).',

  /** Homepage showcase („04 Vlastní AI produkty“): phones drawn in HTML (KapsaPhone.tsx), not screenshots.
   *  Every screen shows a feature listed above; the money is one consistent made-up example, worked out
   *  with the app's own rules (daily limit = what is left ÷ days to payday; avalanche + extra payment
   *  computed month by month), so the numbers on different screens agree with each other. */
  showcase: {
    features: [
      'Denní limit do výplaty',
      'Rozpočty po kategoriích',
      'Plán splácení: lavina nebo sněhová koule',
      'Splátka navíc a kolik ušetříte',
      'AI kouč: útratu napíšete jako zprávu',
      'V telefonu jako aplikace',
    ],
    more: 'Více o Kapse',
    example: 'Ukázková čísla',
    today: {
      days: 9, left: '3 708 Kč', limit: '412 Kč', limitLabel: 'dnes můžete utratit',
      ask: 'Utratil jsi dnes něco?', yes: 'Ano, zapsat', no: 'Nic',
      next: { label: 'Další krok', title: 'Rezerva na jeden měsíc', progress: 0.62, value: '19 840 / 32 000 Kč' },
    },
    debts: {
      title: 'Plán splácení', modes: ['Lavina', 'Sněhová koule'],
      items: [
        { name: 'Kreditní karta', balance: '24 000 Kč', rate: '21,9 %', paid: 0.38 },
        { name: 'Půjčka', balance: '68 000 Kč', rate: '12,9 %', paid: 0.14 },
      ],
      extraLabel: 'Splátka navíc', extra: '+1 500 Kč / měs.',
      saved: '8 564 Kč', savedLabel: 'ušetříte na úrocích', sooner: 'bez dluhů o 13 měsíců dřív',
    },
    coach: {
      title: 'AI kouč',
      you: 'dnes 180 jídlo, 135 cigára',
      reply: ['Zapsáno: Jídlo 180 Kč, Cigarety 135 Kč.', 'Na dnes vám zbývá 97 Kč.'],
      tip: 'Cigarety vás za rok stojí 49 275 Kč.',
      chips: ['Rozbor financí', 'Nápady na přivýdělek'],
      input: 'Napište útratu nebo otázku',
    },
    shots: [
      { kind: 'salary' as const, caption: 'Kam jde výplata', text: 'Platby, rozpočty a splátky z jedné výplaty.' },
      { kind: 'afford' as const, caption: 'Můžu si to dovolit?', text: 'Denní limit po nákupu a co by udělal na dluhu.' },
      { kind: 'remind' as const, caption: 'Večerní připomínka', text: 'V 19:00, jen když jste nic nezapsali.' },
      { kind: 'insight' as const, caption: 'Co vidím', text: 'Kapsa sama upozorní, co se děje.' },
    ],
    salary: {
      total: '32 000 Kč',
      parts: [
        { label: 'Pravidelné platby', value: '12 400 Kč', share: 0.3875 },
        { label: 'Rozpočty', value: '10 200 Kč', share: 0.31875 },
        { label: 'Splátky dluhů', value: '3 300 Kč', share: 0.103125 },
        { label: 'Zbývá', value: '6 100 Kč', share: 0.190625 },
      ],
    },
    afford: { item: 'Sluchátka', price: '2 490 Kč', limitNow: '412 Kč', limitAfter: '135 Kč', debt: '1 891 Kč', debtLabel: 'ušetříte na úrocích, když to pošlete na kartu', buy: 'Koupit', pay: 'Poslat na dluh' },
    remind: { time: '19:00', title: 'Kapsa', text: 'Utratil jsi dnes něco? Zapiš to, ať limit sedí.' },
    insight: [
      { title: 'Utrácíte rychleji, než výplata stačí', text: 'Tímhle tempem vám chybí 1 240 Kč do výplaty.' },
      { title: 'Rozpočet Jídlo přečerpán', text: 'O 340 Kč víc, než jste si nastavili.' },
      { title: 'Předplatné za rok', text: '3 588 Kč za služby, které platíte měsíčně.' },
      { title: 'Cigarety za rok', text: '49 275 Kč, když zůstanete u 135 Kč denně.' },
    ],
  },

  facts: {
    label: 'Stav',
    title: 'Kde Kapsu najdete',
    note: 'Kapsa je ve vývoji. Termín spuštění neuvádíme.',
  },

  end: {
    similar: { label: 'Na míru', title: 'Chcete podobnou aplikaci?', text: 'Kapsu jsme postavili sami. Stejně tak postavíme aplikaci s AI pro vás nebo vaši firmu.', cta: 'Domluvit konzultaci' },
    more: { label: 'AssetraDigital', title: 'Další naše produkty', text: 'Quante, Qgent, Qads a Branka najdete na hlavní stránce.', cta: 'Naše produkty' },
  },
}

/** The status label („Ve vývoji“ like the Quante modules in development), computed from `status`. */
export const kapsaStatusLabel = () => (kapsa.status === 'live' ? 'K dispozici' : 'Ve vývoji')
