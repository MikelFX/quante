# Paid agent tools — where agents find them (2026-11-05)

What is sold (HTTP under `https://quantecode.com/api/agent/v1/`, MCP tools on `https://quantecode.com/api/mcp`):

| Tool | HTTP | MCP | Price |
|---|---|---|---|
| Product page → product JSON | `GET product?url=` | `lookup_product` | $0.01 |
| Store profile: contacts, IČO/VAT, payments, shipping, policy links | `GET store?url=` | `profile_store` | $0.01 |
| Company check in ARES + VIES | `GET company?ico=&vat=` | `check_company` | $0.01 |
| Quick store check by rules (no AI) | `GET check?url=` | `check_store` | $0.02 |
| Run Python / JS / shell once, no network | `POST run` | — | $0.02 |
| Store scan to JSON | `POST scan` | — | $0.20 |

Pay per call over x402 (USDC on Base), no account; nothing is charged when the call fails. Code:
`lib/agents/pay-per-call.ts`, `lib/agents/agent-tools.ts`.

## Before any listing (owner)

1. Merge, run `supabase/migration-agent-x402.sql`.
2. Vercel env: `QBOX_X402_PAY_TO`, `QBOX_X402_NETWORK=base`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`.
3. Check it answers 402: `curl -i "https://quantecode.com/api/agent/v1/product?url=https://www.allbirds.com/products/mens-tree-runners"`
   (expect `402` and a `PAYMENT-REQUIRED` header).

## Listings, in order of reach

| # | Where | What to do | Account |
|---|---|---|---|
| 1 | **x402 Bazaar** (Coinbase; also feeds agentic.market) | Automatic: the first call that settles through the CDP facilitator lists the tool (HTTP and MCP each once). Make one paid call per tool from any x402 wallet (≈ $0.27 for all six). Check `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, ~15 min. | none |
| 2 | **x402scan.com** | Register resource → paste the six URLs above (one each). It reads the 402 and lists price + schema. | sign in with a wallet / GitHub |
| 3 | **Official MCP Registry** | `mcp-publisher login github` (as MikelFX) → `mcp-publisher publish docs/agents/server.json`. | GitHub |
| 4 | **Smithery**, **Glama**, **mcp.so**, **PulseMCP** | Add remote server `https://quantecode.com/api/mcp`; paste the one-liner below. `tools/list` works without a key. | each site |
| 5 | GitHub "awesome" lists for x402 and MCP servers | Pull request with the one-liner. | GitHub |

## Text to paste

**One line:** Any public product page to clean JSON (price, currency, in stock, brand, SKU, GTIN, rating). $0.01 per call in USDC over x402, no account, not charged when nothing is found.

**Short description:** Product data for shopping, price-watch and comparison agents. Send a product URL, get
normalized JSON read from the page's own structured data (schema.org JSON-LD, microdata, OpenGraph).
Works with any x402 client (v1 and v2) or as the MCP tool `lookup_product`. Sites that block bots get
an honest error; nothing is stored. By Quante (AssetraDigital s.r.o., Czech Republic).

**Tags:** ecommerce, product-data, prices, shopping, scraping, x402, mcp

**Store profile, one line:** Any online store's home page to its contacts, company ids (IČO, EU VAT), payment and shipping methods and policy links. $0.01 per call over x402, no account.

**Company check, one line:** Verify a Czech company (IČO, ARES) or any EU VAT number (VIES) in the official registers. $0.01 per call over x402, no account.

**Store check, one line:** Instant rule-based audit of an online store (headline, buttons, alt texts, prices, trust, policies, SEO basics) as JSON findings. $0.02 per call over x402, no account.

**Run code, one line:** Run a Python, JavaScript or shell snippet once in a fresh sandbox with no network and get stdout, stderr and the exit code. $0.02 per call over x402, no account.

**Tags (store / company):** lead-generation, enrichment, kyb, company-data, vat, eu, x402, mcp
