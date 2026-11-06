// Qbox limits and prices — plain constants, no Node imports, so the /qbox page (client) can show
// them too. lib/qbox/model.ts re-exports everything here; rules live there.

/** Defaults for one beta member (a `qbox_beta` row may override concurrency and minutes). */
export const QBOX_BETA = {
  /** Sandboxes running at once per member. */
  maxConcurrent: 2,
  /** Sandbox-minutes per calendar month (UTC) per member, counted by wall-clock lifetime. */
  monthlyMinutes: 600,
  /** Default and maximum lifetime of one sandbox. */
  defaultTimeoutMs: 5 * 60_000,
  maxTimeoutMs: 30 * 60_000,
  minTimeoutMs: 60_000,
  /** One command may run at most this long (the API call waits for it). */
  maxCommandMs: 4 * 60_000,
  /** vCPUs per sandbox (Vercel Sandbox minimum is 1, memory follows the vCPUs). */
  vcpus: 2,
  /** Biggest file one request may write or read. */
  maxFileBytes: 5 * 1024 * 1024,
  /** stdout / stderr returned per command (the rest is cut, flagged `truncated`). */
  maxOutputChars: 200_000,
  /** Ports one sandbox may expose as a public preview URL. */
  maxPorts: 2,
  /** API keys per member. */
  maxKeys: 5,
} as const

/**
 * The open paid tier (QBOX_ACCESS=open, owner 2026-11-05: "only paid"): any signed-in account,
 * pays from a prepaid balance of vCPU-minutes (qbox_topups) filled with Quante credits or, when
 * switched on, by the agent itself over x402. Usage is billed by wall-clock lifetime × vCPUs.
 */
export const QBOX_PAID = {
  maxConcurrent: 5,
  maxTimeoutMs: 60 * 60_000,
  vcpus: 2,
  maxPorts: 2,
} as const

/** vCPU sizes a paid sandbox may ask for (memory follows: 2 GB per vCPU). */
export const QBOX_PAID_VCPUS = [1, 2, 4] as const

/**
 * Prices (tunable; the website and the 402 offer read them from here). Vercel's cost is about
 * $0.17 per vCPU-hour with the CPU at 100 % (2026-09 price list), far less for a typical agent.
 *   1 credit = 60 vCPU-minutes   (a 2-vCPU sandbox ≈ 2 credits an hour)
 *   1 USD    = 300 vCPU-minutes  (a 2-vCPU sandbox ≈ $0.40 an hour) — direct agent payments
 */
export const QBOX_PRICING = {
  vcpuMinutesPerCredit: 60,
  vcpuMinutesPerUsd: 300,
  /** Smallest / largest agent payment over x402, in USD (whole dollars). */
  minUsd: 1,
  maxUsd: 100,
  /** Every command, file read and file write also costs this (owner: no agent move is free). */
  opVcpuMinutes: 0.1,
  /** A billed sandbox costs at least this many minutes, however soon it stops. */
  minBilledMinutes: 1,
} as const

/** Whole-service guards (env-tunable): sandboxes at once, and vCPU-minutes reserved per UTC day. */
export const QBOX_GLOBAL = {
  concurrent: 20,
  dailyVcpuMinutes: 2000,
} as const

/** `internet: "registries"`: package registries only (HTTPS, matched by SNI in the engine's firewall). */
export const QBOX_REGISTRY_DOMAINS = [
  'registry.npmjs.org', '*.npmjs.org', 'registry.yarnpkg.com', 'nodejs.org',
  'pypi.org', 'files.pythonhosted.org',
  'github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com',
] as const

/** Templates a beta sandbox can start from (Vercel Sandbox runtimes). */
export const QBOX_TEMPLATES = ['node24', 'node22', 'python3.13'] as const
export type QboxTemplate = (typeof QBOX_TEMPLATES)[number]


/**
 * Qbox services — agents sell to agents (2026-11-06, owner: "agents buy and sell among themselves").
 * The buyer pays the seller's own wallet over x402 (we never hold their USDC); our fees come out of
 * the seller's prepaid Qbox balance. Proposed by us, accepted by the owner; tune here only.
 */
export const QBOX_EARN = {
  /** Our fee per paid call, as a share of the call's price, booked from the seller's balance. */
  feePercent: 5,
  /** …but never less than this per paid call. */
  minFeeVcpuMinutes: 0.1,
  /** Publishing a service, once (also keeps the directory free of spam). */
  publishFeeUsd: 1,
  /** Price range of one call, in USD (USDC has 6 decimals). */
  minPriceUsd: 0.001,
  maxPriceUsd: 100,
  /** Services one account may have listed (live or paused). */
  maxServicesPerAccount: 20,
  /** Request / response bodies through the gateway, and how long the seller may take. */
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 5 * 1024 * 1024,
  upstreamTimeoutMs: 60_000,
  /** A signed wallet challenge is valid this long. */
  walletChallengeMs: 15 * 60_000,
} as const
