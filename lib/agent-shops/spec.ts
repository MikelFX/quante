// The agent-shop format, version 1 — the open description of an online store for AI agents that
// every Quante store serves (lib/store-template/agent-shop.ts) and the registry reads
// (./model.ts). One source for quantecode.com/agent-shops (the page and its Markdown for agents);
// docs/agents/agent-shop.md points here. Any store on any platform may adopt it.
import { APP_ORIGIN } from '@/lib/domains'
import { agentToolUsd } from '@/lib/agents/paid-price'
import { CREDIT_COSTS } from '@/lib/config'

export const AGENT_SHOPS_PAGE = `${APP_ORIGIN}/agent-shops`

export const DOC_EXAMPLE = {
  agentShop: '1.0',
  shop: { name: 'Kafe u Lípy', description: 'Specialty coffee roastery in Brno.', url: 'https://kafeulipy.cz', language: 'cs', country: 'CZ', currency: 'CZK' },
  catalog: {
    products: 24, inStock: 21,
    url: 'https://kafeulipy.cz/api/agent/products',
    search: 'https://kafeulipy.cz/api/agent/products?q={query}',
    product: 'https://kafeulipy.cz/api/agent/products?id={id}',
  },
  shipping: { methods: [{ id: 'zasilkovna', label: 'Zásilkovna', price: 79, currency: 'CZK' }], freeShippingFrom: 1000, shipsTo: ['CZ'] },
  payment: { methods: [{ id: 'stripe', kind: 'online', label: 'Card', fee: 0, currency: 'CZK' }, { id: 'dobirka', kind: 'cash_on_delivery', label: 'Cash on delivery', fee: 39, currency: 'CZK' }] },
  ordering: {
    available: true,
    quote: { method: 'POST', url: 'https://kafeulipy.cz/api/agent/quote' },
    order: { method: 'POST', url: 'https://kafeulipy.cz/api/agent/order' },
  },
  policies: { terms: 'https://kafeulipy.cz/terms', privacy: 'https://kafeulipy.cz/privacy', contact: 'https://kafeulipy.cz/contact' },
  interfaces: { mcp: 'https://kafeulipy.cz/api/mcp', llms: 'https://kafeulipy.cz/llms.txt' },
}

export function agentShopsMarkdown(): string {
  return `# Agent-ready stores

Online stores an AI agent can read and buy from for its person — and the registry where agents find them.

## The format: /.well-known/agent-shop.json (version 1)

A store publishes one JSON document at \`https://<store>/.well-known/agent-shop.json\`:

- \`shop\` — name, description, country, language, currency
- \`catalog\` — product count and the product list URL (\`?q=\` search, \`?id=\` one product). A product: id, name, description, url, images, price, compareAtPrice, currency, available, stock (null = not tracked), sku, tags, variants
- \`shipping\` — methods with prices, free-shipping threshold, countries
- \`payment\` — methods with kind \`online\` | \`cash_on_delivery\` | \`bank_transfer\` and fee
- \`ordering\` — \`available\`, the \`quote\` and \`order\` endpoints, or why orders are off
- \`policies\` — terms, privacy, contact pages
- \`interfaces\` — the store's MCP server and llms.txt

Every URL in the document is on the store's own address.

\`\`\`json
${JSON.stringify(DOC_EXAMPLE, null, 2)}
\`\`\`

## Buying as an agent

1. Read the document, search the catalog.
2. \`POST ordering.quote.url\` with \`{ "items": [{ "id", "quantity" }], "shippingMethod", "paymentMethod" }\` — the store prices it from its own catalog (shipping, fees, stock). Nothing changes. Show your person the total.
3. Only with your person's consent: \`POST ordering.order.url\` with the same fields plus \`"buyer": { "name", "email", "phone"?, "address": { "street", "city", "postalCode", "country" } }\` and \`"consent": true\`.
4. Online payment answers \`status: "awaiting_payment"\` and a \`paymentUrl\` — your person pays there themselves. Cash on delivery and bank transfer answer \`status: "placed"\` and a \`confirmationUrl\`; the confirmation (with bank details) goes to the buyer's e-mail.

The same as MCP tools at \`interfaces.mcp\` (Streamable HTTP, no key): get_shop, search_products, get_product, quote_order, place_order.

## The registry

- Directory of listed stores, free: ${APP_ORIGIN}/api/agent/v1/shops (\`?country=CZ\`)
- Product search across all of them: ${APP_ORIGIN}/api/agent/v1/shops/search?q=… — $${agentToolUsd('shops').toFixed(2)} per call, x402 USDC with no account (or a Qbox balance); not charged when nothing is found
- MCP: ${APP_ORIGIN}/api/mcp — list_agent_shops (free), find_products (paid)

The registry re-reads every listed store daily; a store that does not answer three days in a row is hidden until it answers again.

## Listing a store

Every store built with Quante is agent-ready once it is published. Its owner lists it in the Quante Dashboard → the store → Agents: ${CREDIT_COSTS.agent_shop_listing} credits once per store (included in the Agency plan). Stores on other platforms: the format is open — the registry will accept them once their owner can prove the address is theirs (coming next).
`
}
