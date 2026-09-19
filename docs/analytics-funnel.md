# Analytics funnel — proposal

Author: audit round P4 · Status: proposal, no code shipped yet · Decision required: Michal

---

## 1. What exists today

**Vercel Speed Insights** is wired at the root layout ([app/layout.tsx:4,95](../app/layout.tsx)) and reports Core Web Vitals from the browser. No product analytics, no event tracking, no funnel. Grep confirms zero references to PostHog, Plausible, Mixpanel, gtag, Amplitude, Umami, `window.dataLayer` or `analytics.track` anywhere in the app tree.

**Cookie consent** is not implemented on the marketing site. A `CookieConsent.tsx` component exists at `components/storefront/CookieConsent.tsx`, but it lives in the generated storefront template — it ships with the customer's exported store, not with quantecode.com itself. The `store-health` API endpoint even lists `hasCookieConsent` as a health check on generated stores, meaning we impose the standard we don't hold ourselves to. This is a legal gap the audit doesn't own but analytics implementation will trip over.

**Speed Insights** is a first-party Vercel product that doesn't set client cookies and is exempt from consent under most EU DPA reads. It stays as-is either way.

## 2. The funnel

Six stages, each with the exact code location where the state transition happens today. Every event fires server-side wherever the state change is already server-side (checkout webhook, deploy status, generation complete, ledger insert) so tracking survives ad-blockers, private modes and iOS Content Blockers — the browser only fires supplementary page-view and CTA-click events.

| # | Stage | Event | Trigger location | Notes |
|---|---|---|---|---|
| 1 | Visit landing | `visit_home` | Client: root layout mount on any `/` route | Only fires post-consent. Path property distinguishes /, /pricing, /showcase, /qads, /about. |
| 2 | Signup | `signup_completed` | Server: [app/auth/callback/route.ts:20-28](../app/auth/callback/route.ts) — the same `count === 0` idempotency check that grants the welcome bundle. If the count is zero, this is genuinely a first sign-up. | Fires exactly once per user. |
| 3 | First generation | `generation_completed` (first time) | Server: [app/api/quante/generate/route.ts:320](../app/api/quante/generate/route.ts) — the `credit_ledger.insert({ reason: 'generate' })` call. Check `count` on prior `reason='generate'` rows; if 0, this is the first. | Also fire `generation_started` on POST arrival for drop-off analysis (started but never completed). |
| 4 | First activation | `deploy_succeeded` or `export_downloaded` (whichever comes first) | Server: [app/api/deploy/route.ts:GET status handler](../app/api/deploy/route.ts) `if (domain)` block (production deploy ready) and [app/api/export/route.ts:186](../app/api/export/route.ts) success response. | "Activation" = user got a real store out of Quante. Either path counts. |
| 5 | First credit purchase | `credit_pack_purchased` | Server: [app/api/stripe/webhook/route.ts:108-116](../app/api/stripe/webhook/route.ts) `credit_ledger.insert({ reason: 'purchase' })` in the `checkout.session.completed` handler. | Idempotent — the `purchases` row check on line 73-79 already prevents double-fire. |
| 6 | Hosting subscription | `hosting_subscribed` | Server: [app/api/stripe/webhook/route.ts:126-127](../app/api/stripe/webhook/route.ts) `customer.subscription.created` handler when `meta.type === 'hosting'`. | Also emit `hosting_cancelled` on `.deleted` and `hosting_trial_started` from `/api/deploy/status` when `hosting_trial_ends_at` transitions from null. |

**Everything past 6 is retention, not funnel.** Second purchase, second store, etc. are worth tracking but sit in a separate cohort view, not this ingest.

## 3. Event catalog

Events use `snake_case`, present tense, subject_verb naming. Every event carries the base properties automatically (via the tracking helper — see §5); the "extra" column lists event-specific ones.

### Marketing-side (client)

| Event | Extra properties | Where it fires |
|---|---|---|
| `visit_home` | `path` (/, /pricing, /showcase, /qads, /about, /domains, /changelog, /contact), `referrer`, `utm_*` | Root layout page-view effect after consent. |
| `cta_clicked` | `cta_id` (`hero_try_free`, `hero_see_showcase`, `pricing_get_started_starter`/`_builder`/`_studio`, `about_start`, `nav_try_free`, `nav_log_in`), `path` | onClick handler on the CTA. |
| `pricing_pack_viewed` | `pack_id` (`starter`/`builder`/`studio`) | IntersectionObserver on each pack card in [PricingClient.tsx](../app/pricing/PricingClient.tsx). |
| `showcase_store_opened` | `store_name` (`axiom`/`mamut`), `via` (`iframe_scroll`/`open_full_screen`) | Iframe intersection + anchor click on [ShowcaseClient.tsx](../app/showcase/ShowcaseClient.tsx). |
| `qads_cta_clicked` | — | onClick on "See how Qads works". |

### Product-side (server)

| Event | Extra properties | Where it fires |
|---|---|---|
| `signup_completed` | `plan` (currently always `credit`), `welcome_grant` (25), `source` (Clerk sign-in method from Supabase auth metadata if available) | [app/auth/callback/route.ts:20](../app/auth/callback/route.ts) inside `if (!count)`. |
| `generation_started` | `project_id`, `brief_length`, `is_first` (from ledger count of prior `generate` reason rows) | [app/api/quante/generate/route.ts POST top](../app/api/quante/generate/route.ts) right after auth passes. |
| `generation_completed` | `project_id`, `code_version_id`, `duration_ms`, `is_first`, `credits_spent` (10) | Same route, after `credit_ledger.insert({ reason: 'generate' })` at [line 320](../app/api/quante/generate/route.ts). |
| `generation_failed` | `project_id`, `phase`, `error_class` | Same route, catch/refund path. |
| `deploy_started` | `project_id`, `deploy_type` (`production`/`preview`), `is_first` | [app/api/deploy/route.ts POST](../app/api/deploy/route.ts) right after subscription gate passes. |
| `deploy_succeeded` | `project_id`, `deployment_id`, `domain`, `is_first`, `hosting_state` (`trial_started`/`trial_active`/`subscription_active`) | [/api/deploy GET status handler](../app/api/deploy/route.ts) when `vercelStatus.state === 'ready'` and `domain` is set. |
| `deploy_failed` | `project_id`, `deployment_id`, `error_class` | Same handler, `error`/`canceled` branch. |
| `export_downloaded` | `project_id`, `include_admin`, `size_bytes`, `is_first` | [app/api/export/route.ts](../app/api/export/route.ts) right before the ZIP stream response — capture the `zipBuffer.byteLength`. |
| `credit_pack_purchased` | `pack_id`, `credits`, `amount_cents`, `is_first` (via `purchases` row count) | [app/api/stripe/webhook/route.ts:108](../app/api/stripe/webhook/route.ts) after successful ledger insert. |
| `hosting_trial_started` | `project_id`, `trial_ends_at` | [/api/deploy GET status](../app/api/deploy/route.ts) when `hosting_trial_ends_at` transitions from null in the `.update(...).is('hosting_trial_ends_at', null)` idempotent branch. |
| `hosting_subscribed` | `interval` (`month`/`year`), `amount_usd`, `stripe_subscription_id` | [app/api/stripe/webhook/route.ts:126](../app/api/stripe/webhook/route.ts) when `meta.type === 'hosting'` and event type is `created` or `updated` with prior `status !== 'active'`. |
| `hosting_cancelled` | `stripe_subscription_id`, `reason` (`user`/`payment_failed`) | Same handler on `.deleted`. |
| `agency_subscribed` | `stripe_subscription_id` | Same handler when `meta.type === 'agency'`. |

### Base properties (auto-attached to every event)

- `user_id` — Clerk user id when authenticated, `null` on marketing side pre-signup.
- `anon_id` — first-party cookie generated on first visit. Used to stitch pre- and post-signup activity (identify call on signup).
- `session_id` — 30-minute rolling session, cleared on tab close.
- `env` — `production`/`preview`/`development`.
- `release` — `process.env.VERCEL_GIT_COMMIT_SHA` (short).
- `path` — current pathname (client) or route name (server).
- `utm_*`, `referrer`, `landing_path` — captured on first visit, persisted in a first-party cookie for the whole session, attached to every event.

## 4. Consent

Since there is no cookie consent banner on the marketing site today, three routes forward:

**A. Cookieless mode (Plausible, PostHog with `capture_pageview: false` + no cookies).** No consent banner required in most EU DPAs; identifiers derived from hashed IP + user agent, rolling daily. Trade-off: no cross-session stitching without a server-side identify. Recommended if we want to ship analytics quickly without a legal review.

**B. Consent-first (banner blocks everything until accepted).** Ship a consent banner (`components/CookieConsent.tsx` at the site root, similar to the storefront one but for our own site). Analytics stay dark for un-consented users; you lose ~40-60% of visitors from the funnel. Recommended if Michal wants full attribution and is willing to add the banner.

**C. Legitimate-interest split (server-side events fire always, client-side events only post-consent).** Server-side product events (`generation_completed`, `deploy_succeeded`, `credit_pack_purchased`, `hosting_subscribed`) are logged users, own-service processing — clearly legitimate under GDPR Art. 6(1)(f). Marketing-side client events (`visit_home`, `cta_clicked`, `pricing_pack_viewed`) need consent. Recommended default.

Route C is what I'd build. It gives us the money-side of the funnel (signup → deploy → purchase → subscription) with zero consent dependency, and only the top-of-funnel awareness metrics wait behind the banner.

## 5. Provider recommendation

| Provider | Cost | Custom events | Funnel UI | GDPR-friendly | Verdict |
|---|---|---|---|---|---|
| Vercel Web Analytics | Bundled on Pro; ~$10 add-on to bill on Hobby | Basic only (`track()`) | No | Yes (no cookies, EU-hosted) | Fine for pageviews, weak for the funnel we want. |
| Plausible | €9/mo (cloud) or self-host free | Yes | Yes (goals) | Yes by design | Great fit if you want minimal + cheap. Funnel UI is decent but no session replay or cohorts. |
| PostHog | Free ≤1M events/mo, then usage | Yes | Yes (built-in funnel + retention + cohorts) | Yes (self-host EU-region cloud) | Best product analytics for the money. Session replay + feature flags come along for the ride. |

**Recommendation: PostHog** (EU cloud region) as the funnel + product analytics store; keep **Vercel Speed Insights** for Web Vitals. The `posthog-js` browser client fires client-side events post-consent; the `posthog-node` SDK fires server-side events from the API routes with zero consent dependency. `posthog.identify(userId, { plan, welcome_grant, ... })` at the signup callback stitches pre-signup anonymous activity to the authenticated user id.

Estimated volume for the first 6-12 months: well under PostHog's 1M-events free tier. Cheapest path stays free until we cross that mark.

## 6. Tracking helper (sketch)

Not code — but the interface every event site should use, so nothing calls the analytics SDK directly:

```ts
// lib/track.ts — thin wrapper, one SDK swap-in point.
import { PostHog } from 'posthog-node'
import { CookieConsent } from '@/lib/consent' // marketing-side gate

let posthog: PostHog | null = null
function getServerClient() { /* lazy init with POSTHOG_API_KEY */ }

export interface BaseProps {
  userId: string | null
  path: string
  release?: string
  utm?: Record<string, string>
}

// Server: fires always, never gated on consent (legitimate interest).
export async function trackServer(event: string, props: BaseProps & Record<string, unknown>) { ... }

// Client: fires only if the marketing-consent cookie is set to 'accepted'.
export function trackClient(event: string, props: Record<string, unknown>) { ... }

// Identify at signup, or when a user logs back in on a new device.
export async function identifyUser(userId: string, traits: Record<string, unknown>) { ... }
```

Every call site imports one of these three functions, never `posthog` directly. Swapping to Plausible or Vercel Analytics later is one file's worth of work.

## 7. Consent implementation (if we go with route C)

A `lib/consent.ts` module + a `components/PublicCookieConsent.tsx` banner rendered by `PublicNav`. State stored in a first-party cookie `quante_consent=accepted|declined`, 12-month expiry. `trackClient()` reads the cookie synchronously before every call; if not `accepted`, the call is a no-op. Existing `AnnouncementBanner` gives a visual precedent for a sticky top-of-page strip; the consent banner sits at the bottom-right corner so the two don't compete.

**Note:** legal wording on the banner needs the Privacy Policy already to describe our subprocessors and cookie categories — it currently doesn't mention analytics because we don't have any. Add PostHog to `/privacy` § subprocessors when implementing.

## 8. Phased rollout

Nothing here is a green-light; brief 4 says "propose only, no code". Rough sequencing when the green light comes:

1. **P4.1 Provider + helper (1 day).** Wire PostHog, write `lib/track.ts`, no call sites yet. Verify env vars + test event from a scratch page.
2. **P4.2 Server-side events (1-2 days).** Instrument the 8 server-side events in §3. This is the money side of the funnel and doesn't need consent. Deliverable: PostHog funnel visualisation for `signup_completed → generation_completed → deploy_succeeded → credit_pack_purchased → hosting_subscribed`.
3. **P4.3 Consent banner (0.5 day).** Ship the marketing-site cookie banner, update `/privacy` subprocessors list.
4. **P4.4 Client-side events (1 day).** Wire the 5 client events in §3 guarded by consent. Deliverable: full funnel including top-of-funnel awareness.
5. **P4.5 Attribution (0.5 day).** UTM capture on first visit, persist in cookie, attach to every subsequent event. Landing-path attribution.

Total: about 5 focused days if I ship this, one PR per numbered step.

## 9. Non-goals for this phase

Explicitly out of scope, listed here so future-me doesn't scope-creep into them without noticing:

- **Session replay.** PostHog includes it, but replay recordings need heavier consent and store storefront-user-side sessions that don't belong to Quante's data model.
- **Feature flags.** PostHog has them; using them would require a bigger P4 conversation about split-traffic rollouts.
- **Reverse-ETL** from analytics back into user rows. Not needed for funnel work.
- **A/B testing.** Same as above.

If any of these become worth building, they're their own project.
