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
    alternateName: ['Assetra Digital', 'AssetraDigital'],
    url: `${SITE_ORIGIN}/`,
    // Raster logo (scripts/brand-icons.py): Google wants ≥ 112 px in a format Google Images reads.
    logo: { '@type': 'ImageObject', '@id': `${SITE_ORIGIN}/#logo`, url: `${SITE_ORIGIN}/logo.png`, contentUrl: `${SITE_ORIGIN}/logo.png`, width: 512, height: 512, caption: 'AssetraDigital' },
    image: { '@id': `${SITE_ORIGIN}/#logo` },
    areaServed: 'CZ',
    knowsLanguage: ['cs', 'en'],
    ...(c.organization.companyId ? { identifier: c.organization.companyId } : {}),
    ...(c.contact.email ? { email: c.contact.email } : {}),
    ...(c.contact.phone ? { telephone: c.contact.phone } : {}),
    ...(c.organization.seat ? { address: { '@type': 'PostalAddress', streetAddress: c.organization.seat, addressCountry: 'CZ' } } : {}),
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
      { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: 'Assetra Digital', alternateName: ['AssetraDigital', 'assetradigital.agency'], inLanguage: 'cs', publisher: { '@id': ORG_ID } },
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
      // Site name in Google results for quantecode.com (it reads WebSite on the home page).
      { '@type': 'WebSite', '@id': `${APP_ORIGIN}/#website`, url: `${APP_ORIGIN}/`, name: 'Quante', alternateName: 'quantecode.com', inLanguage: 'cs', publisher: { '@id': ORG_ID } },
      {
        '@type': 'SoftwareApplication',
        '@id': `${APP_ORIGIN}/#quante`,
        name: 'Quante',
        url: `${APP_ORIGIN}/`,
        image: `${APP_ORIGIN}/logo.png`,
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
