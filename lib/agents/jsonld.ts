// schema.org JSON-LD for the website and the Quante pages, built from the agent catalog — so
// search engines and AI crawlers read the same facts and prices the agents get. No visual change.
import { APP_ORIGIN, SITE_ORIGIN } from '@/lib/domains'
import { AGENT_LINKS, agentCatalog } from './catalog'

const ORG_ID = `${SITE_ORIGIN}/#organization`

function organization() {
  const c = agentCatalog()
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: c.organization.name,
    alternateName: 'Assetra Digital',
    url: `${SITE_ORIGIN}/`,
    logo: `${SITE_ORIGIN}/icon.svg`,
    areaServed: 'CZ',
    knowsLanguage: ['cs', 'en'],
    ...(c.organization.companyId ? { identifier: c.organization.companyId } : {}),
    owns: [{ '@id': `${APP_ORIGIN}/#quante` }, { '@id': `${APP_ORIGIN}/qbox#qbox` }],
  }
}

/** The website: organization, website, its AI and web services. */
export function siteJsonLd() {
  const c = agentCatalog()
  const services = c.offerings.filter((o) => o.kind === 'service')
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization(),
      { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: 'Assetra Digital', inLanguage: 'cs', publisher: { '@id': ORG_ID } },
      ...services.map((s) => ({ '@type': 'Service', name: s.name, description: s.summary, url: s.url, provider: { '@id': ORG_ID }, areaServed: 'CZ' })),
    ],
  }
}

/** The Quante pages: Quante as an application with its credit packs, Qbox as a web API. */
export function quanteJsonLd() {
  const c = agentCatalog()
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization(),
      {
        '@type': 'SoftwareApplication',
        '@id': `${APP_ORIGIN}/#quante`,
        name: 'Quante',
        url: `${APP_ORIGIN}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: 'AI e-shop builder: a whole store from a text brief, visual editing, ad photos and videos, review by 20 agents.',
        publisher: { '@id': ORG_ID },
        offers: c.quantePricing.creditPacks.map((p) => ({ '@type': 'Offer', name: `${p.credits} credits`, price: p.priceUsd.toFixed(2), priceCurrency: 'USD', url: `${APP_ORIGIN}/#cenik` })),
      },
      {
        '@type': 'WebAPI',
        '@id': `${APP_ORIGIN}/qbox#qbox`,
        name: 'Qbox',
        description: 'Sandboxes for AI agents: isolated Linux microVMs over a REST API and MCP.',
        url: AGENT_LINKS.qbox.page,
        documentation: AGENT_LINKS.qbox.openapi,
        provider: { '@id': ORG_ID },
      },
    ],
  }
}

/** Safe inside <script>: no "</script>" can close it early. */
export const jsonLdString = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
