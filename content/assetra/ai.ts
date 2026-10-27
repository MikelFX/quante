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
  sub: 'Pro inspiraci. Když tu svůj nápad nevidíte, napište nám ho.',
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

/** Our own AI products — everything here exists in this repository. */
export const aiBuilt = {
  label: 'Už to děláme',
  title: 'Vlastní AI produkty',
  sub: 'AI nejen nabízíme, sami na ní stavíme. Tohle jsou naše vlastní produkty.',
  items: [
    { kind: 'grid', title: 'Quante', text: 'AI vytvoří celý e-shop podle zadání. Úpravy v chatu, kód si stáhnete.', href: '/quante', cta: 'Prohlédnout Quante' },
    { kind: 'chat', title: 'Qgent', text: 'AI agent, který projde e-shop a po vašem potvrzení ho upraví. Na tomhle webu odpovídá na vaše dotazy.', href: '/quante/qgent', cta: 'Detail Qgent' },
    { kind: 'spark', title: 'Qads', text: 'Reklamní videa a fotky produktů, které vytvoří AI.', href: '/quante/qads', cta: 'Detail Qads' },
  ] satisfies { kind: Object3DKind; title: string; text: string; href: string; cta: string }[],
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
