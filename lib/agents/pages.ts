// Every public page as Markdown for AI agents. Pure: built from the same content the HTML pages
// render (content/assetra/*, through the Qgent knowledge and the catalog), so the two can't drift.
// The proxy serves it for `Accept: text/markdown` and for "<path>.md"; /api/agent/v1/page and the
// site MCP server read it too. Tested in __tests__/agents.test.mjs.

import { modules, quanteFlow } from '@/content/assetra/modules'
import { buildQgentKnowledge } from '@/content/assetra/qgent'
import { APP_ORIGIN, SITE_ORIGIN, hostKind } from '@/lib/domains'
import { AGENT_MODULE_SLUGS as MODULE_SLUGS, agentPageId } from './page-ids'
import { AGENT_LINKS, agentCatalog, moduleUrl, RUNTIME_OFF, type AgentRuntime } from './catalog'
import { agentToolUsd } from './paid-price'

export interface AgentPage {
  id: string
  title: string
  /** Canonical HTML URL. */
  url: string
  /** Canonical Markdown URL. */
  md: string
  markdown: string
}

type Kind = ReturnType<typeof hostKind>

export { agentPageId }

const list = (xs: readonly string[]) => xs.map((x) => `- ${x}`).join('\n')
const nul = (v: unknown, what: string) => (v === null || v === undefined ? `[${what}: zatím nezveřejněno]` : String(v))

function footer(rt: AgentRuntime) {
  return `\n---\n\nFor agents: whole offer as JSON ${AGENT_LINKS.catalog} · MCP server ${AGENT_LINKS.mcp} · ${AGENT_LINKS.llmsFull}${rt.qboxOpen ? ` · sandboxes for agents ${AGENT_LINKS.qbox.llms}` : ''}\n`
}

function aiPage(rt: AgentRuntime): AgentPage {
  const k = buildQgentKnowledge()
  const md = `# AssetraDigital: AI řešení a software na míru

> ${k.ai.what}

Firma: ${k.company.name} (${k.company.note}) · IČO ${nul(k.company.ico, 'IČO')} · Web: ${SITE_ORIGIN}

## Služby

${k.ai.services.map((s) => `### ${s.name}\n\n${s.what}\n\n${list(s.includes)}`).join('\n\n')}

## Pro koho

${list(k.ai.forWhom)}

## Co firmy chtějí nejčastěji

${list(k.ai.commonIdeas)}

## Naše vlastní AI produkty

${list(k.ai.ownProducts)}

## Jak spolupráce probíhá

${k.ai.process.map((s) => `${s.step}. **${s.title}**: ${s.text}`).join('\n')}

## Cena

${k.ai.note}

## Kontakt

${k.contact.howToReachUs} Formulář: ${SITE_ORIGIN}/#kontakt. Telefon: ${nul(k.contact.phone, 'telefon')}. E-mail: ${nul(k.contact.email, 'e-mail')}.

## Další stránky

- [Web & Eshop na míru](${SITE_ORIGIN}/web-eshop.md)
- [Quante: e-shop s AI, který si uděláte sami](${APP_ORIGIN}/index.md)
- [Pro AI agenty](${SITE_ORIGIN}/agents.md)
${footer(rt)}`
  return { id: 'ai', title: 'AssetraDigital: AI řešení a software na míru', url: `${SITE_ORIGIN}/`, md: `${SITE_ORIGIN}/index.md`, markdown: md }
}

function webPage(rt: AgentRuntime): AgentPage {
  const k = buildQgentKnowledge()
  const p = k.agency.pricing
  const md = `# Web & Eshop na míru (AssetraDigital)

> ${k.agency.what}

## Co děláme

${k.agency.services.map((s) => `### ${s.name}\n\n${list(s.includes)}`).join('\n\n')}

## Ceník

**Předplatné** (předem ${p.subscription.upfront}, minimálně ${p.subscription.minimumMonths} měsíců):

${p.subscription.plans.map((pl) => `- **${pl.name}**: ${pl.perMonthCzk} Kč měsíčně (${pl.includes.join(', ')})`).join('\n')}

**Jednorázově**: web od ${p.oneOff.webFromCzk} Kč, e-shop od ${p.oneOff.eshopFromCzk} Kč. Správa měsíčně od ${nul(p.oneOff.managementPerMonthFromCzk, 'cena')}, hodinová sazba ${nul(p.oneOff.hourlyRateCzk, 'sazba')}. ${p.oneOff.note}

DPH: ${nul(p.vat, 's DPH / bez DPH')}. ${p.note}

## Pravidla ve smlouvě

${list(k.agency.contractRules)}

## Jak spolupráce probíhá

${k.agency.process.map((s) => `${s.step}. **${s.title}**: ${s.text}`).join('\n')}

## Ukázka práce

**${k.agency.work.name}**: ${k.agency.work.description} (${k.agency.work.status})

${list(k.agency.work.details)}

## Kontakt

${k.contact.howToReachUs} Formulář: ${SITE_ORIGIN}/web-eshop#kontakt.
${footer(rt)}`
  return { id: 'web-eshop', title: 'Web & Eshop na míru', url: `${SITE_ORIGIN}/web-eshop`, md: `${SITE_ORIGIN}/web-eshop.md`, markdown: md }
}

function quantePage(rt: AgentRuntime): AgentPage {
  const k = buildQgentKnowledge()
  const c = agentCatalog(rt).quantePricing
  const md = `# Quante

> ${k.quante.what} ${k.quante.relation} ${k.quante.language}

Quante je produkt AssetraDigital s.r.o. Aplikace: ${APP_ORIGIN}/dashboard · Začít: ${APP_ORIGIN}/start

## Moduly

${modules.map((m) => `- [${m.name}](${moduleUrl(m.slug)}.md)${m.status === 'dev' ? ' (ve vývoji)' : ''}: ${m.short}`).join('\n')}

## Jak moduly navazují

${quanteFlow.map((f, i) => `${i + 1}. **${f.title}**: ${f.text}`).join('\n')}

## Ceník (USD, karta přes Stripe)

Na začátek ${c.welcomeCredits} kreditů zdarma.

${c.creditPacks.map((p) => `- ${p.credits} kreditů za ${p.priceUsd} USD (${p.perCreditUsd} USD za kredit)`).join('\n')}

${list(k.quante.pricing.costs)}

- Hosting: ${k.quante.pricing.hosting}
- Agency: ${k.quante.pricing.agency}
${footer(rt)}`
  return { id: 'quante', title: 'Quante', url: `${APP_ORIGIN}/`, md: `${APP_ORIGIN}/index.md`, markdown: md }
}

function modulePage(slug: string, rt: AgentRuntime): AgentPage | null {
  const k = buildQgentKnowledge()
  const m = [...k.quante.modulesAvailable, ...k.quante.modulesInDevelopment].find((x) => x.slug === slug)
  const src = modules.find((x) => x.slug === slug)
  if (!m || !src) return null
  const app = src.status === 'live' && src.app ? `${APP_ORIGIN}${new URL(src.app.href, APP_ORIGIN).pathname}` : null
  const md = `# ${m.name}

> ${m.what}

Stav: ${m.status}. Součást [Quante](${APP_ORIGIN}/index.md).${app ? ` Otevřít v aplikaci (vyžaduje přihlášení): ${app}` : ''}

## Co umí

${list(m.features)}
${m.note ? `\n${m.note}\n` : ''}
## Návaznost

${list(m.connections)}

## Cena

${m.costs.length ? list(m.costs) : 'Bez samostatné ceny.'}
${footer(rt)}`
  return { id: `module:${slug}`, title: m.name, url: moduleUrl(slug), md: `${moduleUrl(slug)}.md`, markdown: md }
}

function agentsPage(rt: AgentRuntime): AgentPage {
  const md = `# For AI agents

You are welcome here. Everything on assetradigital.agency and quantecode.com is available to you in machine-readable form, without scraping:

- **Whole offer as JSON** (products, prices from the billing code, contact, what is not published yet): ${AGENT_LINKS.catalog}
- **MCP server** (Streamable HTTP, no key): ${AGENT_LINKS.mcp} — tools get_catalog, list_pages, read_page, search_site, get_changelog, get_contact, request_quote
- **Ask for a quote for your person** (only when they asked; a few per day): POST ${APP_ORIGIN}/api/agent/v1/inquiry with { contact, name, need, message, consent: true, agent }
- **Markdown of every page**: send \`Accept: text/markdown\`, or add ".md" to the path (home: /index.md)
- **Search**: ${AGENT_LINKS.search}?q=e-shop
- **Paid tools** (one Qbox account and key for everything; ${rt.x402 ? 'top up yourself over x402, USDC' : 'prepaid balance'}; charged only when the site could be read, returned when the work fails):
  - Store review by 20 Qgent agents: POST ${AGENT_LINKS.review} { url, rights: true } — $${agentToolUsd('review').toFixed(2)}
  - Store scan into structured JSON (products, prices, brand, colours): POST ${AGENT_LINKS.scan} { url, rights: true } — $${agentToolUsd('scan').toFixed(2)}
- **OpenAPI**: ${AGENT_LINKS.openapi} · **API catalog** (RFC 9727): ${AGENT_LINKS.apiCatalog}
- **llms.txt**: ${AGENT_LINKS.llmsSite}, ${AGENT_LINKS.llmsApp}, full text ${AGENT_LINKS.llmsFull}
- **Qbox, sandboxes for agents**${rt.qboxOpen ? (rt.x402 ? ' (pay by yourself over x402, USDC)' : ' (paid)') : ' (invite-only beta)'}: ${AGENT_LINKS.qbox.llms}

Rules: the website is in Czech, the Quante app and the APIs in English. Prices are real (computed from the code that charges them). A null or "[…: zatím nezveřejněno]" means the fact is not published yet — say so, never guess it. You may quote, summarise and cite these pages; please link the canonical URL.
`
  return { id: 'agents', title: 'For AI agents', url: `${SITE_ORIGIN}/agents.md`, md: `${SITE_ORIGIN}/agents.md`, markdown: md }
}

function qboxPage(rt: AgentRuntime, qboxLlms: string): AgentPage {
  return { id: 'qbox', title: 'Qbox', url: AGENT_LINKS.qbox.page, md: AGENT_LINKS.qbox.llms, markdown: qboxLlms + footer(rt) }
}

/** One page by id (see agentPageId). `qboxLlms` = lib/qbox/openapi.ts llmsTxt(), passed in to keep this file free of it. */
export function agentPage(id: string, rt: AgentRuntime = RUNTIME_OFF, qboxLlms = ''): AgentPage | null {
  if (id === 'ai') return aiPage(rt)
  if (id === 'web-eshop') return webPage(rt)
  if (id === 'quante') return quantePage(rt)
  if (id === 'agents') return agentsPage(rt)
  if (id === 'qbox') return qboxPage(rt, qboxLlms)
  if (id.startsWith('module:')) return modulePage(id.slice(7), rt)
  return null
}

/** Every page, in reading order. */
export function agentPages(rt: AgentRuntime = RUNTIME_OFF, qboxLlms = ''): AgentPage[] {
  const ids = ['agents', 'ai', 'web-eshop', 'quante', ...MODULE_SLUGS.map((s) => `module:${s}`), 'qbox']
  return ids.map((id) => agentPage(id, rt, qboxLlms)).filter((p): p is AgentPage => !!p)
}

/** A page by any URL or path an agent hands us ("https://quantecode.com/quante/qads", "/web-eshop.md", "qbox"). */
export function agentPageFor(input: string, rt: AgentRuntime = RUNTIME_OFF, qboxLlms = ''): AgentPage | null {
  const s = input.trim()
  if (!s) return null
  if (agentPages(rt, qboxLlms).some((p) => p.id === s)) return agentPage(s, rt, qboxLlms)
  let kind: Kind = 'shared'
  let path = s
  try {
    const u = new URL(s)
    kind = hostKind(u.host)
    path = u.pathname
  } catch {
    if (!s.startsWith('/')) path = '/' + s
  }
  const id = agentPageId(path, kind)
  return id ? agentPage(id, rt, qboxLlms) : null
}
