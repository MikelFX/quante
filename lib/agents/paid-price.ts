// What the paid agent tools cost (pure, client-safe). An agent pays either per call over x402 (no
// account, the market's default: lib/agents/pay-per-call.ts) or from its Qbox balance — the same
// account, key and x402 top-up as Qbox sandboxes. Store review and scan cost what a person pays in
// Quante credits, converted at Qbox's credit rate, so agents and people pay the same. The product
// lookup has no Quante counterpart, so it has its own price, set at the x402 market's median per
// call (~$0.01, 2026-10). Nothing an agent does here is free (owner 2026-11-05).
import { CREDIT_COSTS } from '@/lib/config'
import { QBOX_PRICING } from '@/lib/qbox/limits'

export const AGENT_TOOL_CREDITS = {
  /** 20 Qgent agents review a store page (same as /qgent). */
  review: CREDIT_COSTS.qgent_swarm,
  /** Qscan reads a store into structured JSON (for people the scan is free but capped per day; agents pay). */
  scan: 1,
} as const

/** Tools priced directly in USD (no Quante credit counterpart). */
export const AGENT_TOOL_FIXED_USD = {
  /** One product page → normalized product JSON (price, currency, availability, GTIN …). */
  product: 0.01,
  /** A store's home page → contacts, company ids, payments, shipping, policy links. */
  store: 0.01,
  /** A Czech IČO / EU VAT number checked in ARES + VIES. */
  company: 0.01,
  /** The Qgent rule checks over a store's home + one product page (no model). */
  check: 0.02,
  /** Counterparty verdict: ARES + VIES + the Czech VAT-payer register (unreliable payer, published accounts) + the account to pay. */
  counterparty: 0.03,
  /** One snippet of Python / JavaScript / shell in a fresh Qbox sandbox with no network (≤ 40 s, 1 vCPU). */
  run: 0.02,
  /** A product search across the registry of agent-ready stores (lib/agent-shops). */
  shops: 0.01,
} as const

export type AgentTool = keyof typeof AGENT_TOOL_CREDITS | keyof typeof AGENT_TOOL_FIXED_USD

const isFixed = (tool: AgentTool): tool is keyof typeof AGENT_TOOL_FIXED_USD => tool in AGENT_TOOL_FIXED_USD

/** Balance units (vCPU-minutes) one call costs. */
export const agentToolUnits = (tool: AgentTool) => isFixed(tool)
  ? AGENT_TOOL_FIXED_USD[tool] * QBOX_PRICING.vcpuMinutesPerUsd
  : AGENT_TOOL_CREDITS[tool] * QBOX_PRICING.vcpuMinutesPerCredit

/** The same in USD. */
export const agentToolUsd = (tool: AgentTool) => Math.round((agentToolUnits(tool) / QBOX_PRICING.vcpuMinutesPerUsd) * 100) / 100

/** Tools an agent can pay per call over x402, without any account (review runs too long for that). */
export const PAY_PER_CALL_TOOLS = ['product', 'store', 'company', 'counterparty', 'check', 'run', 'scan', 'shops'] as const satisfies readonly AgentTool[]
