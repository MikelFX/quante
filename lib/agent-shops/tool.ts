// Product search across the agent-ready store registry as a paid agent tool (server only):
// GET /api/agent/v1/shops/search and the site MCP tool `find_products`. $0.01 a call
// (AGENT_TOOL_FIXED_USD.shops), x402 with no account or a Qbox balance; not charged when nothing
// is found or the registry is not set up. The free directory is GET /api/agent/v1/shops.
import type { PayPerCallTool } from '@/lib/agents/pay-per-call-offer'
import type { Work } from '@/lib/agents/pay-per-call'
import { FIND_PRODUCTS_INPUT } from '@/lib/agents/mcp'
import type { SearchFilters } from './model'
import { RegistryUnavailable, searchRegistry } from './registry'

export const SHOPS_HTTP_TOOL: PayPerCallTool = {
  tool: 'shops',
  description: 'Search products across every agent-ready online store in the registry: price, availability, stock + where and how to order',
  call: { method: 'GET', query: {
    q: { description: 'What to buy, a few words', example: 'coffee beans ethiopia' },
    country: { description: 'Store country (ISO 3166-1 alpha-2), optional', example: 'CZ' },
    maxPrice: { description: 'Highest unit price, optional', example: '500' },
  } },
  outputExample: {
    query: 'coffee beans ethiopia',
    results: [{
      product: { id: 'p1', name: 'Ethiopia Yirgacheffe 250 g', url: 'https://kafe.example/products/ethiopia', price: 289, currency: 'CZK', available: true, stock: 14 },
      shop: { name: 'Kafe', url: 'https://kafe.example', country: 'CZ', agentShop: 'https://kafe.example/.well-known/agent-shop.json', ordersFromAgents: true },
    }],
  },
  tags: ['ecommerce', 'shopping', 'product-search', 'agentic-commerce', 'registry'],
  perIpHour: 600,
}

export const SHOPS_MCP_TOOL: PayPerCallTool = {
  ...SHOPS_HTTP_TOOL,
  call: { method: 'MCP', toolName: 'find_products', description: SHOPS_HTTP_TOOL.description, inputSchema: FIND_PRODUCTS_INPUT, example: { query: 'coffee beans ethiopia', country: 'CZ' } },
}

export async function findProducts(f: SearchFilters & { tsquery: string }): Promise<Work> {
  let results
  try {
    results = await searchRegistry(f)
  } catch (e) {
    if (e instanceof RegistryUnavailable) return { ok: false, status: 503, body: { error: 'The registry of agent-ready stores is not open yet. Nothing was charged.' } }
    return { ok: false, status: 500, body: { error: 'The search failed. Nothing was charged.' } }
  }
  if (!results.length) return { ok: false, status: 404, body: { error: 'No agent-ready store sells this yet. Nothing was charged.', query: f.q } }
  return {
    ok: true,
    body: {
      query: f.q,
      filters: { country: f.country, currency: f.currency, maxPrice: f.maxPrice, inStock: f.inStock },
      results,
      howToBuy: 'Open the store\'s agentShop document: quote the basket there, then order with your person\'s consent (POST …/api/agent/order or the store\'s MCP server).',
    },
  }
}
