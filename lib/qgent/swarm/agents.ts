// Qgent swarm: the 20 agents that go through a store together (/qgent). Pure data — the review
// route, the checks, the model prompt and the stage on the client all read this one list, so an
// agent's name, colour and job are the same everywhere. No imports (tests load this file directly).

export interface SwarmAgent {
  /** stable id, used in findings and in the model's JSON schema */
  id: string
  /** short name on the cursor tag */
  name: string
  /** one line in the UI: what this agent looks at */
  role: string
  /** what the model is asked to look for on this agent's behalf */
  focus: string
}

export const SWARM_AGENTS: readonly SwarmAgent[] = [
  { id: 'scout', name: 'Scout', role: 'Page structure', focus: 'the page structure: one clear h1, a logical heading order, sections that tell a story from hero to proof to call to action' },
  { id: 'headline', name: 'Headline', role: 'Hero & value', focus: 'the hero headline and subheadline: is it instantly clear what the store sells and why to buy here' },
  { id: 'copy', name: 'Copy', role: 'Body copy', focus: 'body copy that is vague, long-winded or generic; rewrite it tighter and more concrete, keeping the facts' },
  { id: 'typo', name: 'Proof', role: 'Spelling & grammar', focus: 'typos, grammar mistakes, mixed languages, inconsistent capitalisation' },
  { id: 'cta', name: 'CTA', role: 'Calls to action', focus: 'buttons and calls to action: vague labels ("Click here", "More"), missing CTA in the hero, too many competing CTAs' },
  { id: 'nav', name: 'Nav', role: 'Navigation', focus: 'the main menu: unclear or too many items, missing key pages (shop, about, contact)' },
  { id: 'cards', name: 'Cards', role: 'Product cards', focus: 'product cards and listings: names, missing prices, missing photos, weak titles' },
  { id: 'detail', name: 'Detail', role: 'Product page', focus: 'the product page: thin or missing description, missing benefits, missing size / material / care facts the shopper needs' },
  { id: 'price', name: 'Price', role: 'Price clarity', focus: 'price clarity: currency, VAT, discounts shown honestly, prices that are hard to find' },
  { id: 'trust', name: 'Trust', role: 'Trust signals', focus: 'trust: who runs the store, contact details, guarantees, real reviews (never invent any)' },
  { id: 'shipping', name: 'Ship', role: 'Delivery & returns', focus: 'delivery times and prices, free-shipping threshold, returns — visible before checkout' },
  { id: 'checkout', name: 'Cart', role: 'Path to checkout', focus: 'friction on the way to the cart: hidden add-to-cart, distractions, unclear next step' },
  { id: 'seo', name: 'SEO', role: 'Search snippet', focus: 'the page title and meta description as they appear in Google: length, keywords, brand' },
  { id: 'schema', name: 'Schema', role: 'Structured data', focus: 'structured data (JSON-LD Product, Organization, BreadcrumbList) for rich results' },
  { id: 'alt', name: 'Alt', role: 'Image alt texts', focus: 'images without alt text or with useless alt text such as file names' },
  { id: 'access', name: 'A11y', role: 'Accessibility', focus: 'accessibility: page language, links and buttons without text, form fields without labels, contrast problems you can infer' },
  { id: 'mobile', name: 'Mobile', role: 'Phones', focus: 'phone readiness: viewport meta, long unbroken text, too many menu items for a small screen' },
  { id: 'speed', name: 'Speed', role: 'Page weight', focus: 'page weight: many scripts, heavy HTML, images without lazy loading, third-party widgets' },
  { id: 'legal', name: 'Legal', role: 'Terms & privacy', focus: 'legal basics for an EU e-shop: terms, privacy policy, cookie consent, company identification' },
  { id: 'social', name: 'Social', role: 'Sharing & social', focus: 'how the store looks when shared: Open Graph title and image, social profiles, newsletter sign-up' },
] as const

export const SWARM_AGENT_IDS: readonly string[] = SWARM_AGENTS.map((a) => a.id)

const INDEX = new Map(SWARM_AGENTS.map((a, i) => [a.id, i]))

/** The agent's position in the list (its colour on the stage), -1 for an unknown id. */
export function agentIndex(id: string): number {
  return INDEX.get(id) ?? -1
}

/**
 * The agent's colour as a hue rotation of the Quante accent (degrees). The stage paints every
 * cursor in var(--q-acc) and turns it by this angle, so the swarm stays on the token palette.
 */
export function agentHue(i: number): number {
  return Math.round(((i * 137.508) % 360) * 10) / 10
}
