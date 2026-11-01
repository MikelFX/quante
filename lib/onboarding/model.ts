// Onboarding (/start): "who are you → what do you want to do → one short input" and then the
// visitor is IN the module, with the form already filled. Pure — no React, no fetch, no storage —
// so the routing and the hand-off drafts are tested (__tests__/onboarding.test.mjs).
//
// Every goal ends in an existing flow, with that flow's own hand-off:
//   ads   → /qads (Ad: `qads:draft:v1`, Character: `qads:tiktoker:v1` + ?mode=character,
//           Plan: ?mode=plan[&project=])
//   scan  → /qscan?url=<address> (the "the store is mine" checkbox still waits there)
//   new   → /new, the description is sent as the first message of the intake chat
//           (`quante:new:draft:v1`, read once by app/(app)/new/page.tsx)
//   edit  → /project/<id>?tab=edit (Qdit, the visual editor; desktop only)
//   review→ /project/<id>?tab=qgent
// Nothing here spends credits: the visitor still presses the module's own button.

export const PERSONAS = [
  { id: 'business', label: 'A small business owner', text: 'I sell products or services and want more customers.' },
  { id: 'creator', label: 'A creator or freelancer', text: 'I make content or work for my own clients.' },
  { id: 'agency', label: 'An agency', text: 'We build stores and run ads for many brands.' },
] as const
export type PersonaId = (typeof PERSONAS)[number]['id']

export const GOALS = [
  { id: 'ads', module: 'Qads', label: 'Make ads for a product', text: 'Ad videos and photos, an AI creator who presents it, or a 30-day plan.' },
  { id: 'scan', module: 'Qscan', label: 'Bring my existing store over', text: 'Paste its address — we copy products, photos and copy into a new, better store.' },
  { id: 'new', module: 'Generate', label: 'Build a new online store', text: 'Describe what you sell and Quante builds the whole store with checkout.' },
  { id: 'edit', module: 'Qdit', label: 'Change how my store looks', text: 'Click any text or block on your store and edit it in place.', needsStore: true },
  { id: 'review', module: 'Qgent', label: 'Let AI check my store', text: 'Qgent reviews copy, products and trust signals and suggests fixes.', needsStore: true },
] as const
export type GoalId = (typeof GOALS)[number]['id']

export const AD_KINDS = [
  { id: 'ad', label: 'Ad video + photos', text: 'From one product photo' },
  { id: 'character', label: 'AI creator', text: 'A person who talks about it' },
  { id: 'plan', label: '30-day plan', text: 'What to post and when', needsStore: true },
] as const
export type AdKind = (typeof AD_KINDS)[number]['id']

/** The three steps of the wizard (the progress bar). */
export const STEPS = ['who', 'goal', 'detail'] as const

export interface Answers {
  persona: PersonaId | null
  goal: GoalId | null
  adKind: AdKind
  productName: string
  productDescription: string
  url: string
  storeBrief: string
  projectId: string | null
}

export const EMPTY: Answers = {
  persona: null,
  goal: null,
  adKind: 'ad',
  productName: '',
  productDescription: '',
  url: '',
  storeBrief: '',
  projectId: null,
}

/** What is saved on the profile (Clerk publicMetadata.onboarding + table user_onboarding). */
export interface SavedOnboarding {
  v: 1
  persona: PersonaId | null
  goal: GoalId | null
  skipped: boolean
  at: string
}

export const LIMITS = { name: 120, description: 1000, url: 2048, brief: 2000 } as const

export const NEW_DRAFT_KEY = 'quante:new:draft:v1'
export const QADS_DRAFT_KEY = 'qads:draft:v1'
export const CHARACTER_DRAFT_KEY = 'qads:tiktoker:v1'
/** The answers kept in localStorage across sign-up (a new tab may finish the sign-up). */
export const PENDING_KEY = 'quante:onboarding:pending:v1'
export const PENDING_MAX_AGE_MS = 24 * 3_600_000
/** Set by POST /api/onboarding: the dashboard stops sending the account here even if Clerk is slow. */
export const DONE_COOKIE = 'q_onb'

const isPersona = (v: unknown): v is PersonaId => PERSONAS.some((p) => p.id === v)
const isGoal = (v: unknown): v is GoalId => GOALS.some((g) => g.id === v)
const isAdKind = (v: unknown): v is AdKind => AD_KINDS.some((k) => k.id === v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const asPersona = (v: unknown): PersonaId | null => (isPersona(v) ? v : null)
export const asGoal = (v: unknown): GoalId | null => (isGoal(v) ? v : null)

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Answers from untrusted input (a URL, localStorage, a request body): unknown values dropped. */
export function parseAnswers(raw: unknown): Answers {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    persona: asPersona(o.persona),
    goal: asGoal(o.goal),
    adKind: isAdKind(o.adKind) ? o.adKind : 'ad',
    productName: text(o.productName, LIMITS.name),
    productDescription: text(o.productDescription, LIMITS.description),
    url: text(o.url, LIMITS.url),
    storeBrief: text(o.storeBrief, LIMITS.brief),
    projectId: typeof o.projectId === 'string' && UUID.test(o.projectId) ? o.projectId : null,
  }
}

/** The saved record on a profile, or null when the account never answered (or it is unreadable). */
export function parseSaved(raw: unknown): SavedOnboarding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1 || typeof o.at !== 'string') return null
  return { v: 1, persona: asPersona(o.persona), goal: asGoal(o.goal), skipped: o.skipped === true, at: o.at }
}

/** The goal cards in the order that fits the persona; store-only goals only for accounts with a store. */
export function goalsFor(persona: PersonaId | null, hasStore: boolean) {
  const order: Record<PersonaId, GoalId[]> = {
    business: ['ads', 'scan', 'new', 'review', 'edit'],
    creator: ['ads', 'new', 'scan', 'edit', 'review'],
    agency: ['new', 'scan', 'ads', 'review', 'edit'],
  }
  const ids = order[persona ?? 'business']
  return ids
    .map((id) => GOALS.find((g) => g.id === id)!)
    .filter((g) => hasStore || !('needsStore' in g))
}

/** The ad kinds on offer: the plan works from a store's products, so it needs one. */
export function adKindsFor(hasStore: boolean) {
  return AD_KINDS.filter((k) => hasStore || !('needsStore' in k))
}

/** Example placeholders per persona (never pre-filled as values). */
export function examplesFor(persona: PersonaId | null) {
  switch (persona) {
    case 'creator':
      return { product: 'Handmade ceramic mug', brief: 'Prints of my travel photography, A3 and A4, shipped rolled in a tube.' }
    case 'agency':
      return { product: 'Client’s bestseller', brief: 'A store for a client: natural cosmetics, 20 products, Czech and English.' }
    default:
      return { product: 'Organic face serum 30 ml', brief: 'Fresh roasted coffee beans from our roastery in Brno, subscriptions and gift boxes.' }
  }
}

/** Normalised store address for Qscan, or null when it can't be one. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim()
  if (!s || s.length > LIMITS.url || /\s/.test(s)) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname.includes('.') || u.username || u.password) return null
    return u.href
  } catch {
    return null
  }
}

/** True when the detail step has what its goal needs (the "Continue" button). */
export function detailReady(a: Answers, hasStore: boolean): boolean {
  switch (a.goal) {
    case 'ads':
      if (a.adKind === 'plan') return hasStore && !!a.projectId
      return a.productName.trim().length > 1
    case 'scan':
      return normalizeUrl(a.url) !== null
    case 'new':
      return a.storeBrief.trim().length >= 8
    case 'edit':
    case 'review':
      return !!a.projectId
    default:
      return false
  }
}

export interface Draft { key: string; value: string }
export interface Destination { href: string; module: string; drafts: Draft[] }

/** Where the finished wizard goes, and the drafts the module reads on arrival (sessionStorage). */
export function destination(a: Answers): Destination {
  switch (a.goal) {
    case 'ads': {
      if (a.adKind === 'plan') {
        return { module: 'Qads Plan', href: a.projectId ? `/qads?mode=plan&project=${a.projectId}` : '/qads?mode=plan', drafts: [] }
      }
      const productName = a.productName.trim().slice(0, LIMITS.name)
      const productDescription = a.productDescription.trim().slice(0, LIMITS.description)
      if (a.adKind === 'character') {
        return {
          module: 'Qads Character',
          href: '/qads?mode=character',
          drafts: [{ key: CHARACTER_DRAFT_KEY, value: JSON.stringify({ note: '', productName, productDescription }) }],
        }
      }
      return {
        module: 'Qads',
        href: '/qads',
        // Merged over the composer's defaults (app/qads/QadsGeneratorClient.tsx).
        drafts: [{ key: QADS_DRAFT_KEY, value: JSON.stringify({ brief: productDescription || productName, productName, productDescription }) }],
      }
    }
    case 'scan': {
      const url = normalizeUrl(a.url)
      return { module: 'Qscan', href: url ? `/qscan?url=${encodeURIComponent(url)}` : '/qscan', drafts: [] }
    }
    case 'new':
      return {
        module: 'Generate',
        href: '/new',
        drafts: a.storeBrief.trim() ? [{ key: NEW_DRAFT_KEY, value: a.storeBrief.trim().slice(0, LIMITS.brief) }] : [],
      }
    case 'edit':
      return { module: 'Qdit', href: a.projectId ? `/project/${a.projectId}?tab=edit` : '/dashboard', drafts: [] }
    case 'review':
      return { module: 'Qgent', href: a.projectId ? `/project/${a.projectId}?tab=qgent` : '/dashboard', drafts: [] }
    default:
      return { module: 'Dashboard', href: '/dashboard', drafts: [] }
  }
}

/** The first step to show for a link like /start?persona=business&goal=ads (from the website). */
export function startStep(a: Pick<Answers, 'persona' | 'goal'>): number {
  if (!a.persona) return 0
  if (!a.goal) return 1
  return 2
}

/**
 * Send this account to /start from the dashboard? Only the first time: it never answered (nor
 * skipped), and it has made nothing yet — an account with work is never interrupted.
 */
export function shouldOnboard(saved: SavedOnboarding | null, doneCookie: boolean, hasWork: boolean): boolean {
  return !saved && !doneCookie && !hasWork
}

/** The record to save. */
export function toSaved(a: Pick<Answers, 'persona' | 'goal'>, skipped: boolean, now: Date = new Date()): SavedOnboarding {
  return { v: 1, persona: a.persona, goal: skipped ? null : a.goal, skipped, at: now.toISOString() }
}
