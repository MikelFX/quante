// Central configuration — all costs, limits, and tier settings live here.
// Never inline these constants in route files.

// ─── Agency subscription ──────────────────────────────────────────────────────
// A recurring Stripe Price of AGENCY_MONTHLY_USD per month; its ID goes into
// STRIPE_AGENCY_PRICE_ID. What the plan includes (decided with the owner 2026-10-10):
// no project limit, store work without credits (generation, chat/editor/Qgent edits,
// image actions, insights, preview deploys) and Qads included — each behind the daily
// fair-use caps below, which protect the real API cost behind "unlimited".
export const AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID ?? ''
export const AGENCY_MONTHLY_USD = 699

// ─── Hosting subscription (kept here so client components can import
//     without dragging in the server-only Stripe SDK from lib/stripe) ─────────
export const HOSTING_ANNUAL_USD = 99
export const HOSTING_MONTHLY_USD = 9.99

// Toggle to true to activate a 7-day trial on new Agency checkouts.
export const AGENCY_TRIAL_DAYS = process.env.AGENCY_TRIAL_DAYS === 'true' ? 7 : 0

// ─── Project limits ───────────────────────────────────────────────────────────
// Agency has no limit on projects (lib/tier.ts activeProjectLimit). The users.project_limit
// value stored for Agency rows is only the batch size: how many stores one bulk export takes.
export const AGENCY_BATCH_SIZE = 20
// Stores of one batch generated at the same time (lib/generation/batch.ts) — keeps the Claude
// API rate limit and the Vercel build queue in check; the rest of the batch waits its turn.
export const AGENCY_BATCH_CONCURRENCY = 5
export const AGENCY_PROJECT_LIMIT = AGENCY_BATCH_SIZE
export const FREE_PROJECT_LIMIT = 3   // applies to both 'free' and 'credit' tiers

// ─── Agency fair use (per user, rolling 24 h / 1 h) ───────────────────────────
export const AGENCY_FAIR_USE = {
  generationsPerDay: 50,
  generationsPerHour: 30,   // above one full batch, so a batch never locks out single generations
  qadsVideosPerDay: 20,
  qadsPhotosPerDay: 100,
} as const

// ─── Agency AI rate limits ────────────────────────────────────────────────────
// Per-minute cap on Claude calls for agency users (abuse guard; not credit-based).
export const AGENCY_RATE_LIMIT_PER_MIN = 10
// Max tokens per request for agency users.
export const AGENCY_TOKEN_CAP = 64_000

// ─── Credit costs ─────────────────────────────────────────────────────────────
//
//   export = 5 (owner, 2026-10-28)
//     Downloading a store's code costs CREDIT_COSTS.export credits ONCE per
//     store: /api/export charges only when the project has no earlier export,
//     so re-downloading after more edits is free. Agency exports are included.
//     The admin-panel export (export_admin) already includes the code.
//
// One flag value is 0 on purpose (audit round: pricing consistency):
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
// Both must be enforced server-side, in the corresponding route
// handlers; the marketing site only *displays* what these say.
export const CREDIT_COSTS = {
  generate:         10,
  iterate:           1,
  section:           2,
  custom_component:  3,
  export:            5,  // once per store — see comment above
  export_admin:     10,
  deploy:            0,  // hosting-gated in /api/deploy — see comment above
  preview_deploy:    2,  // preview deploy (unique URL, no subdomain) — kept
  fix:               0,  // fixes repair a paid generation — always free
  vision:            1,
  qgent_review:      2,  // Qgent goes through the whole store (Studio → Qgent)
  qgent_apply:       1,  // one confirmed Qgent change; undo is free
  qads_plan:         3,  // Qads Plan: personas, competitor research, ad concepts, calendar
  welcome_grant:    12,
} as const

// ─── Qscan ────────────────────────────────────────────────────────────────────
// Scanning a store costs no credits (building the new store is a normal generation, charged
// CREDIT_COSTS.generate). Scans copy images into our public bucket, so they are capped per day.
export const QSCAN_DAILY_SCANS = 5
export const QSCAN_DAILY_SCANS_AGENCY = 30

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
