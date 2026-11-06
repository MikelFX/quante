# agent-shop — an online store described for AI agents (version 1)

The format is defined in code, in one place: `lib/agent-shops/spec.ts` (served as
https://quantecode.com/agent-shops and, for agents, https://quantecode.com/agent-shops.md).

- What every Quante store serves: `lib/store-template/agent-shop.ts`
  (`/.well-known/agent-shop.json`, `/llms.txt`, `/api/agent/products|quote|order`, `/api/mcp`).
- How the registry reads and validates a store: `lib/agent-shops/model.ts` (`parseShopDoc`, `parseProducts`).
- Registry API: `GET /api/agent/v1/shops` (free directory), `GET /api/agent/v1/shops/search?q=` (paid per call),
  site MCP tools `list_agent_shops` (free) and `find_products` (paid).
