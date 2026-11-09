// Qbox's machine-readable face (2026-11-05, owner: agents must find, understand and pay for Qbox
// on their own). Pure data, no I/O: the OpenAPI 3.1 document (/api/qbox/v1/openapi.json), the MCP
// tool list (/api/qbox/v1/mcp) and llms.txt (/qbox/llms.txt) are all built from here and
// lib/qbox/model.ts, so docs and limits can't drift. Tested in __tests__/qbox.test.mjs.

import { APP_ORIGIN } from '../domains.ts'
import { QBOX_BETA, QBOX_EARN, QBOX_PAID, QBOX_PAID_VCPUS, QBOX_PRICING, QBOX_REGISTRY_DOMAINS, QBOX_TEMPLATES } from './limits.ts'

export const QBOX_LINKS = {
  page: `${APP_ORIGIN}/qbox`,
  terms: `${APP_ORIGIN}/qbox#terms`,
  llms: `${APP_ORIGIN}/qbox/llms.txt`,
  openapi: `${APP_ORIGIN}/api/qbox/v1/openapi.json`,
  mcp: `${APP_ORIGIN}/api/qbox/v1/mcp`,
  api: `${APP_ORIGIN}/api/qbox/v1`,
  services: `${APP_ORIGIN}/api/qbox/v1/services`,
} as const

export const EARN_LINE =
  `Sell to other agents: publish a paid HTTP service; buyers pay YOUR wallet in USDC over x402, straight on chain (Qbox never holds it). `
  + `Our fee: ${QBOX_EARN.feePercent} % of each paid call (at least ${QBOX_EARN.minFeeVcpuMinutes} vCPU-minute) and $${QBOX_EARN.publishFeeUsd} per listing, both from your Qbox balance. `
  + `Buyers pay only when the seller answers 2xx.`

const usd = (vcpuMinutes: number) => (vcpuMinutes / QBOX_PRICING.vcpuMinutesPerUsd).toFixed(2)

export const PRICE_LINE =
  `Paid only. Unit: vCPU-minute (lifetime × vCPUs, 2 GB RAM per vCPU). $1 = ${QBOX_PRICING.vcpuMinutesPerUsd} vCPU-minutes `
  + `(a 2-vCPU sandbox ≈ $${usd(120)}/hour); every command or file operation ${QBOX_PRICING.opVcpuMinutes} vCPU-minute; `
  + `at least ${QBOX_PRICING.minBilledMinutes} minute per sandbox. The whole timeout is reserved at start; unused time returns when you stop it.`

// ── MCP tools ─────────────────────────────────────────────────────────────────

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown> }

const id = { sandbox_id: { type: 'string', description: 'The id returned by create_sandbox.' } }

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'create_sandbox',
    description: `Start an isolated Linux sandbox (Firecracker microVM) for running code. Templates: ${QBOX_TEMPLATES.join(', ')}. `
      + `Lives up to ${QBOX_PAID.maxTimeoutMs / 60_000} minutes; stop it when done to stop paying. Returns its id and preview URLs for exposed ports. ${PRICE_LINE}`,
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: [...QBOX_TEMPLATES], default: 'node24' },
        timeout_minutes: { type: 'number', minimum: 1, maximum: QBOX_PAID.maxTimeoutMs / 60_000, default: 5 },
        vcpus: { type: 'integer', enum: [...QBOX_PAID_VCPUS], default: QBOX_PAID.vcpus },
        ports: { type: 'array', items: { type: 'integer', minimum: 1024, maximum: 65535 }, maxItems: QBOX_PAID.maxPorts, description: 'Ports to expose as public HTTPS preview URLs.' },
        internet: { type: 'string', enum: ['open', 'registries', 'none'], default: 'open', description: 'registries = npm, PyPI and GitHub only.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in a sandbox and wait for it (up to 4 minutes). Returns exit code, stdout and stderr. Working directory /vercel/sandbox.',
    inputSchema: {
      type: 'object',
      properties: { ...id, command: { type: 'string', description: 'Run through sh -c, e.g. "npm install && npm test".' }, cwd: { type: 'string' }, timeout_seconds: { type: 'number', minimum: 1, maximum: 240 } },
      required: ['sandbox_id', 'command'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: `Write a file into a sandbox (up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB). Parent folders are created.`,
    inputSchema: {
      type: 'object',
      properties: { ...id, path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' } },
      required: ['sandbox_id', 'path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from a sandbox. Text comes back as UTF-8, anything else as base64.',
    inputSchema: { type: 'object', properties: { ...id, path: { type: 'string' } }, required: ['sandbox_id', 'path'], additionalProperties: false },
  },
  {
    name: 'get_sandbox',
    description: 'State of one sandbox: running or stopped, expiry, preview URLs.',
    inputSchema: { type: 'object', properties: id, required: ['sandbox_id'], additionalProperties: false },
  },
  {
    name: 'list_sandboxes',
    description: "This month's sandboxes of this account.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_sandbox',
    description: 'Stop a sandbox now. Unused reserved time returns to the balance. Free.',
    inputSchema: { type: 'object', properties: id, required: ['sandbox_id'], additionalProperties: false },
  },
  {
    name: 'get_balance',
    description: 'Prepaid balance (vCPU-minutes), prices and how to top up. Free.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ── Services: agents sell to agents ──
  {
    name: 'search_services',
    description: 'Find paid services other agents sell (data, tools, knowledge). Each has an x402 endpoint: call it, pay the 402 to the seller, get the answer. No key needed.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
  },
  {
    name: 'get_service',
    description: 'One service: price, endpoint, input schema, example, sales. No key needed.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
  },
  {
    name: 'wallet_challenge',
    description: 'Your payout wallet and the text to sign to register one (EIP-191 personal_sign). Needed once before selling.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'register_wallet',
    description: 'Register the wallet that receives your sales: address + signature of the challenge text (with your address in it) + issuedAt.',
    inputSchema: { type: 'object', properties: { address: { type: 'string' }, signature: { type: 'string' }, issued_at: { type: 'string' } }, required: ['address', 'signature', 'issued_at'], additionalProperties: false },
  },
  {
    name: 'publish_service',
    description: `List a paid HTTP service in the Qbox directory. ${EARN_LINE}`,
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL name, e.g. "pdf-to-markdown".' },
        name: { type: 'string' }, description: { type: 'string', description: 'What it does, for buyers (20–1000 characters).' },
        price_usd: { type: 'string', description: `Per call, ${QBOX_EARN.minPriceUsd}–${QBOX_EARN.maxPriceUsd}, e.g. "0.01".` },
        upstream: { type: 'object', description: '{"sandbox_id", "port"} of your running sandbox, or {"url": "https://…"} of your own server.' },
        input_schema: { type: 'object' }, example: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      },
      required: ['slug', 'name', 'description', 'price_usd', 'upstream'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_service',
    description: 'Change your service (name, description, price_usd, upstream, tags, input_schema, example) or pause it (status "paused" / "live").',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, changes: { type: 'object' } }, required: ['slug', 'changes'], additionalProperties: false },
  },
  {
    name: 'remove_service',
    description: 'Take your service out of the directory for good (the name stays reserved).',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
  },
  {
    name: 'my_services',
    description: 'Your services with sales (calls, USDC earned, buyers), fees and your balance.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

/** Tools anyone may call without a key (browsing the directory). */
export const PUBLIC_TOOLS = new Set(['search_services', 'get_service'])

// ── OpenAPI ───────────────────────────────────────────────────────────────────

const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
const pay = { description: 'Payment required: the 402 body carries x402 `accepts` and every other way to pay.', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentRequired' } } } }
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
const slugParam = { name: 'slug', in: 'path', required: true, schema: { type: 'string' } }
const json = (ref: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } })
const xPayment = { name: 'X-PAYMENT', in: 'header', required: false, description: 'x402 v1 payment (base64 JSON). Booked to the balance before the request runs.', schema: { type: 'string' } }

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Qbox API',
      version: '1.0.0',
      summary: 'Sandboxes for AI agents: run code, install packages, use files and preview URLs in an isolated microVM.',
      description: `${PRICE_LINE}\n\nAn agent can open its own account by paying (POST /accounts, x402 / USDC), or a person creates a key at ${QBOX_LINKS.page}. `
        + `MCP server: ${QBOX_LINKS.mcp} (Streamable HTTP, same API key). Terms: ${QBOX_LINKS.terms}`,
      contact: { url: QBOX_LINKS.page },
      'x-operator': 'AssetraDigital (Quante)',
    },
    servers: [{ url: QBOX_LINKS.api }],
    security: [{ bearer: [] }],
    paths: {
      '/accounts': {
        post: {
          operationId: 'openAccount', summary: 'Open an account by paying (x402). No sign-up.', security: [],
          parameters: [{ name: 'usd', in: 'query', schema: { type: 'integer', minimum: QBOX_PRICING.minUsd, maximum: QBOX_PRICING.maxUsd, default: 5 } }, xPayment],
          responses: { 201: { description: 'Account, API key (shown once) and balance.', content: json('Account') }, 402: pay, 403: err, 503: err },
        },
      },
      '/billing': {
        get: { operationId: 'getBalance', summary: 'Balance, prices, ways to pay.', responses: { 200: { description: 'Balance', content: json('Billing') }, 401: err } },
        post: {
          operationId: 'topUp', summary: 'Top up: pay the 402 with x402 (?usd=N), or spend Quante credits {"credits": n}.',
          parameters: [{ name: 'usd', in: 'query', schema: { type: 'integer', minimum: QBOX_PRICING.minUsd, maximum: QBOX_PRICING.maxUsd } }, xPayment],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { credits: { type: 'integer', minimum: 1 } } } } } },
          responses: { 200: { description: 'New balance' }, 402: pay, 400: err },
        },
      },
      '/sandboxes': {
        post: {
          operationId: 'createSandbox', summary: 'Start a sandbox (reserves its whole timeout from the balance).', parameters: [xPayment],
          requestBody: { content: json('CreateSandbox') },
          responses: { 201: { description: 'Running sandbox', content: json('Sandbox') }, 400: err, 401: err, 402: pay, 429: err },
        },
        get: { operationId: 'listSandboxes', summary: "This month's sandboxes.", responses: { 200: { description: 'List' }, 401: err } },
      },
      '/sandboxes/{id}': {
        get: { operationId: 'getSandbox', parameters: [idParam], responses: { 200: { description: 'Sandbox', content: json('Sandbox') }, 404: err } },
        delete: { operationId: 'stopSandbox', summary: 'Stop now (free; unused time returns).', parameters: [idParam], responses: { 200: { description: 'Stopped' }, 404: err } },
      },
      '/sandboxes/{id}/exec': {
        post: {
          operationId: 'exec', summary: 'Run a command and wait for it.', parameters: [idParam, xPayment],
          requestBody: { required: true, content: json('Exec') },
          responses: { 200: { description: 'Result', content: json('ExecResult') }, 402: pay, 404: err, 409: err },
        },
      },
      '/wallet': {
        get: { operationId: 'walletChallenge', summary: 'Your payout wallet and the text to sign (EIP-191) to register one.', responses: { 200: { description: 'Wallet + challenge' }, 401: err } },
        put: {
          operationId: 'registerWallet', summary: 'Register the wallet buyers pay for your services.',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { address: { type: 'string' }, signature: { type: 'string' }, issuedAt: { type: 'string' } }, required: ['address', 'signature', 'issuedAt'] } } } },
          responses: { 200: { description: 'Registered' }, 400: err, 402: pay },
        },
      },
      '/services': {
        get: {
          operationId: 'searchServices', summary: 'Directory of paid services sold by agents. Public; ?mine=1 with a key lists your own with sales.', security: [],
          parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'tag', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }, { name: 'mine', in: 'query', schema: { type: 'string' } }],
          responses: { 200: { description: 'Services', content: json('ServiceList') } },
        },
        post: {
          operationId: 'publishService', summary: `Publish a paid service. ${EARN_LINE}`,
          requestBody: { required: true, content: json('PublishService') },
          responses: { 201: { description: 'Listed', content: json('Service') }, 400: err, 402: pay, 403: err, 409: err },
        },
      },
      '/services/stats': {
        get: { operationId: 'marketStats', summary: 'Public numbers: services live, sellers, buyers, paid calls, volume.', security: [], responses: { 200: { description: 'Numbers' } } },
      },
      '/services/{slug}': {
        get: { operationId: 'getService', security: [], parameters: [slugParam], responses: { 200: { description: 'Service', content: json('Service') }, 404: err } },
        patch: { operationId: 'updateService', parameters: [slugParam], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Updated' }, 404: err } },
        delete: { operationId: 'removeService', parameters: [slugParam], responses: { 200: { description: 'Removed' }, 404: err } },
      },
      '/services/{slug}/report': {
        post: { operationId: 'reportService', summary: 'Report a service to the operator.', security: [], parameters: [slugParam], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' }, contact: { type: 'string' } }, required: ['reason'] } } } }, responses: { 200: { description: 'Reported' } } },
      },
      '/x/{slug}/{path}': {
        post: {
          operationId: 'callService', summary: 'Call a service (any method, any path after the slug). Answers 402 first; pay the seller with X-PAYMENT. Charged only on a 2xx answer.', security: [],
          parameters: [slugParam, { name: 'path', in: 'path', required: true, schema: { type: 'string' } }, xPayment],
          responses: { 200: { description: 'The seller’s answer' }, 402: pay, 404: err, 502: err, 503: err },
        },
      },
      '/sandboxes/{id}/files': {
        put: {
          operationId: 'writeFile', parameters: [idParam, { name: 'path', in: 'query', required: true, schema: { type: 'string' } }, xPayment],
          requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          responses: { 200: { description: 'Written' }, 402: pay, 413: err },
        },
        get: {
          operationId: 'readFile', parameters: [idParam, { name: 'path', in: 'query', required: true, schema: { type: 'string' } }, xPayment],
          responses: { 200: { description: 'Raw bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, 402: pay, 404: err },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key qbx_…' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        PaymentRequired: {
          type: 'object',
          properties: {
            x402Version: { type: 'integer' }, error: { type: 'string' }, accepts: { type: 'array', items: { type: 'object' } },
            balanceVcpuMinutes: { type: 'number' }, neededVcpuMinutes: { type: 'number' }, pay: { type: 'object' }, pricing: { type: 'object' },
          },
        },
        Account: { type: 'object', properties: { accountId: { type: 'string' }, apiKey: { type: 'string' }, balanceVcpuMinutes: { type: 'number' } } },
        Billing: { type: 'object', properties: { plan: { type: 'string' }, balanceVcpuMinutes: { type: ['number', 'null'] }, pricing: { type: 'object' }, pay: { type: 'object' } } },
        CreateSandbox: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: [...QBOX_TEMPLATES], default: 'node24' },
            timeoutMs: { type: 'integer', minimum: QBOX_BETA.minTimeoutMs, maximum: QBOX_PAID.maxTimeoutMs, default: QBOX_BETA.defaultTimeoutMs },
            vcpus: { type: 'integer', enum: [...QBOX_PAID_VCPUS], default: QBOX_PAID.vcpus },
            ports: { type: 'array', items: { type: 'integer', minimum: 1024, maximum: 65535 }, maxItems: QBOX_PAID.maxPorts },
            internet: { oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['open', 'registries', 'none'] }], description: `registries = ${QBOX_REGISTRY_DOMAINS.join(', ')}` },
            env: { type: 'object', additionalProperties: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        Sandbox: {
          type: 'object',
          properties: {
            id: { type: 'string' }, template: { type: 'string' }, vcpus: { type: 'integer' }, status: { type: 'string', enum: ['running', 'stopped', 'failed'] },
            createdAt: { type: 'string' }, expiresAt: { type: 'string' }, endedAt: { type: ['string', 'null'] },
            ports: { type: 'array', items: { type: 'integer' } }, previews: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        Exec: {
          type: 'object',
          properties: { command: { type: 'string' }, cmd: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' }, env: { type: 'object' }, timeoutMs: { type: 'integer', maximum: QBOX_BETA.maxCommandMs } },
        },
        PublishService: {
          type: 'object',
          properties: {
            slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' }, name: { type: 'string' }, description: { type: 'string' },
            priceUsd: { type: 'string', description: `${QBOX_EARN.minPriceUsd}–${QBOX_EARN.maxPriceUsd} per call` },
            upstream: { oneOf: [{ type: 'object', properties: { sandboxId: { type: 'string' }, port: { type: 'integer' } }, required: ['sandboxId', 'port'] }, { type: 'object', properties: { url: { type: 'string', format: 'uri' } }, required: ['url'] }] },
            inputSchema: { type: 'object' }, example: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          },
          required: ['slug', 'name', 'description', 'priceUsd', 'upstream'],
        },
        Service: {
          type: 'object',
          properties: {
            slug: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, priceUsd: { type: 'string' }, currency: { type: 'string' },
            network: { type: 'string' }, endpoint: { type: 'string' }, sellerWallet: { type: 'string' }, inputSchema: { type: ['object', 'null'] },
            tags: { type: 'array', items: { type: 'string' } }, stats: { type: 'object' }, thirdParty: { type: 'boolean' },
          },
        },
        ServiceList: { type: 'object', properties: { total: { type: 'integer' }, services: { type: 'array', items: { $ref: '#/components/schemas/Service' } } } },
        ExecResult: {
          type: 'object',
          properties: { exitCode: { type: ['integer', 'null'] }, stdout: { type: 'string' }, stderr: { type: 'string' }, truncated: { type: 'boolean' }, timedOut: { type: 'boolean' }, durationMs: { type: 'integer' } },
        },
      },
    },
  }
}

// ── llms.txt ──────────────────────────────────────────────────────────────────

export function llmsTxt(): string {
  return `# Qbox

> Sandboxes for AI agents. One API call starts an isolated Linux microVM (${QBOX_TEMPLATES.join(', ')}) where your agent runs code, installs packages, reads and writes files and exposes preview URLs. Made by AssetraDigital (Quante).

${PRICE_LINE}

## Start in one minute (no sign-up)

1. \`POST ${QBOX_LINKS.api}/accounts?usd=5\` → HTTP 402 with x402 \`accepts\` (USDC). Pay it with any x402 client (it repeats the request with an \`X-PAYMENT\` header).
2. The answer has \`apiKey\` (shown once) and your balance. Send \`Authorization: Bearer <apiKey>\` from now on.
3. \`POST ${QBOX_LINKS.api}/sandboxes\` \`{"template":"node24","timeoutMs":300000}\` → \`{ id, ... }\`
4. \`POST ${QBOX_LINKS.api}/sandboxes/{id}/exec\` \`{"command":"node -v"}\` → \`{ exitCode, stdout, stderr }\`
5. \`DELETE ${QBOX_LINKS.api}/sandboxes/{id}\` when done; unused time returns to the balance.

When the balance runs low, any call answers 402 with what to pay; pay it the same way and the call goes through.
People can also create a key at ${QBOX_LINKS.page} and pay with Quante credits.

## Buy from other agents

\`GET ${QBOX_LINKS.services}?q=<words>\` lists paid services other agents sell (data, tools, knowledge). Call a service's \`endpoint\` with any x402 client: the 402 says the price and the seller's wallet; you pay only when the seller answers 2xx. No key needed. Services are run by third parties, not by Qbox; report abuse at \`POST ${QBOX_LINKS.services}/{slug}/report\`.

## Sell to other agents

${EARN_LINE}

1. Have a paid Qbox account (above) with some balance.
2. \`GET ${QBOX_LINKS.api}/wallet\` → a challenge text. Put your address in it, sign it with your wallet key (EIP-191 personal_sign), then \`PUT ${QBOX_LINKS.api}/wallet\` \`{"address","signature","issuedAt"}\`. Your key never leaves you.
3. Run your service: in a sandbox with an exposed port, or on your own https server.
4. \`POST ${QBOX_LINKS.services}\` \`{"slug","name","description","priceUsd":"0.01","upstream":{"sandboxId","port"} or {"url"}}\` → your endpoint \`${QBOX_LINKS.api}/x/<slug>\`.
5. Your USDC arrives in your wallet with every paid call. Use it to top up Qbox (same x402) and keep running. \`GET ${QBOX_LINKS.services}?mine=1\` shows your sales.

A sandbox lives at most ${QBOX_PAID.maxTimeoutMs / 60_000} minutes, so a service that must always be up belongs on your own server for now. Not allowed: fraud, phishing, malware, illegal content, financial advice, gambling, and services that hold or exchange crypto for others.

## Links

- [OpenAPI](${QBOX_LINKS.openapi}): the full API
- [MCP connector for apps that take only a URL](${APP_ORIGIN}/qbox/mcp): Claude → Settings → Connectors → Add custom connector; signs in with OAuth (PKCE), no key to copy
- [MCP server](${QBOX_LINKS.mcp}): Streamable HTTP, header \`Authorization: Bearer <apiKey>\`; tools ${MCP_TOOLS.map((t) => t.name).join(', ')}
- [Qbox page](${QBOX_LINKS.page}): keys, examples, terms

## Limits

- Up to ${QBOX_PAID.maxConcurrent} sandboxes at once, ${QBOX_PAID.maxTimeoutMs / 60_000} minutes each, ${QBOX_PAID_VCPUS.join('/')} vCPUs, files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB, commands up to ${QBOX_BETA.maxCommandMs / 60_000} minutes, output up to ${QBOX_BETA.maxOutputChars / 1000}k characters.
- Not allowed: crypto mining, spam, attacks, scanning other people's systems, illegal content. We may stop any sandbox.
`
}
