// Central configuration — all costs, limits, and tier settings live here.
// Never inline these constants in route files.

// ─── Agency subscription ──────────────────────────────────────────────────────
// Create a recurring Price in the Stripe dashboard (€399/month, EUR) and paste
// the Price ID into STRIPE_AGENCY_PRICE_ID.
export const AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID ?? ''
export const AGENCY_MONTHLY_USD = 699

// Toggle to true to activate a 7-day trial on new Agency checkouts.
export const AGENCY_TRIAL_DAYS = process.env.AGENCY_TRIAL_DAYS === 'true' ? 7 : 0

// ─── Project limits ───────────────────────────────────────────────────────────
export const AGENCY_PROJECT_LIMIT = 20
export const FREE_PROJECT_LIMIT = 3   // applies to both 'free' and 'credit' tiers

// ─── Agency AI rate limits ────────────────────────────────────────────────────
// Per-minute cap on Claude calls for agency users (abuse guard; not credit-based).
export const AGENCY_RATE_LIMIT_PER_MIN = 10
// Max tokens per request for agency users.
export const AGENCY_TOKEN_CAP = 64_000

// ─── Credit costs ─────────────────────────────────────────────────────────────
export const CREDIT_COSTS = {
  generate:         10,
  iterate:           1,
  section:           2,
  custom_component:  3,
  export:            5,
  export_admin:     10,
  deploy:            5,
  fix:               2,
  vision:            1,
  welcome_grant:    25,
} as const

// ─── Credit-tier rate limits (requests / hour) ────────────────────────────────
export const RATE_LIMITS = {
  generate:  5,
  iterate:  60,
  section:  15,
} as const
