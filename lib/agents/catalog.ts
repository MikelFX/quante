// The whole offer of AssetraDigital + Quante + Qbox as one machine-readable object for AI agents
// (owner 2026-11-05: "agents will be 99 % of the internet — make our web a place every agent
// remembers"). Pure data, no I/O: /api/agent/v1/catalog, the site MCP server (/api/mcp), llms.txt
// and the JSON-LD are all built from here, and here only from the code that really charges
// (lib/config.ts, lib/credit-packs.ts, lib/qads/pricing.ts, lib/qbox/limits.ts) and the website copy
// (content/assetra/*, through the Qgent knowledge). Unknown facts stay null — never invent them.
// Tested in __tests__/agents.test.mjs.

import { buildQgentKnowledge } from '@/content/assetra/qgent'
import { modules } from '@/content/assetra/modules'
import { company, contact, pricing as webPricing } from '@/content/assetra/site'
import { moduleCosts } from '@/content/assetra/quante-pricing'
import { AGENCY_BATCH_SIZE, AGENCY_FAIR_USE, AGENCY_MONTHLY_USD, CREDIT_COSTS, HOSTING_ANNUAL_USD, QSCAN_DAILY_SCANS } from '@/lib/config'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { QADS_GENERATOR_CREDIT_COSTS as QADS } from '@/lib/qads/pricing'
import { APP_ORIGIN, SITE_ORIGIN } from '@/lib/domains'
import { QBOX_PAID, QBOX_PAID_VCPUS, QBOX_PRICING, QBOX_TEMPLATES } from '@/lib/qbox/limits'

/** Where the agent layer lives. Absolute, canonical — agents keep these. */
export const AGENT_LINKS = {
  catalog: `${APP_ORIGIN}/api/agent/v1/catalog`,
  search: `${APP_ORIGIN}/api/agent/v1/search`,
  page: `${APP_ORIGIN}/api/agent/v1/page`,
  openapi: `${APP_ORIGIN}/api/agent/v1/openapi.json`,
  mcp: `${APP_ORIGIN}/api/mcp`,
  llmsSite: `${SITE_ORIGIN}/llms.txt`,
  llmsApp: `${APP_ORIGIN}/llms.txt`,
  llmsFull: `${APP_ORIGIN}/llms-full.txt`,
  apiCatalog: `${APP_ORIGIN}/.well-known/api-catalog`,
  mcpCard: `${APP_ORIGIN}/.well-known/mcp/server-card.json`,
  qbox: {
    page: `${APP_ORIGIN}/qbox`,
    llms: `${APP_ORIGIN}/qbox/llms.txt`,
    openapi: `${APP_ORIGIN}/api/qbox/v1/openapi.json`,
    mcp: `${APP_ORIGIN}/api/qbox/v1/mcp`,
    api: `${APP_ORIGIN}/api/qbox/v1`,
  },
} as const

/** What is switched on in this deployment (the routes read it from env; pure code takes it as input). */
export interface AgentRuntime {
  /** QBOX_ACCESS=open: every account may use Qbox on the paid tier (else invite-only beta). */
  qboxOpen: boolean
  /** x402 configured: an agent can pay Qbox by itself in USDC. */
  x402: { network: string } | null
}

export const RUNTIME_OFF: AgentRuntime = { qboxOpen: false, x402: null }

/** "2 490" → 2490; null stays null. */
export function czk(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v.replace(/[\s ]/g, ''))
  return Number.isFinite(n) ? n : null
}

const usd = (cents: number) => Math.round(cents) / 100

/** Canonical page URL of a Quante module. */
export const moduleUrl = (slug: string) => `${APP_ORIGIN}/quante/${slug}`

export function agentCatalog(rt: AgentRuntime = RUNTIME_OFF) {
  const k = buildQgentKnowledge()
  const cheapestPerCredit = Math.min(...CREDIT_PACKS.map((p) => p.priceCents / p.credits))
  return {
    schemaVersion: 1,
    about:
      'Machine-readable offer of AssetraDigital s.r.o. (AI solutions, websites and e-shops, Czech Republic) and its products '
      + 'Quante (AI e-commerce builder, quantecode.com) and Qbox (sandboxes for AI agents). Built from the code that charges the prices; '
      + 'free text is Czech, keys are English. A null value means "not published yet, ask" — never guess it.',
    organization: {
      name: company.name,
      status: 'being founded',
      companyId: company.ico,
      seat: company.seat,
      registry: company.registry,
      country: 'CZ',
      websites: { company: SITE_ORIGIN, quante: APP_ORIGIN },
    },
    contact: {
      phone: contact.phone,
      email: contact.email,
      responseTime: contact.responseTime,
      form: `${SITE_ORIGIN}/#kontakt`,
      note: k.contact.howToReachUs,
    },
    languages: { website: 'cs', quanteApp: 'en', api: 'en' },
    offerings: [
      {
        id: 'ai-solutions',
        kind: 'service',
        name: 'AI řešení na míru',
        summary: k.ai.what,
        url: `${SITE_ORIGIN}/`,
        markdown: `${SITE_ORIGIN}/index.md`,
        audience: k.ai.forWhom,
        services: k.ai.services,
        process: k.ai.process,
        price: { model: 'quote', currency: null, note: k.ai.note },
        howToBuy: { human: `${SITE_ORIGIN}/#kontakt`, agent: null },
      },
      {
        id: 'web-eshop',
        kind: 'service',
        name: 'Web & Eshop na míru',
        summary: k.agency.what,
        url: `${SITE_ORIGIN}/web-eshop`,
        markdown: `${SITE_ORIGIN}/web-eshop.md`,
        services: k.agency.services,
        price: {
          model: 'subscription-or-one-off',
          currency: 'CZK',
          vatIncluded: null,
          subscription: {
            upfront: czk(webPricing.subscription.upfront.replace(/\s*Kč$/, '')),
            minimumMonths: webPricing.subscription.minMonths,
            plans: webPricing.subscription.plans.map((p) => ({ name: p.name, perMonth: czk(p.monthly), includes: p.includes })),
          },
          oneOff: {
            webFrom: czk(webPricing.oneOff.web),
            eshopFrom: czk(webPricing.oneOff.eshop),
            managementPerMonthFrom: czk(webPricing.oneOff.management),
            hourlyRate: czk(webPricing.oneOff.hourly),
          },
          note: k.agency.pricing.note,
        },
        howToBuy: { human: `${SITE_ORIGIN}/web-eshop#kontakt`, agent: null },
      },
      ...modules.map((m) => ({
        id: `quante-${m.slug}`,
        kind: 'software' as const,
        product: 'Quante',
        name: m.name,
        status: m.status === 'live' ? 'available' : 'in-development',
        summary: m.lead,
        features: m.features.map((f) => `${f.title}: ${f.text}`),
        url: moduleUrl(m.slug),
        markdown: `${moduleUrl(m.slug)}.md`,
        app: m.status === 'live' && m.app ? APP_ORIGIN + new URL(m.app.href, APP_ORIGIN).pathname : null,
        price: { model: 'credits', costs: moduleCosts(m.slug) },
        howToBuy: { human: m.status === 'live' ? `${APP_ORIGIN}/signup` : null, agent: null },
      })),
      {
        id: 'qbox',
        kind: 'api',
        product: 'Qbox',
        name: 'Qbox: sandboxes for AI agents',
        status: rt.qboxOpen ? 'available' : 'invite-only beta',
        summary: `Isolated Linux microVMs (${QBOX_TEMPLATES.join(', ')}) for running code, installing packages, files and preview URLs. One API call per sandbox.`,
        url: AGENT_LINKS.qbox.page,
        markdown: AGENT_LINKS.qbox.llms,
        price: {
          model: 'prepaid-usage',
          unit: 'vCPU-minute',
          currency: 'USD',
          perUnit: Math.round((1 / QBOX_PRICING.vcpuMinutesPerUsd) * 1e6) / 1e6,
          perOperationUnits: QBOX_PRICING.opVcpuMinutes,
          minimumUnitsPerSandbox: QBOX_PRICING.minBilledMinutes,
          unitsPerUsd: QBOX_PRICING.vcpuMinutesPerUsd,
          unitsPerQuanteCredit: QBOX_PRICING.vcpuMinutesPerCredit,
          free: false,
        },
        limits: { maxConcurrent: QBOX_PAID.maxConcurrent, maxMinutes: QBOX_PAID.maxTimeoutMs / 60_000, vcpus: [...QBOX_PAID_VCPUS], maxPorts: QBOX_PAID.maxPorts },
        howToBuy: {
          human: AGENT_LINKS.qbox.page,
          agent: rt.qboxOpen && rt.x402
            ? { protocol: 'x402', asset: 'USDC', network: rt.x402.network, start: `POST ${AGENT_LINKS.qbox.api}/accounts?usd=5`, minUsd: QBOX_PRICING.minUsd, maxUsd: QBOX_PRICING.maxUsd }
            : null,
        },
        interfaces: { openapi: AGENT_LINKS.qbox.openapi, mcp: AGENT_LINKS.qbox.mcp, llms: AGENT_LINKS.qbox.llms },
      },
    ],
    quantePricing: {
      currency: 'USD',
      payment: 'card (Stripe)',
      welcomeCredits: CREDIT_COSTS.welcome_grant,
      creditPacks: CREDIT_PACKS.map((p) => ({ id: p.id, credits: p.credits, priceUsd: usd(p.priceCents), perCreditUsd: Math.round(p.priceCents / p.credits) / 100 })),
      lowestPerCreditUsd: Math.round(cheapestPerCredit) / 100,
      creditCosts: {
        generateStore: CREDIT_COSTS.generate,
        chatEdit: CREDIT_COSTS.iterate,
        buildFix: CREDIT_COSTS.fix,
        exportZipPerStore: CREDIT_COSTS.export,
        qgentSwarmReview: CREDIT_COSTS.qgent_swarm,
        qgentStudioReview: CREDIT_COSTS.qgent_review,
        qgentApplyChange: CREDIT_COSTS.qgent_apply,
        qadsPhoto: QADS.imagePerVariant,
        qadsVideoPerSecond: QADS.videoPerSecond,
        qadsPreparationPerGeneration: QADS.strategyPerGeneration,
        qadsPlan: CREDIT_COSTS.qads_plan,
        qscanScan: 0,
      },
      qscanScansPerDay: QSCAN_DAILY_SCANS,
      hosting: { perYearUsd: HOSTING_ANNUAL_USD, trialDays: 30 },
      agencyPlan: {
        perMonthUsd: AGENCY_MONTHLY_USD,
        includes: ['unlimited stores', `batch generation of up to ${AGENCY_BATCH_SIZE} stores`, 'store work and Qads without credits (fair use)', 'export without Quante branding', 'hosting'],
        fairUsePerDay: { storeGenerations: AGENCY_FAIR_USE.generationsPerDay, qadsVideos: AGENCY_FAIR_USE.qadsVideosPerDay, qadsPhotos: AGENCY_FAIR_USE.qadsPhotosPerDay },
      },
      textual: k.quante.pricing,
    },
    agentAccess: {
      mcp: { url: AGENT_LINKS.mcp, transport: 'streamable-http', auth: 'none', readOnly: true },
      qboxMcp: { url: AGENT_LINKS.qbox.mcp, transport: 'streamable-http', auth: 'Bearer qbx_… API key' },
      rest: { catalog: AGENT_LINKS.catalog, search: `${AGENT_LINKS.search}?q=…`, page: `${AGENT_LINKS.page}?url=…`, openapi: AGENT_LINKS.openapi },
      markdown: 'Every public page answers `Accept: text/markdown` with Markdown, and also at the same path + ".md" (the home page as /index.md).',
      llms: [AGENT_LINKS.llmsSite, AGENT_LINKS.llmsApp, AGENT_LINKS.llmsFull],
      discovery: [AGENT_LINKS.apiCatalog, AGENT_LINKS.mcpCard],
    },
    unknownUntilAsked: k.unknownUntilConsultation,
  }
}

export type AgentCatalog = ReturnType<typeof agentCatalog>
