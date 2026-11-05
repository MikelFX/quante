// The offer side of pay-per-call (pure, no I/O): what a 402 asks for, in x402 v1 (body) and v2
// (PAYMENT-REQUIRED header, with the `bazaar` discovery extension). Server flow: pay-per-call.ts.
// Tested in __tests__/agent-product.test.mjs.
import { APP_ORIGIN } from '@/lib/domains'
import { paymentRequiredV2, requirements, type X402Config, type ResourceInfo } from '@/lib/qbox/x402'
import { agentToolUsd, type AgentTool } from './paid-price'

/** How to call a tool, for x402 discovery (the `bazaar` extension's info + its JSON Schema). */
export type CallShape =
  | { method: 'GET'; query: Record<string, { description: string; example: string }> }
  | { method: 'POST'; body: Record<string, { type: 'string' | 'boolean'; description: string; example: string | boolean }> }
  | { method: 'MCP'; toolName: string; description: string; inputSchema: Record<string, unknown>; example: Record<string, unknown> }

export interface PayPerCallTool {
  tool: AgentTool
  description: string
  call: CallShape
  outputExample: Record<string, unknown>
  tags: string[]
  /** calls per IP per hour (before any payment) */
  perIpHour: number
}

export const SERVICE_NAME = 'Quante agent tools'

export const clientIp = (req: Request) =>
  req.headers.get('x-real-ip')?.trim() || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

export const hasApiKey = (req: Request) => /^Bearer\s+\S+/i.test(req.headers.get('authorization') ?? '')

/** The `bazaar` discovery extension (specs/extensions/bazaar.md, x402 v2). Pure. */
export function bazaarExtension(call: CallShape, outputExample: Record<string, unknown>) {
  const output = { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] }
  if (call.method === 'MCP') {
    return {
      info: { input: { type: 'mcp', toolName: call.toolName, description: call.description, transport: 'streamable-http', inputSchema: call.inputSchema, example: call.example }, output: { type: 'json', example: outputExample } },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'mcp' },
              toolName: { type: 'string' },
              description: { type: 'string' },
              transport: { type: 'string', enum: ['streamable-http', 'sse'] },
              inputSchema: { type: 'object' },
              example: { type: 'object' },
            },
            required: ['type', 'toolName', 'inputSchema'],
            additionalProperties: false,
          },
          output,
        },
        required: ['input'],
      },
    }
  }
  if (call.method === 'GET') {
    const names = Object.keys(call.query)
    return {
      info: { input: { type: 'http', method: 'GET', queryParams: Object.fromEntries(names.map((n) => [n, call.query[n].example])) }, output: { type: 'json', example: outputExample } },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
              queryParams: { type: 'object', properties: Object.fromEntries(names.map((n) => [n, { type: 'string', description: call.query[n].description }])), required: names },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['type', 'method'],
            additionalProperties: false,
          },
          output,
        },
        required: ['input'],
      },
    }
  }
  const names = Object.keys(call.body)
  return {
    info: { input: { type: 'http', method: 'POST', bodyType: 'json', body: Object.fromEntries(names.map((n) => [n, call.body[n].example])) }, output: { type: 'json', example: outputExample } },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
            bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
            body: { type: 'object', properties: Object.fromEntries(names.map((n) => [n, { type: call.body[n].type, description: call.body[n].description }])), required: names },
            queryParams: { type: 'object', additionalProperties: { type: 'string' } },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
          },
          required: ['type', 'method', 'bodyType', 'body'],
          additionalProperties: false,
        },
        output,
      },
      required: ['input'],
    },
  }
}

/** Both offers for one tool: v1 requirements (body) and the v2 PaymentRequired (header). Pure. */
export function offerFor(cfg: X402Config, t: PayPerCallTool, resource: string) {
  const usd = agentToolUsd(t.tool)
  const reqs = requirements(cfg, usd, resource, t.description, { input: { type: t.call.method === 'MCP' ? 'mcp' : 'http', method: t.call.method, discoverable: true }, output: t.outputExample })
  const info: ResourceInfo = { url: resource, description: t.description.slice(0, 500), mimeType: 'application/json', serviceName: SERVICE_NAME, tags: t.tags.slice(0, 5), iconUrl: `${APP_ORIGIN}/apple-icon.png` }
  const v2 = (error: string) => paymentRequiredV2(reqs, info, error, { bazaar: bazaarExtension(t.call, t.outputExample) })
  return { usd, reqs, v2 }
}
