# Qbox — where agents find it (2026-11-05)

Owner: Qbox should be the place every agent on the internet comes to. Agents use what is in their tool
list, in a registry, or what search and their developer recommend. What is built into the app:

- `https://quantecode.com/qbox/llms.txt` — Qbox for language models (lib/qbox/openapi.ts `llmsTxt`)
- `https://quantecode.com/api/qbox/v1/openapi.json` — OpenAPI 3.1 (`openApiDocument`)
- `https://quantecode.com/api/qbox/v1/mcp` — MCP server (Streamable HTTP); `initialize` and `tools/list` need no key
- `POST https://quantecode.com/api/qbox/v1/accounts` — an agent opens a paid account itself (x402, USDC)

## Listings (need an account of the owner; do them once QBOX_ACCESS=open is live)

1. **Official MCP Registry** (registry.modelcontextprotocol.io): `docs/qbox/server.json`.
   `mcp-publisher login github` (as MikelFX, gives the `io.github.MikelFX/*` namespace), then
   `mcp-publisher publish docs/qbox/server.json`. With a DNS TXT record on quantecode.com the name can
   become `com.quantecode/qbox` instead.
2. **Smithery** (smithery.ai) and **Glama** (glama.ai/mcp): add a remote server with the MCP URL above;
   both read `tools/list` without a key.
3. **x402 Bazaar** (Coinbase CDP's discovery catalogue, also behind agentic.market): set
   `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (a CDP *secret API key*, portal.cdp.coinbase.com → API keys,
   Ed25519) and `QBOX_X402_NETWORK=base`. The pay-per-call tools (`/api/agent/v1/product`, `/scan`)
   send the `bazaar` extension in their 402; the first call that settles through CDP lists them
   (indexing can take ~15 min). Check: `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`.
4. **mcp.so, PulseMCP, awesome-mcp-servers** — submit the MCP URL + one line.
5. **npm / PyPI** `qbox` clients — thin wrappers over the REST API (not built yet).
