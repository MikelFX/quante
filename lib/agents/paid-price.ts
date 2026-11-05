// What the paid agent tools cost (pure, client-safe). An agent pays from its Qbox balance — the
// same account, key and x402 top-up as Qbox sandboxes (one agent account for everything). The price
// is what a person pays in Quante credits, converted at Qbox's credit rate, so agents and people
// pay the same. Nothing an agent does here is free (owner 2026-11-05).
import { CREDIT_COSTS } from '@/lib/config'
import { QBOX_PRICING } from '@/lib/qbox/limits'

export const AGENT_TOOL_CREDITS = {
  /** 20 Qgent agents review a store page (same as /qgent). */
  review: CREDIT_COSTS.qgent_swarm,
  /** Qscan reads a store into structured JSON (for people the scan is free but capped per day; agents pay). */
  scan: 1,
} as const

export type AgentTool = keyof typeof AGENT_TOOL_CREDITS

/** Balance units (vCPU-minutes) one call costs. */
export const agentToolUnits = (tool: AgentTool) => AGENT_TOOL_CREDITS[tool] * QBOX_PRICING.vcpuMinutesPerCredit

/** The same in USD. */
export const agentToolUsd = (tool: AgentTool) => Math.round((agentToolUnits(tool) / QBOX_PRICING.vcpuMinutesPerUsd) * 100) / 100
