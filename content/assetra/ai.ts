// AssetraDigital homepage copy (2026-10-26, owner): AI solutions and software of any kind for
// companies, agencies, startups and individuals. Web & e-shop moved to /web-eshop (site.ts).
// Data, not markup — the homepage renders it and the Qgent knowledge base is built from it.
// Describes what we build, never invented facts: no prices, deadlines or client names here.

/** Glossy 3D objects drawn by app/(site)/_components/ai/Object3D.tsx. */
export type Object3DKind = 'core' | 'plug' | 'crm' | 'chat' | 'flow' | 'grid' | 'shop' | 'bars' | 'tiles' | 'spark' | 'person'

export const aiHero = {
  pill: { badge: 'AI', text: 'řešení a software na míru' },
  title: 'Postavíme cokoliv s umělou inteligencí',
  lead: 'Napojíme AI do vašich systémů, postavíme software kolem jednoho AI jádra, CRM nebo interní nástroj. Pro firmy, agentury, startupy i jednotlivce.',
  secondaryCta: { label: 'Co postavíme', target: 'sluzby' },
  checks: ['Konzultace zdarma', 'Napojení na vaše systémy', 'Od nápadu po provoz'],
  tapeWords: ['AI integrace', 'CRM', 'Software na míru', 'Automatizace', 'AI asistenti', 'Web & E-shop'],
  tapeItems: [
    { n: 'Firmy', d: 'interní systémy' },
    { n: 'Agentury', d: 'pro vaše klienty' },
    { n: 'Startupy', d: 'MVP' },
    { n: 'Jednotlivci', d: 'od nápadu k aplikaci' },
  ],
}

export const aiServices = {
  label: 'Služby',
  title: 'Co pro vás postavíme',
  sub: 'Cokoliv, co stojí na umělé inteligenci. Tohle je šest nejčastějších směrů.',
  items: [
    {
      kind: 'plug',
      title: 'AI integrace do vašich systémů',
      text: 'Napojíme AI tam, kde už pracujete: e-shop, CRM, účetnictví, helpdesk, e-mail nebo interní databáze. Nemusíte nic vyměňovat, AI se přizpůsobí vašim procesům.',
      features: ['Napojení přes API', 'E-shop, CRM, ERP, helpdesk', 'Práce s vašimi daty', 'Bez výměny stávajících systémů'],
    },
    {
      kind: 'core',
      title: 'Systém kolem AI jádra',
      text: 'Celý produkt, jehož srdcem je AI model: od zadání přes logiku až po rozhraní pro uživatele. Takhle jsme postavili i vlastní Quante.',
      features: ['Návrh architektury', 'Výběr a nastavení modelu', 'Hlídání nákladů a limitů', 'Webové rozhraní i API'],
    },
    {
      kind: 'crm',
      title: 'CRM na míru',
      text: 'Zákazníci, obchody a úkoly přesně podle toho, jak prodáváte. AI v něm třídí poptávky, navrhuje odpovědi a připomíná, co je potřeba udělat.',
      features: ['Zákazníci a obchody', 'Úkoly a připomínky', 'AI shrnutí a návrhy odpovědí', 'Napojení na e-mail a web'],
    },
    {
      kind: 'chat',
      title: 'AI asistenti a chatboti',
      text: 'Asistent na web, do e-shopu nebo pro váš tým. Odpovídá z vašich podkladů a ví, kdy věc předat člověku. Jeden takový najdete na tomhle webu vpravo dole.',
      features: ['Odpovědi z vašich dokumentů', 'Zákaznická podpora', 'Interní znalostní báze', 'Předání člověku'],
    },
    {
      kind: 'flow',
      title: 'Automatizace procesů',
      text: 'Opakovanou práci převezme AI: čtení faktur a dokumentů, třídění e-mailů, přepis dat mezi systémy, pravidelné reporty.',
      features: ['Vytěžování dokumentů', 'Třídění e-mailů', 'Přenos dat mezi systémy', 'Pravidelné reporty'],
    },
    {
      kind: 'grid',
      title: 'Software jakéhokoliv typu',
      text: 'Interní nástroje, klientské portály, administrace, webové i mobilní aplikace. Když se to dá naprogramovat, postavíme to.',
      features: ['Webové aplikace', 'Interní nástroje a administrace', 'Klientské portály', 'MVP pro startupy'],
    },
  ] satisfies { kind: Object3DKind; title: string; text: string; features: string[] }[],
}

export const aiAudience = {
  label: 'Pro koho',
  title: 'Pro koho to děláme',
  items: [
    { kind: 'bars', title: 'Firmy', text: 'Méně ruční práce, rychlejší odpovědi zákazníkům a přehled v datech.' },
    { kind: 'tiles', title: 'Agentury', text: 'AI řešení pro vaše klienty. Pod vaší značkou, nebo s námi jako technickým partnerem.' },
    { kind: 'spark', title: 'Startupy', text: 'Z nápadu funkční MVP, které ukážete zákazníkům i investorům.' },
    { kind: 'person', title: 'Jednotlivci', text: 'Máte nápad na aplikaci nebo nástroj? Probereme ho a postavíme.' },
  ] satisfies { kind: Object3DKind; title: string; text: string }[],
}

export const aiIdeas = {
  label: 'Nápady',
  title: 'Co firmy chtějí nejčastěji',
  sub: 'Pro inspiraci. Když tu svůj nápad nevidíte, napište nám ho: zkusíme zautomatizovat cokoliv, co nám zadáte.',
  items: [
    'Odpovědi na dotazy zákazníků 24/7',
    'Vytěžení faktur a objednávek',
    'Chat nad firemními dokumenty',
    'Návrhy nabídek a e-mailů',
    'Třídění a kvalifikace poptávek',
    'Popisky produktů do e-shopu',
    'Shrnutí schůzek a hovorů',
    'Reporty z prodejních dat',
    'Překlady a lokalizace',
    'Reklamní videa a fotky',
    'Kontrola smluv a dokumentů',
    'Interní asistent pro zaměstnance',
  ],
}

/**
 * Our own AI products — everything here exists in this repository. Each one gets its own showcase
 * section on the homepage (owner, 2026-10-27). Facts follow content/assetra/modules.ts.
 * Screens in public/produkty/: Quante = a recording of the Studio (public/quante-hero.mp4), Qads =
 * the /qads composer + ads from the community seed, Qgent = the website assistant.
 */
export const aiBuilt = {
  label: 'Už to děláme',
  title: 'Vlastní AI produkty',
  sub: 'AI nejen nabízíme, sami na ní stavíme. Tohle jsou naše vlastní produkty.',
  items: [
    {
      id: 'quante',
      kind: 'grid',
      title: 'Quante',
      text: 'AI vytvoří celý e-shop podle zadání. Úpravy v chatu, kód si stáhnete.',
      kicker: 'AI, která postaví celý e-shop',
      lead: 'Popíšete obchod a Quante ho postaví: napíše kód e-shopu, nasadí ho na Vercel a hlídá, aby se sestavil. Když build selže, přečte chybu a opraví se sám.',
      features: ['Zadání v chatu', 'Kód pro každý obchod zvlášť', 'Sestaví a opraví se sám', 'Úpravy větou', 'Vlastní administrace', 'Kód si stáhnete jako ZIP'],
      href: '/quante',
      cta: 'Prohlédnout Quante',
    },
    {
      id: 'qgent',
      kind: 'chat',
      title: 'Qgent',
      text: 'AI agent, který projde e-shop a po vašem potvrzení ho upraví. Na tomhle webu odpovídá na vaše dotazy.',
      kicker: 'AI agent pro váš e-shop',
      lead: 'Projde s vámi celý e-shop stránku po stránce, upozorní, co chybí nebo nefunguje, a navrhne úpravu. Provede ji až po vašem potvrzení. Na tomhle webu odpovídá návštěvníkům.',
      features: ['Nejdřív náhled, pak změna', 'Všechno jde vrátit', 'Peníze a doprava jen se zvláštním potvrzením', 'Podklady pro reklamy v Qads'],
      href: '/quante/qgent',
      cta: 'Detail Qgent',
    },
    {
      id: 'qads',
      kind: 'spark',
      title: 'Qads',
      text: 'Reklamní videa a fotky produktů, které vytvoří AI.',
      kicker: 'Reklama z jedné fotky',
      lead: 'Nahrajete fotku produktu a Qads z ní udělá reklamní fotky a krátká videa pro sítě. Hotové soubory si stáhnete a použijete, kde chcete.',
      features: ['9:16, 4:5, 1:1 i 16:9', 'Pět stylů od packshotu po film', 'Videa 4 až 10 sekund', 'Reklamní texty ve čtyřech jazycích', 'Stažení jako ZIP'],
      href: '/quante/qads',
      cta: 'Detail Qads',
    },
  ] satisfies {
    id: 'quante' | 'qgent' | 'qads'; kind: Object3DKind; title: string; text: string
    kicker: string; lead: string; features: string[]; href: string; cta: string
  }[],
}

/** Screens of our own products (public/produkty/). */
export const productScreens = {
  quante: {
    video: '/produkty/quante-studio.mp4',
    poster: '/produkty/quante-store.webp',
    url: 'quantecode.com/project/aether',
    steps: [
      { src: '/produkty/quante-chat.webp', caption: 'Zadání', text: 'Quante se ptá jako designér.' },
      { src: '/produkty/quante-build.webp', caption: 'Build', text: 'Chybu najde a opraví sám.' },
      { src: '/produkty/quante-edit.webp', caption: 'Úpravy', text: 'Změnu napíšete jednou větou.' },
    ],
  },
  qgent: {
    src: '/produkty/qgent-answer.webp',
    alt: 'Qgent na webu AssetraDigital odpovídá na dotaz, co umí v e-shopu',
    /** The review card in the Studio, drawn in CSS. */
    finding: { title: 'Na úvodní stránce chybí informace o dopravě.', edit: 'Doprava a platby v patičce' },
  },
  qads: {
    composer: '/produkty/qads-composer.webp',
    url: 'quantecode.com/qads',
    ads: [
      { video: '/produkty/qads-keyboard.mp4', poster: '/qads/community/video-keyboard.webp', label: 'Video 9:16' },
      { video: '/produkty/qads-wheel.mp4', poster: '/qads/community/video-wheel.webp', label: 'Video 9:16' },
    ],
    photo: { src: '/qads/community/photo-lighter.webp', label: 'Fotka 1:1' },
  },
}

/**
 * BRANKA — our software for gyms, courts and classes (owner, 2026-10-27). Screens are the
 * product's own app screenshots from branka-site.vercel.app (public/branka/). Product facts only
 * as that site states them; its price stays on its own site.
 */
export const aiBranka = {
  label: 'Branka',
  title: 'Branka',
  kicker: 'Software pro fitka, kurty a lekce',
  lead: 'Rezervace po telefonu, storna přes Messenger a permanentky v sešitě nahradí jedna aplikace. Členové si v ní rezervují a otevírají dveře telefonem, majitel vidí celé fitko na jedné obrazovce. Provoz bez recepce.',
  features: [
    'Rezervace kurtů, lekcí i trenérů',
    'Dveře se otevírají telefonem nebo QR kódem',
    'Platby kartou, Apple Pay a Google Pay rovnou na účet fitka',
    'Kdo je uvnitř, tržby a rezervace v reálném čase',
    'Aplikace pro iOS i Android, administrace na webu',
    'Převod členů ze starého systému, tabulky i sešitu',
  ],
  href: 'https://branka-site.vercel.app',
  cta: 'Prohlédnout Branku',
  /** Three phones in the stage: left, centre (front), right. */
  stage: [
    { src: '/branka/rezervace.webp', alt: 'Branka: rozvrh kurtů s volnými a obsazenými časy' },
    { src: '/branka/domu.webp', alt: 'Branka: úvodní obrazovka člena s počtem lidí ve fitku a další rezervací' },
    { src: '/branka/sprava.webp', alt: 'Branka: správa fitka s lidmi uvnitř, tržbami a otevřením dveří na dálku' },
  ],
  screens: [
    { src: '/branka/vstup.webp', caption: 'Vstup', text: 'Klepni a dveře se odemknou.' },
    { src: '/branka/trener.webp', caption: 'Trenéři', text: 'Profil, hodnocení a volné termíny.' },
    { src: '/branka/ja.webp', caption: 'Statistiky', text: 'Návštěvy, čas v pohybu, série týdnů.' },
    { src: '/branka/vstup-open.webp', caption: 'Otevřeno', text: 'Bez čipů, karet a klíčů.' },
  ],
  automate: {
    title: 'Zautomatizujeme i to vaše',
    text: 'Branka je jeden příklad provozu, který jde automatizovat. Pošlete nám, co vás ve firmě zdržuje, a zkusíme zautomatizovat jakékoliv zadání, které nám dáte: rezervace, objednávky, dokumenty, provoz, cokoliv.',
    cta: 'Zadat automatizaci',
  },
}

export const aiWebShop = {
  label: 'Web & Eshop',
  title: 'Weby a e-shopy děláme dál',
  text: 'Web nebo e-shop na míru bez vstupní investice. Platíte měsíční paušál, ve kterém je hosting, správa i drobné úpravy.',
  href: '/web-eshop',
  cta: 'Web & Eshop',
}

export const aiSteps = {
  label: 'Postup',
  title: 'Jak spolupráce probíhá',
  steps: [
    { hash: 'b71e0a2', title: 'Konzultace', text: 'Zdarma. Probereme nápad, vaše data a co má AI dělat.' },
    { hash: '4d9c3f8', title: 'Návrh a prototyp', text: 'Navrhneme řešení a ověříme, že funguje na vašich datech.' },
    { hash: 'c2a8e61', title: 'Vývoj', text: 'Postavíme ho a napojíme na vaše systémy.' },
    { hash: '7f30d95', title: 'Spuštění a provoz', text: 'Spustíme, hlídáme a dál vylepšujeme.' },
  ],
}
