// Central configuration — all costs, limits, and tier settings live here.
// Never inline these constants in route files.

// ─── Agency subscription ──────────────────────────────────────────────────────
// Create a recurring Price in the Stripe dashboard (€399/month, EUR) and paste
// the Price ID into STRIPE_AGENCY_PRICE_ID.
export const AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID ?? ''
export const AGENCY_MONTHLY_USD = 699

// ─── Hosting subscription (kept here so client components can import
//     without dragging in the server-only Stripe SDK from lib/stripe) ─────────
export const HOSTING_ANNUAL_USD = 99
export const HOSTING_MONTHLY_USD = 9.99

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
//
// Two flag values are 0 on purpose (audit round: pricing consistency):
//
//   export = 0
//     The About page attacks competitors for putting export behind a
//     paywall, so we can't put ours behind one either. Export is free
//     forever, for every user. If we ever need to rate-limit it as
//     abuse protection, do it in /api/export with a per-project cap,
//     not with a credit charge.
//
//   deploy = 0
//     Deploy is gated on an active hosting subscription in
//     /api/deploy, not on a credit balance — users with hosting pay
//     0 credits per deploy (the "unlimited deploys" side of the
//     hosting subscription), users without hosting get a 402 with an
//     upsell payload and never reach the debit path. This makes the
//     "unlimited deploys on hosting" claim on /pricing true instead
//     of the previous "5 credits per deploy on top of the plan".
//
// Both zeros must be enforced server-side, in the corresponding route
// handlers; the marketing site only *displays* what these say.
export const CREDIT_COSTS = {
  generate:         10,
  iterate:           1,
  section:           2,
  custom_component:  3,
  export:            0,  // free — see comment above
  export_admin:     10,
  deploy:            0,  // hosting-gated in /api/deploy — see comment above
  preview_deploy:    2,  // preview deploy (unique URL, no subdomain) — kept
  fix:               0,  // fixes repair a paid generation — always free
  vision:            1,
  welcome_grant:    25,
} as const

// ─── Self-healing deploy loop ─────────────────────────────────────────────────
// Max automatic fix attempts per failed build. After the last attempt fails,
// the generate/iterate debit is refunded (reason 'generation_failed').
export const MAX_AUTO_FIX_ATTEMPTS = 5

// ─── Credit-tier rate limits (requests / hour) ────────────────────────────────
export const RATE_LIMITS = {
  generate:  5,
  iterate:  60,
  section:  15,
} as const
