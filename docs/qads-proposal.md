# Qads — proposal (Phase 1, awaiting approval)

> Status: **DESIGN ONLY — nothing in this document has been implemented.** Per the
> project's standing rule this is a proposal for approval before any code, migration,
> or file is written. Confirmed via full repo audit (git log --all, filename/content
> grep across app/, components/, lib/, types/, supabase/, docs/, QuanteCode/) that
> neither Qads nor a "Qmails" module exists anywhere in this repository — this is a
> from-scratch design, not a continuation.

## 0. What this pulls from the existing codebase

Per the brief's "hold existing conventions" instruction, every structural choice below
is copied from a real, already-shipped pattern in this repo rather than invented:

| Qads piece | Copied from |
|---|---|
| Provider-agnostic interface + slug registry | `lib/fulfillment/types.ts` + `registry.ts` (`FulfillmentProvider`) |
| Encrypted external credentials at rest | `lib/crypto.ts` (AES-256-GCM, `enc:v1:` prefix, already used for `project_secrets`) |
| OAuth-style "connect an external account" flow | `app/api/stripe/connect/{onboard,status,refresh,return}` (Stripe Express onboarding) |
| Idempotent external-side-effect writes | `lib/fulfillment/auto-ship.ts` (`attemptAutoCreateShipment` — insert-first, unique constraint is the real guard, `23505` = duplicate is a success outcome) |
| Append-only money-adjacent ledger | `credit_ledger` / `partner_commission_ledger` / `marketplace_seller_ledger` (delta + balance_after + reason + ref_id, `UNIQUE(entity, ref_id)`) |
| Durable, resumable, poll-based job state (not a single long request) | `generation_jobs` (Level 3 background-job architecture — see `docs/update-log.md`) |
| Migration file convention | flat `supabase/migration-<feature>.sql`, RLS via `(auth.jwt() ->> 'sub') = user_id`, `DO $$ ... IF NOT EXISTS ...` policy guards, `update_updated_at()` trigger reuse |
| Credit debit/refund | `CREDIT_COSTS` in `lib/config.ts`, atomic debit pattern from `migration-atomic-credits.sql` + `/api/quante/iterate` |

**One deliberate deviation from the brief's literal wording:** the brief describes
streaming pipeline progress "the same way Quante streams logs from store generation."
That's true of the *original* `/api/quante/generate` SSE stream, but this codebase has
since moved *away* from that for exactly this kind of workload — see `generation_jobs`
and the Level 1→3 fix in `docs/update-log.md` (a live SSE connection dies if the
client's tab closes or the phone locks mid-generation, silently losing all progress).
An ad campaign pipeline is a worse case for a live stream than store generation ever
was: 10+ steps, some (video generation via Higgsfield) plausibly taking minutes, and
the whole point of Qads is a merchant kicks it off and comes back later. So Qads
pipeline progress is modeled as **durable job-graph rows the client polls**, matching
the more recent and more robust of the two existing patterns, not the older stream.
Flagging this explicitly since it's a divergence from the literal spec text.

---

## 1. Module structure & file list

```
app/api/qads/
  campaigns/route.ts                    POST — brief + estimate + kick off generation
  campaigns/[id]/route.ts               GET  — status, structure, assets, metrics
  campaigns/[id]/regenerate/route.ts    POST — regenerate one pipeline node
  campaigns/[id]/deploy/route.ts        POST — build+validate+save PAUSED deploy payloads (dry-run unless QADS_LIVE_DEPLOY)
  campaigns/[id]/activate/route.ts      POST — flip channel campaign(s) to ACTIVE (requires live deploy to have happened)
  campaigns/[id]/pause/route.ts         POST — pause channel campaign(s)
  campaigns/[id]/export/route.ts        GET  — ZIP + CSV fallback
  ad-sets/[id]/budget/route.ts          PATCH — budget/schedule change (audit-logged)
  ad-accounts/route.ts                  GET/POST — list / begin-connect
  ad-accounts/[id]/route.ts             DELETE — revoke/disconnect
  ad-accounts/[id]/status/route.ts      GET — connection + permission status
  ad-accounts/meta/callback/route.ts    GET — OAuth callback (Meta)
  ad-accounts/tiktok/callback/route.ts  GET — OAuth callback (TikTok)
  experiments/route.ts                  POST/GET
  experiments/[id]/route.ts             GET — results, confidence
  kill-switch/route.ts                  POST — pause every running campaign for a store
  cron/sync-metrics/route.ts            scheduled — insights pull, all channels
app/api/webhooks/higgsfield/route.ts    signature-verified, idempotent by request_id

lib/qads/
  types.ts                 ShopAdBrandContext, CampaignGoal, Angle, AdSetPlan, AdPlan, etc.
  pipeline/
    graph.ts               node graph definition + dependency edges
    runner.ts               executes/resumes a job graph, degrades partial failure
    nodes/*.ts              one file per node (strategy, angles, adsets, copy, image-prompts,
                             images, video, assembly, validation, deploy, metrics-sync)
  claude/
    prompts.ts              system prompts for strategy/angles/copy/test-interpretation
    brand-context.ts        derive palette/tone/voice from an existing store (reuses
                             project data — see §3.1, no new brand-brief prompt to the user)
  media/
    types.ts                MediaProvider interface + shared request/result shapes
    registry.ts             slug -> factory (mirrors lib/fulfillment/registry.ts)
    providers/higgsfield/
      client.ts             HTTP client — auth, submit, poll, cancel
      mapper.ts              Qads creative-brief -> Higgsfield request payload
      index.ts               factory
  channels/
    types.ts                 AdChannel interface + domain types (campaign/ad set/ad)
    registry.ts               slug -> factory (mirrors lib/fulfillment/registry.ts)
    providers/meta/
      client.ts               Graph API client (campaigns, adsets, ads, adcreatives, insights)
      oauth.ts                 Facebook Login for Business token exchange/refresh
      mapper.ts                 Qads domain objects -> Meta object payloads
      index.ts
    providers/tiktok/
      client.ts                 Business API client
      oauth.ts
      mapper.ts
      index.ts
  budget/
    guardrails.ts            hard caps, unusual-spend detection
    audit.ts                 qads_audit_log writer
  credits.ts                 estimate/reserve/settle/refund (mirrors lib/credits.ts pattern)
  experiments.ts             variant assignment, significance check (no premature winners)

types/qads.ts                 shared TS types re-exported for the client (Zod-inferred)

components/qads/
  AdAccountsPanel.tsx          connect/disconnect Meta+TikTok, permission warnings
  CampaignWizard.tsx            single-screen intake: goal, channels, length, budget, products
  PipelineProgress.tsx          live node graph + asset previews (polls campaign status)
  CampaignTree.tsx               campaign -> ad set -> ad, approve/reject/regenerate
  DeploySummary.tsx               pre-send approval screen (spend, audiences, what gets created)
  Dashboard.tsx                   performance by angle/format/audience/channel + kill switch
  ExperimentsPanel.tsx             running tests, interim results, apply-winner (post-approval)

app/(app)/project/[id]/qads/page.tsx   entry point from the Studio (new nav item)

supabase/migration-qads.sql            all 9 tables in one file, per existing convention
docs/qads-*.md                          any follow-up design notes, same pattern as this file
```

This is intentionally a **peer of `lib/fulfillment/`**, not something bolted onto
`StudioClient.tsx` — Qads reads a project's data (products, brand, photos) but doesn't
change how the Studio/Builder works, same separation `lib/fulfillment` has from the
checkout flow.

---

## 2. Database schema

All tables follow the repo's existing RLS convention exactly:
`(auth.jwt() ->> 'sub') = user_id`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
`DO $$ ... IF NOT EXISTS ...` policy guards so the file is safely re-runnable, and the
shared `update_updated_at()` trigger. One file: `supabase/migration-qads.sql`. **File
only — not run against production from this session**, per project safety rules.

```sql
-- Per (user, store, channel) connection to an external ad account.
CREATE TABLE qads_ad_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  external_account_id text NOT NULL,          -- Meta ad_account_id / TikTok advertiser_id
  business_id        text,                     -- Meta Business Manager id / TikTok Business Center id
  page_id            text,                     -- Meta Page (required for most placements)
  pixel_id           text,                     -- Meta Pixel / TikTok Pixel
  catalog_id         text,                     -- Meta product catalog, if connected
  access_token_enc   text NOT NULL,             -- lib/crypto.ts encryptSecret()
  refresh_token_enc  text,                      -- TikTok issues one; Meta long-lived tokens don't
  token_expires_at   timestamptz,
  scopes             text[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected', 'needs_reauth', 'revoked', 'error')),
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, channel)
);

-- One campaign brief + generated strategy. external_id/state are set once a deploy
-- actually creates the channel-side object — a campaign can have MULTIPLE external
-- campaigns if it spans channels (see qads_campaign_channel_links below), so external_id
-- here is deliberately absent from this table; see §2.1 for why.
CREATE TABLE qads_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               text NOT NULL,
  goal               text NOT NULL CHECK (goal IN ('launch', 'sale', 'black_friday', 'awareness', 'custom')),
  channels           text[] NOT NULL,           -- subset of {'meta','tiktok'}
  budget_minor       integer NOT NULL,           -- total campaign budget, minor units
  currency           text NOT NULL DEFAULT 'usd',
  duration_days      integer NOT NULL,
  product_ids        text[] NOT NULL DEFAULT '{}', -- store_inventory.product_id values in scope
  brief              text NOT NULL,               -- raw user input (goal description, not a brand brief)
  brand_context      jsonb,                        -- derived palette/tone/voice snapshot (see §3.1)
  strategy           jsonb,                        -- positioning + summary once generated
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'generating', 'ready_for_review',
                                         'deploying', 'deployed_paused', 'active',
                                         'paused', 'completed', 'failed')),
  pipeline_state     jsonb NOT NULL DEFAULT '{}',  -- node graph status snapshot, see §4
  credits_reserved   integer NOT NULL DEFAULT 0,
  credits_spent      integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A campaign deploys to N channels; each channel gets its OWN external campaign object
-- (Meta and TikTok campaigns are entirely separate entities, never shared). This join
-- table is what actually carries external_id/state per channel, not qads_campaigns.
CREATE TABLE qads_campaign_channel_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  ad_account_id      uuid NOT NULL REFERENCES qads_ad_accounts(id),
  external_campaign_id text,                    -- set once deployed (real or dry-run-simulated id)
  external_status    text,                       -- PAUSED | ACTIVE | ... (channel-native string, not our enum)
  dry_run            boolean NOT NULL DEFAULT true,
  deployed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, channel)
);

-- Strategic angle — maps to one or more ad sets, never directly to a creative.
CREATE TABLE qads_angles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  label              text NOT NULL,
  hypothesis         text NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Field names deliberately mirror Meta's Ad Set object (audience/targeting, budget,
-- placements, schedule, bid strategy) so the channel mapper in
-- lib/qads/channels/providers/meta/mapper.ts is close to 1:1 — see §5.
CREATE TABLE qads_ad_sets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  angle_id           uuid NOT NULL REFERENCES qads_angles(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  name               text NOT NULL,
  audience           jsonb NOT NULL,             -- { ageMin, ageMax, genders[], geo[], interests[], lookalike?, customAudienceRef? }
  placements         text[] NOT NULL DEFAULT '{}', -- e.g. 'feed','stories','reels','tiktok_for_you'
  budget_minor       integer NOT NULL,
  budget_type        text NOT NULL DEFAULT 'daily' CHECK (budget_type IN ('daily', 'lifetime')),
  schedule_start     timestamptz,
  schedule_end       timestamptz,
  bid_strategy       text,                        -- channel-native string, validated per channel not by a fixed enum
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'ready', 'deployed_paused', 'active', 'paused')),
  external_id        text,
  external_status    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One ad = one creative + one text variant, in a format matching its ad set's placements.
CREATE TABLE qads_ads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_set_id          uuid NOT NULL REFERENCES qads_ad_sets(id) ON DELETE CASCADE,
  format             text NOT NULL CHECK (format IN ('1:1', '4:5', '9:16', '16:9')),
  texts              jsonb NOT NULL,              -- { headline, primaryText, description, cta } — channel char-limited variants
  creative_id        uuid REFERENCES qads_creatives(id),
  approval_status    text NOT NULL DEFAULT 'pending'
                       CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
  external_id        text,
  external_status    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One generated (or in-progress) media asset. Kept separate from qads_assets: this row
-- is the GENERATION record (provider, model, params, source product/photo, moderation
-- flag); qads_assets is the resulting STORED FILE. A creative can fail and be retried
-- without ever producing an asset row.
CREATE TABLE qads_creatives (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('static', 'video')),
  format             text NOT NULL CHECK (format IN ('1:1', '4:5', '9:16', '16:9')),
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'generating', 'completed', 'failed', 'flagged_for_review')),
  provider           text NOT NULL DEFAULT 'higgsfield',
  model              text,                         -- exact model id, per Higgsfield's per-model docs — see open question in §9
  provider_request_id text,                         -- Higgsfield request_id, for polling/webhook correlation
  input_params       jsonb NOT NULL,                -- prompt, source_photo_asset_id, product_id, strength, etc.
  source_product_id  text,                           -- store_inventory.product_id — the REAL product this must depict (§ "product fidelity")
  source_photo_asset_id uuid,                        -- references qads_assets — the reference photo used as image-to-image/video input
  asset_id           uuid REFERENCES qads_assets(id),
  consistency_flag   boolean NOT NULL DEFAULT false, -- true = flagged for human review (see §3.3)
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The actual file. Media is always copied into Supabase Storage — provider CDN URLs
-- expire (Higgsfield explicitly retains outputs "at least seven days" and no longer),
-- so a durable copy is mandatory, not optional caching.
CREATE TABLE qads_assets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storage_path       text NOT NULL,                -- Supabase Storage path, 'qads-assets' bucket
  mime_type          text NOT NULL,
  width              integer,
  height             integer,
  duration_seconds   numeric,
  bytes              integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Daily metric rows, one per (entity, day) — never overwritten in place, upserted by day
-- so history is preserved. 'level' + entity_id together identify the channel-side object;
-- entity_id is TEXT (external_id) not a FK, since insights are pulled per external object
-- and a metrics row can outlive the Qads-side row being deleted.
CREATE TABLE qads_metrics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  level              text NOT NULL CHECK (level IN ('campaign', 'ad_set', 'ad')),
  entity_id          text NOT NULL,                 -- external_id of the campaign/ad_set/ad
  channel            text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  day                date NOT NULL,
  impressions        bigint NOT NULL DEFAULT 0,
  clicks             bigint NOT NULL DEFAULT 0,
  spend_minor        integer NOT NULL DEFAULT 0,
  conversions        integer NOT NULL DEFAULT 0,
  conversion_value_minor integer NOT NULL DEFAULT 0,
  ctr                numeric,
  cpc_minor          integer,
  cpa_minor          integer,
  roas               numeric,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, entity_id, day)
);

CREATE TABLE qads_experiments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('creative', 'copy', 'audience')),
  variants           jsonb NOT NULL,                -- [{ id, refType, refId, trafficShare }]
  budget_split       jsonb NOT NULL,
  success_metric     text NOT NULL CHECK (success_metric IN ('ctr', 'cpa', 'roas', 'conversions')),
  status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'evaluating', 'concluded', 'inconclusive')),
  min_sample_note    text,                           -- e.g. "48 conversions so far — need ~120 for 95% confidence"
  result             jsonb,                           -- { winnerVariantId?, confidence, appliedAt? }
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every money-adjacent or state-changing action. Append-only, same shape as the other
-- audit-style ledgers in this repo.
CREATE TABLE qads_audit_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  campaign_id        uuid REFERENCES qads_campaigns(id) ON DELETE SET NULL,
  action             text NOT NULL,                  -- 'budget_change','activate','pause','kill_switch','deploy','experiment_apply'
  entity_type        text,
  entity_id          text,
  before_json        jsonb,
  after_json         jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

Indexes: `(store/project_id)` on `qads_campaigns` and `qads_ad_accounts`, `(campaign_id)`
on every child table, `(status)` on `qads_campaigns`/`qads_ad_sets`/`qads_ads`,
`(entity_id, day)` and `(campaign_id, day)` on `qads_metrics`. RLS on every table via
`(auth.jwt() ->> 'sub') = user_id`, either directly (tables with a `user_id` column) or
via a subquery through `qads_campaigns` (child tables) — identical shape to how
`partner_projects`/`marketplace_purchases` do it today.

### 2.1 Note on `qads_campaign_channel_links`

The brief's schema sketch put `external_id` directly on `qads_campaigns`. I split it
into a join table instead: a single Qads campaign can target both Meta and TikTok at
once (the brief's own "channels" field is an array), and Meta/TikTok campaigns are
unrelated external objects with independent ids and independent states (a merchant
might pause the Meta side and keep TikTok running). A single `external_id` column
can't represent that. Flagging this as a deliberate, small deviation from the literal
schema sketch — happy to collapse it back to a flat column if multi-channel-per-campaign
turns out not to matter in practice.

---

## 3. Pipeline & state model

### 3.1 Brand context — no brand brief from the user

`brand-context.ts` derives everything Qads needs from data Quante already has for the
project: `code_versions` (current site copy/structure), `store_inventory` (products,
prices, photos via `qads_assets`/existing product image URLs), `project_secrets`
(business info, market/language — see `migration-store-market.sql`), and the deployed
site's actual rendered palette/typography (same source `StudioClient.tsx` already reads
for the Store Health Score). This becomes a `brand_context` JSON snapshot stored on
`qads_campaigns` once per campaign (not re-derived per node) so every prompt in the
pipeline references the same frozen context — this is what "the campaign must look
like one campaign" (brief §"Brand konzistence") actually depends on.

### 3.2 Job graph

```
brand_context (done once, feeds everything below)
        │
        ▼
   strategy ──► angles ──► ad_sets ──► ad copy (texts)
                                   │
                                   └──► image prompts ──► images ──┐
                                                                     ├──► assembly ──► validation ──► (approval gate) ──► deploy ──► metrics sync (recurring)
                                   └──► video prompts ──► video ───┘
```

- Each node is a row (or an array of rows, for fan-out steps like "one image per
  ad × format") persisted the moment it starts — same durability principle as
  `generation_jobs`, not an in-memory pipeline that a serverless timeout can silently
  destroy. `qads_campaigns.pipeline_state` holds a compact status snapshot for fast
  reads; the authoritative detail lives in the actual `qads_angles`/`qads_ad_sets`/
  `qads_ads`/`qads_creatives` rows themselves (a node "completing" means the row it
  produces exists with `status = 'completed'`).
- Independent branches (image generation for ad A vs ad B; Meta prompts vs TikTok
  prompts once ad sets diverge per channel) run in parallel via `Promise.allSettled`,
  not sequential awaits — one slow/failed Higgsfield job never blocks a sibling.
- A failed leaf node (one creative) marks that `qads_creatives` row `failed` and
  surfaces it in the UI for a manual regenerate; it does not fail the campaign or block
  ads that don't depend on it — "selhání jednoho assetu nesmí shodit kampaň."
- `POST /api/qads/campaigns/[id]/regenerate` takes a node reference (`{ type: 'creative', id }`
  or `{ type: 'ad_set', id }` etc.) and re-runs only that node and its downstream
  dependents, reusing everything upstream (brand context, strategy, angle) — never a
  full pipeline restart.
- Long-running steps (image/video generation) are genuinely async against Higgsfield:
  submit → store `provider_request_id` → either wait for the `/api/webhooks/higgsfield`
  callback or get picked up by a polling fallback cron (mirrors the "webhooks with
  polling as fallback" requirement directly) → row transitions to `completed`/`failed`.

### 3.3 Product fidelity

Every `qads_creatives` row carries `source_product_id` + `source_photo_asset_id` and
uses image-to-image/image-to-video against that reference (never text-to-image from a
blank slate — see `lib/qads/media/providers/higgsfield/mapper.ts`, §5). A
`consistency_flag` column exists for a lightweight post-generation check (e.g. a CLIP-
similarity call, or in v1 simply "did the model's own moderation/quality signal come
back clean" — exact mechanism is an open question, §9) — flagged creatives surface in
the review UI instead of silently going out.

---

## 4. `MediaProvider` interface

Grounded directly in Higgsfield's actual documented request lifecycle (fetched from
`docs.higgsfield.ai` — not guessed): submission is async, returns a `request_id`
immediately, and resolves via polling or webhook to `completed`/`failed`/`nsfw`/
`canceled`. Output is `images[]`/`video`/`audio` depending on model.

```ts
// lib/qads/media/types.ts
export type MediaRequestStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'

export interface MediaGenerationInput {
  kind: 'image' | 'video'
  prompt: string
  format: '1:1' | '4:5' | '9:16' | '16:9'
  // Product-fidelity requirement (§3.3) — a reference image is mandatory, never optional,
  // for anything depicting a real product.
  referenceImageUrl: string
  strength?: number             // image-to-image/video influence, provider-specific range
  webhookUrl?: string
}

export interface MediaGenerationHandle {
  providerRequestId: string
  statusUrl: string
  cancelUrl?: string
}

export interface MediaGenerationResult {
  status: MediaRequestStatus
  assets?: { url: string; contentType: string }[]   // images[] or [video]/[audio], normalized to one shape
  error?: string
}

export interface MediaProvider {
  readonly slug: string
  submit(input: MediaGenerationInput): Promise<MediaGenerationHandle>
  getStatus(providerRequestId: string): Promise<MediaGenerationResult>
  cancel(providerRequestId: string): Promise<{ canceled: boolean }>
  // Called by the webhook route after signature verification — separated from getStatus
  // so a webhook delivery and a poll can share the exact same normalization path.
  parseWebhookPayload(body: unknown): { providerRequestId: string; result: MediaGenerationResult }
}
```

`lib/qads/media/registry.ts` mirrors `lib/fulfillment/registry.ts` exactly: a
`MediaProviderSlug` union (today just `'higgsfield'`), a factory map, and
`createMediaProvider(slug, credentials)`. Adding a second media provider later touches
only `providers/<slug>/` + one registry line — nothing in `pipeline/nodes/images.ts`
or `video.ts` changes.

---

## 5. `AdChannel` interface & Meta object mapping

```ts
// lib/qads/channels/types.ts
export interface AdChannelCampaignInput {
  name: string
  objective: string              // channel-native objective string — Meta: 'OUTCOME_SALES' etc.,
                                   // validated per channel, not coerced into one shared enum
  dailyBudgetMinor?: number
  lifetimeBudgetMinor?: number
  startTime?: string
  endTime?: string
}

export interface AdChannelAdSetInput {
  campaignExternalId: string
  name: string
  audience: {
    ageMin?: number; ageMax?: number; genders?: string[]
    geoCountries?: string[]; interests?: string[]
    lookalikeSourceRef?: string; customAudienceRef?: string
  }
  placements: string[]
  dailyBudgetMinor?: number
  lifetimeBudgetMinor?: number
  billingEvent?: string           // e.g. Meta 'IMPRESSIONS'
  bidStrategy?: string
  startTime?: string
  endTime?: string
}

export interface AdChannelCreativeInput {
  adAccountExternalId: string
  assetUrl: string                // qads_assets storage URL — uploaded to channel media library first
  assetType: 'image' | 'video'
  texts: { headline: string; primaryText: string; description?: string; cta: string }
  linkUrl: string                 // deployed store URL / product page
}

export interface AdChannelAdInput {
  adSetExternalId: string
  name: string
  creativeExternalId: string
  status: 'PAUSED'                 // literal type — nothing else is ever passed at creation
}

export interface AdChannelInsightsQuery {
  level: 'campaign' | 'ad_set' | 'ad'
  entityExternalId: string
  since: string; until: string     // ISO dates
}

export interface AdChannelInsightsRow {
  day: string
  impressions: number; clicks: number; spendMinor: number
  conversions?: number; conversionValueMinor?: number
}

export interface AdChannel {
  readonly slug: 'meta' | 'tiktok'

  getOAuthUrl(state: string): string
  exchangeOAuthCode(code: string): Promise<{
    accessToken: string; refreshToken?: string; expiresAt?: string
    externalAccountId: string; businessId?: string; scopes: string[]
  }>
  refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresAt?: string }>
  checkPermissions(accessToken: string, adAccountId: string): Promise<{ ok: boolean; missing: string[] }>

  // Every creation call takes an idempotencyKey — passed as a client-side dedup token
  // where the channel supports one, and ALWAYS additionally guarded DB-side by the
  // insert-first-unique-constraint pattern from lib/fulfillment/auto-ship.ts. Every
  // object is created PAUSED; nothing in an implementation is allowed to pass any other
  // initial status.
  createCampaign(creds: ChannelCredentials, input: AdChannelCampaignInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>
  createAdSet(creds: ChannelCredentials, input: AdChannelAdSetInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>
  uploadCreativeAsset(creds: ChannelCredentials, assetUrl: string, assetType: 'image' | 'video'): Promise<{ externalMediaId: string }>
  createAdCreative(creds: ChannelCredentials, input: AdChannelCreativeInput, externalMediaId: string): Promise<{ externalId: string }>
  createAd(creds: ChannelCredentials, input: AdChannelAdInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>

  setStatus(creds: ChannelCredentials, level: 'campaign' | 'ad_set' | 'ad', externalId: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>
  updateBudget(creds: ChannelCredentials, adSetExternalId: string, budgetMinor: number, budgetType: 'daily' | 'lifetime'): Promise<void>

  validateBeforeSend(input: AdChannelCampaignInput | AdChannelAdSetInput | AdChannelAdInput): Promise<{ ok: boolean; errors: string[] }>

  getInsights(creds: ChannelCredentials, query: AdChannelInsightsQuery): Promise<AdChannelInsightsRow[]>
}
```

Field naming (`objective`, `audience`/targeting shape, `placements`, `billingEvent`,
`bidStrategy`, campaign → ad set → ad hierarchy, ad = creative + targeting-inherited-
from-adset) mirrors Meta's Marketing API object model directly, per the brief's
instruction — TikTok's mapper (`providers/tiktok/mapper.ts`) translates the same
domain shape into TikTok's `campaign → ad_group → ad` terms (TikTok's "ad group" is
what this interface calls an ad set). **Exact field names, enum values, and endpoint
paths for both channels are marked as open questions in §9** — I did not invent Graph
API version numbers, exact objective enum strings, or TikTok's precise JSON body shape;
those get pinned down against the live API reference once app review/business
verification is far enough along to actually test against sandbox accounts, per the
brief's own stated assumption.

`lib/qads/channels/registry.ts` mirrors the fulfillment registry pattern; `meta` and
`tiktok` are the two `AdChannelSlug` values, each with its own `ChannelCredentials`
type in the same discriminated-union-by-slug shape `CredentialsFor<S>` already used in
`lib/fulfillment/registry.ts`.

### 5.1 Deploy flow (dry-run vs live)

```
buildDeployPayloads(campaignId)          // pure — no I/O to any channel
  → validateBeforeSend() per channel      // channel-native rule checks
  → save payloads to qads_campaign_channel_links.external_campaign_id = null,
    dry_run = true, + a full payload snapshot for the approval screen
  → IF NOT process.env.QADS_LIVE_DEPLOY:
        stop here — nothing sent anywhere, approval screen shows the exact
        payload that WOULD be sent
  → IF QADS_LIVE_DEPLOY:
        createCampaign → createAdSet(s) → uploadCreativeAsset(s) → createAdCreative(s)
        → createAd(s), each step idempotency-keyed and DB-checkpointed;
        any step failing after some succeeded triggers a rollback pass that
        pauses/deletes everything already created for this deploy attempt
        rather than leaving a half-built campaign live on the channel
```

This makes "flip to production is a config change, not a refactor" literally true —
`buildDeployPayloads` and `validateBeforeSend` run unconditionally either way; the
`QADS_LIVE_DEPLOY` check is the only branch in the entire path that decides whether the
channel client's create-methods are actually invoked.

---

## 6. Credits vs. ad spend

Mirrors `CREDIT_COSTS`/`lib/config.ts` exactly — new constants, same table:

```ts
export const QADS_CREDIT_COSTS = {
  strategy_generation: 3,
  static_creative: 1,      // per image
  video_creative: 5,       // per video (Higgsfield video is the expensive op)
  experiment_setup: 1,
} as const
```

- **Estimate → reserve → settle/refund**, same shape as generation credit debits:
  `POST /api/qads/campaigns` computes an estimate from the requested angle/ad-set/format
  count *before* starting, shows it for approval, reserves that many credits, and
  refunds per-asset on individual generation failures (never a blanket all-or-nothing
  refund — matches "vrácení za neúspěšné assety" literally).
- **Ad spend is never a credit-ledger entry.** `qads_ad_sets.budget_minor` and
  `qads_metrics.spend_minor` describe money moving on the merchant's own connected ad
  account, charged by Meta/TikTok directly to the merchant's payment method on file
  with *them* — Quante's credit ledger and Stripe billing never touch it. This
  separation is enforced structurally (spend fields only exist on ad-set/metrics
  tables, never on `credit_ledger`), not just by convention, so it can't leak into the
  wrong ledger later by accident.

---

## 7. Guardrails

- Hard caps: `QADS_MAX_DAILY_SPEND_PER_USER_MINOR` / `QADS_MAX_DAILY_SPEND_PER_CAMPAIGN_MINOR`
  env-configured, checked in `budget/guardrails.ts` before any budget create/update call
  reaches a channel — a request exceeding the cap is rejected before it's even built
  into a payload.
- Kill switch: `POST /api/qads/kill-switch` (store-scoped) sets every
  `qads_campaign_channel_links` row for that store to `setStatus(..., 'PAUSED')` and
  writes one `qads_audit_log` row per campaign paused. One button, one call, no
  per-campaign confirmation needed (that's the point of a kill switch).
- Unusual-spend detection: the metrics-sync cron compares each day's `spend_minor`
  against a trailing 7-day average per ad set; a jump past a configurable threshold
  writes a flag the dashboard surfaces (not an automatic pause — brief doesn't ask for
  auto-pause on spend anomalies, only a warning).
- Every budget change, activate/pause, kill-switch trigger, and experiment-winner
  application writes a `qads_audit_log` row with before/after JSON — no exceptions.

---

## 8. A/B testing

- `qads_experiments.variants` references existing `qads_creatives`/`qads_ads`/
  `qads_ad_sets` rows (by `refType`/`refId`) rather than duplicating content — a
  variant IS an already-generated asset or ad-set config, just flagged as part of a
  test with a traffic share.
- Significance check (`lib/qads/experiments.ts`) uses a standard two-proportion z-test
  (or Bayesian equivalent — open question, §9, pending a decision on which reads better
  for a non-technical merchant) against the chosen `success_metric`, and **refuses to
  conclude** below a minimum-sample floor — surfaces `min_sample_note` like "48
  conversions so far, ~120 needed for 95% confidence" instead of a fake verdict, exactly
  per the brief's "nevyhlašuj vítěze z padesáti impresí."
  regardless of the underlying stats: no auto-conclusion is allowed to fire the
  reallocate-budget path, `POST /api/qads/experiments/[id]/apply-winner` requires an
  explicit call after the user reads the recommendation.
- Concluded-experiment findings (winning angle/format/audience trait) are appended to
  `brand_context`'s working notes for that store, so the NEXT campaign's strategy
  generation prompt includes "past experiments showed X" — this is the "zjištění z
  ukončených testů vracej zpět do promptů" loop, implemented as one extra field read at
  strategy-generation time rather than a separate learning system.

---

## 9. Open questions / things I will NOT guess

- **Exact Higgsfield model(s) to use** for product-photo-to-static-creative and
  product-photo-to-video. The shared docs (auth/lifecycle/webhooks) are fetched and
  reflected above; model-specific request schemas live behind
  `console.higgsfield.ai` model pages I don't have account access to browse. Needs a
  human with Higgsfield console access to pick models and confirm their exact
  request-body shape before `providers/higgsfield/mapper.ts` is implemented for real
  (a stub matching the shared envelope can be written first).
- **Meta Marketing API version pin, exact objective enum strings, and Ad Set targeting
  field names** — general hierarchy confirmed (campaign → ad set → ad, ad set carries
  targeting/budget/placement, ad references a creative), but the literal JSON field
  names/allowed values need verification against Meta's live reference once a test
  Business Manager + ad account exist to check field-by-field, per the brief's own
  "dev/sandbox until app review" assumption.
- **TikTok Business API version + exact ad group/ad JSON shape** — same situation.
- **Consistency-check mechanism** for flagging a possibly-hallucinated creative
  (§3.3) — CLIP-similarity, a Claude vision call comparing output to reference, or
  relying on the media provider's own signals. Needs a decision before
  `pipeline/nodes/validation.ts` is implemented.
- **Statistical test choice** for experiment significance (frequentist z-test vs.
  Bayesian) — either is fine engineering-wise, it's a product/tone decision on what
  reads clearest to a non-technical merchant.
- Everything above is a **Phase 2(b)+ implementation detail**, not a blocker to
  approving this Phase 1 schema/architecture — flagging now so it isn't silently
  guessed later.

---

## 10. Suggested implementation order (unchanged from the brief)

(a) data model + `brand-context.ts` → (b) strategy/angles/ad-sets/copy via Claude →
(c) image generation → (d) video → (e) OAuth + ad-account connection → (f) dry-run
deploy layer → (g) budgets/guardrails/activation → (h) metrics sync + dashboard →
(i) A/B testing → (j) UI throughout. Each lettered step ends with a short summary and a
verifiable state (tsc/eslint clean, at minimum a dry-run exercised against a real test
store) before moving to the next, same discipline as every other feature built in this
repo. Nothing in steps (e)-(g) sends a single write to a real ad account or changes a
real budget without an explicit approval step, and `QADS_LIVE_DEPLOY` stays unset
(dry-run only) until you say otherwise — regardless of ad platform app-review status.

---

**Waiting for your go-ahead before touching any code, migration, or new file besides
this proposal.**
