// Qbox's machine-readable face (2026-11-05, owner: agents must find, understand and pay for Qbox
// on their own). Pure data, no I/O: the OpenAPI 3.1 document (/api/qbox/v1/openapi.json), the MCP
// tool list (/api/qbox/v1/mcp) and llms.txt (/qbox/llms.txt) are all built from here and
// lib/qbox/model.ts, so docs and limits can't drift. Tested in __tests__/qbox.test.mjs.

import { APP_ORIGIN } from '../domains.ts'
import { QBOX_BETA, QBOX_PAID, QBOX_PAID_VCPUS, QBOX_PRICING, QBOX_REGISTRY_DOMAINS, QBOX_TEMPLATES } from './limits.ts'

export const QBOX_LINKS = {
  page: `${APP_ORIGIN}/qbox`,
  terms: `${APP_ORIGIN}/qbox#terms`,
  llms: `${APP_ORIGIN}/qbox/llms.txt`,
  openapi: `${APP_ORIGIN}/api/qbox/v1/openapi.json`,
  mcp: `${APP_ORIGIN}/api/qbox/v1/mcp`,
  api: `${APP_ORIGIN}/api/qbox/v1`,
} as const

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
]

// ── OpenAPI ───────────────────────────────────────────────────────────────────

const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
const pay = { description: 'Payment required: the 402 body carries x402 `accepts` and every other way to pay.', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentRequired' } } } }
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
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
      'x-operator': 'AssetraDigital s.r.o. (Quante)',
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

> Sandboxes for AI agents. One API call starts an isolated Linux microVM (${QBOX_TEMPLATES.join(', ')}) where your agent runs code, installs packages, reads and writes files and exposes preview URLs. Made by AssetraDigital s.r.o. (Quante).

${PRICE_LINE}

## Start in one minute (no sign-up)

1. \`POST ${QBOX_LINKS.api}/accounts?usd=5\` → HTTP 402 with x402 \`accepts\` (USDC). Pay it with any x402 client (it repeats the request with an \`X-PAYMENT\` header).
2. The answer has \`apiKey\` (shown once) and your balance. Send \`Authorization: Bearer <apiKey>\` from now on.
3. \`POST ${QBOX_LINKS.api}/sandboxes\` \`{"template":"node24","timeoutMs":300000}\` → \`{ id, ... }\`
4. \`POST ${QBOX_LINKS.api}/sandboxes/{id}/exec\` \`{"command":"node -v"}\` → \`{ exitCode, stdout, stderr }\`
5. \`DELETE ${QBOX_LINKS.api}/sandboxes/{id}\` when done; unused time returns to the balance.

When the balance runs low, any call answers 402 with what to pay; pay it the same way and the call goes through.
People can also create a key at ${QBOX_LINKS.page} and pay with Quante credits.

## Links

- [OpenAPI](${QBOX_LINKS.openapi}): the full API
- [MCP server](${QBOX_LINKS.mcp}): Streamable HTTP, header \`Authorization: Bearer <apiKey>\`; tools ${MCP_TOOLS.map((t) => t.name).join(', ')}
- [Qbox page](${QBOX_LINKS.page}): keys, examples, terms

## Limits

- Up to ${QBOX_PAID.maxConcurrent} sandboxes at once, ${QBOX_PAID.maxTimeoutMs / 60_000} minutes each, ${QBOX_PAID_VCPUS.join('/')} vCPUs, files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB, commands up to ${QBOX_BETA.maxCommandMs / 60_000} minutes, output up to ${QBOX_BETA.maxOutputChars / 1000}k characters.
- Not allowed: crypto mining, spam, attacks, scanning other people's systems, illegal content. We may stop any sandbox.
`
}
