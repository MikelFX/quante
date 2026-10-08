// Qgent's knowledge base for the public website assistant, built ONLY from the website content
// (content/assetra/site.ts, modules.ts, quante-pricing.ts). Written to content/qgent-knowledge.json
// by `npm run qgent:knowledge`; a test fails when the JSON is out of date. Unknown facts stay null —
// the assistant must say they are clarified at the consultation, never guess.

import { company, contact, contract, legalPages, pricing, services, steps, work } from './site'
import { modules, quanteFlow, quanteIntro } from './modules'
import { moduleCosts, quantePricing } from './quante-pricing'
import { LEAD_NEEDS } from '../../lib/assetra/lead'

/** Places the assistant may scroll to (navigate tool) — section id on a page. */
export const QGENT_SECTIONS = {
  sluzby: { page: '/', id: 'sluzby', title: 'Služby: firemní web, e-shop, správa a hosting' },
  smlouva: { page: '/', id: 'smlouva', title: 'Pravidla ve smlouvě' },
  cenik: { page: '/', id: 'cenik', title: 'Ceník webů a e-shopů na míru' },
  postup: { page: '/', id: 'postup', title: 'Jak spolupráce probíhá' },
  prace: { page: '/', id: 'prace', title: 'Ukázka práce: návrh e-shopu Harwo' },
  quante: { page: '/', id: 'quante', title: 'Quante na hlavní stránce' },
  kontakt: { page: '/', id: 'kontakt', title: 'Kontakt a formulář poptávky' },
  'quante-moduly': { page: '/quante', id: 'moduly', title: 'Moduly Quante' },
  'quante-propojeni': { page: '/quante', id: 'propojeni', title: 'Jak moduly Quante navazují' },
  'quante-cenik': { page: '/quante', id: 'cenik', title: 'Ceník Quante: kredity, hosting, Agency' },
} as const
export type QgentSection = keyof typeof QGENT_SECTIONS

/** Pages the assistant may open (openPage tool). */
export const QGENT_PAGES = {
  home: { path: '/', title: 'Hlavní stránka AssetraDigital' },
  quante: { path: '/quante', title: 'Quante: přehled modulů' },
  ...Object.fromEntries(modules.map((m) => [`quante/${m.slug}`, { path: `/quante/${m.slug}`, title: `${m.name}${m.status === 'dev' ? ' (ve vývoji)' : ''}` }])),
  ...Object.fromEntries(legalPages.map((p) => [p.slug, { path: '/' + p.slug, title: `${p.title} (text zatím není hotový)` }])),
} as Record<string, { path: string; title: string }>

/** Same choices as the lead form („Co potřebujete“). */
export const QGENT_NEEDS = LEAD_NEEDS

export const QGENT_QUICK_PROMPTS = ['Kolik stojí e-shop?', 'Jak probíhá spolupráce?', 'Co je Quante?'] as const

const statusCs = (s: 'live' | 'dev') => (s === 'live' ? 'k dispozici' : 've vývoji (termín se neuvádí, nic se neslibuje)')

function moduleFacts(m: (typeof modules)[number]) {
  return {
    slug: m.slug,
    name: m.name,
    status: statusCs(m.status),
    what: m.lead,
    features: m.features.map((f) => `${f.title}: ${f.text}`),
    note: m.note ?? null,
    connections: m.links.map((l) => l.text),
    costs: moduleCosts(m.slug).map((c) => `${c.label}: ${c.value}`),
    page: `/quante/${m.slug}`,
  }
}

export function buildQgentKnowledge() {
  return {
    version: 1,
    source: 'Obsah webu AssetraDigital (content/assetra/*.ts). Nic jiného není ověřené.',
    company: {
      name: company.name,
      note: 'Firma se zakládá.',
      ico: company.ico,
      seat: company.seat,
      registry: company.registry,
    },
    contact: {
      phone: contact.phone,
      email: contact.email,
      responseTime: contact.responseTime,
      howToReachUs: 'Formulář poptávky na hlavní stránce (sekce Kontakt). Konzultace je zdarma.',
    },
    agency: {
      what: 'Weby a e-shopy na míru bez vstupní investice. Klient platí měsíční paušál, ve kterém je hosting, správa a drobné úpravy. Klientské weby běží na Vercelu, každý e-shop má vlastní administraci.',
      services: services.items.map((s) => ({
        name: s.title,
        includes: s.features.map((f) => [f.b, f.t].filter(Boolean).join(' ')),
      })),
      contractRules: contract.rules.map((r) => r.title),
      pricing: {
        subscription: {
          upfront: pricing.subscription.upfront,
          minimumMonths: pricing.subscription.minMonths,
          plans: pricing.subscription.plans.map((p) => ({ name: p.name, perMonthCzk: p.monthly, includes: p.includes })),
          note: 'Bez vstupní investice; hosting, správa, zálohy a drobné úpravy jsou v měsíční ceně.',
        },
        oneOff: {
          webFromCzk: pricing.oneOff.web,
          eshopFromCzk: pricing.oneOff.eshop,
          managementPerMonthFromCzk: pricing.oneOff.management,
          hourlyRateCzk: pricing.oneOff.hourly,
          note: 'Při jednorázové platbě se správa a hosting platí zvlášť měsíčně a práce navíc podle hodinové sazby. V ceně „od“ je jen návrh a stavba.',
        },
        vat: pricing.vat,
        note: 'Ceny jsou z ceníku na webu. Jiné ceny, slevy ani individuální nabídky asistent neuvádí — ty jsou až na konzultaci.',
      },
      process: steps.steps.map((s, i) => ({ step: i + 1, title: s.title, text: s.text })),
      work: {
        name: work.title,
        description: work.sub,
        details: work.spec.map((s) => `${s.dt}: ${s.dd}`),
        status: work.approved ? 'zveřejněno se souhlasem klienta' : 'návrh; zveřejnění čeká na souhlas klienta, nepředstavovat jako hotový e-shop',
      },
    },
    quante: {
      what: quanteIntro.sub,
      relation: 'Quante je software od AssetraDigital: e-shop si v něm uživatel udělá sám. Moduly na sebe navazují, aby se celý e-shop vyřešil na jednom místě.',
      language: 'Aplikace Quante je v angličtině.',
      // Split so the model never presents a module in development as working.
      modulesAvailable: modules.filter((m) => m.status === 'live').map(moduleFacts),
      modulesInDevelopment: modules.filter((m) => m.status === 'dev').map(moduleFacts),
      flow: quanteFlow.map((f) => {
        const m = modules.find((x) => f.text.includes(x.name))
        return `${f.title} — ${f.text}${m?.status === 'dev' ? ' (ve vývoji)' : ''}`
      }),
      pricing: {
        currency: 'USD, platba kartou přes Stripe',
        welcomeCredits: quantePricing.welcomeCredits,
        creditPacks: quantePricing.packs.map((p) => `${p.credits} kreditů za ${p.price} USD`),
        costs: quantePricing.costs.map((c) => `${c.label}: ${c.value}`),
        hosting: `${quantePricing.hosting.annualUsd} USD ročně, první měsíc zdarma`,
        agency: `${quantePricing.agency.monthlyUsd} USD měsíčně, až ${quantePricing.agency.projects} obchodů, úpravy a opravy bez kreditů, export bez značky Quante`,
      },
      appUrl: '/dashboard (přihlášení), nový obchod /new, Qads /qads',
    },
    navigation: {
      sections: Object.entries(QGENT_SECTIONS).map(([key, s]) => ({ key, page: s.page, title: s.title })),
      pages: Object.entries(QGENT_PAGES).map(([key, p]) => ({ key, path: p.path, title: p.title })),
    },
    unknownUntilConsultation: [
      'IČO, sídlo a zápis v obchodním rejstříku (firma se zakládá)',
      'telefon a e-mail',
      'do kdy se ozveme',
      'cena správy při jednorázové platbě a hodinová sazba',
      'jestli jsou ceny s DPH, nebo bez',
      'obchodní podmínky, ochrana osobních údajů a vzorová smlouva (texty se připravují)',
      `termíny modulů ve vývoji (${modules.filter((m) => m.status === 'dev').map((m) => m.name).join(', ')})`,
    ],
  }
}

export type QgentKnowledge = ReturnType<typeof buildQgentKnowledge>
