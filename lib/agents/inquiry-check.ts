// Pure rules of an agent inquiry (lib/agents/inquiry.ts). Tested in __tests__/agents.test.mjs.
import { checkLead, LEAD_NEEDS } from '@/lib/assetra/lead'

export const AGENT_INQUIRY_LIMITS = { perIpDay: 3, allPerHour: 20 } as const

export interface InquiryInput { name?: unknown; contact?: unknown; need?: unknown; message?: unknown; consent?: unknown; agent?: unknown }
export type InquiryResult = { ok: true; id: string | null } | { ok: false; status: number; error: string }

/** Pure check (tested): the person's consent, then the website form's own validation. */
export function checkInquiry(b: InquiryInput) {
  if (b.consent !== true) return { ok: false as const, error: 'Set consent: true only when your person asked to be contacted by AssetraDigital.' }
  const agent = typeof b.agent === 'string' ? b.agent.replace(/[\r\n]/g, ' ').trim().slice(0, 80) : ''
  const message = typeof b.message === 'string' ? b.message : ''
  const checked = checkLead({ jmeno: b.name, kontakt: b.contact, potreba: b.need, zprava: `${message}${agent ? `\n\n— sent by AI agent: ${agent}` : '\n\n— sent by an AI agent'}`, ms: 60_000, web: '' })
  if (!checked.ok) return { ok: false as const, error: checked.error }
  if (checked.spam) return { ok: false as const, error: 'Rejected.' }
  return { ok: true as const, lead: checked.lead, contactEmail: checked.contactEmail }
}

export const INQUIRY_NEEDS = LEAD_NEEDS

