-- Qads — ad-campaign generation & management module (Phase 1 schema).
-- See docs/qads-proposal.md for the full design writeup this was approved from.
--
-- SAFETY NOTE (same standing rule as migration-partners.sql / migration-marketplace.sql):
-- this is INFRASTRUCTURE ONLY. Nothing in this file, and no code path introduced in
-- Qads Phase 1, sends a single write to a real ad account. Every channel-side object
-- Qads creates is PAUSED; live sends only happen if QADS_LIVE_DEPLOY is explicitly set
-- (see lib/qads/channels — not written yet in this pass) — off by default, off in every
-- environment until the project owner turns it on. Do NOT run this file against
-- production from this session — file only, per project safety rules.
--
-- Follows this repo's existing conventions exactly: CREATE TABLE IF NOT EXISTS, RLS via
-- (auth.jwt() ->> 'sub') = user_id (Clerk's JWT claim, never auth.uid()), DO $$ ... IF
-- NOT EXISTS (SELECT 1 FROM pg_policies ...) ... END $$ guards so this file is safely
-- re-runnable, and the shared update_updated_at() trigger function (already defined by
-- an earlier migration).

-- Per (project, channel) connection to an external ad account. One row per channel per
-- project — a project can connect both Meta and TikTok, never two Meta accounts to one
-- project (UNIQUE below), matching how a merchant actually manages ad accounts.
CREATE TABLE IF NOT EXISTS qads_ad_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel               text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  external_account_id   text NOT NULL,          -- Meta ad_account_id / TikTok advertiser_id
  business_id           text,                    -- Meta Business Manager id / TikTok Business Center id
  page_id               text,                    -- Meta Page id (required for most placements)
  pixel_id              text,                    -- Meta Pixel / TikTok Pixel id
  catalog_id            text,                    -- Meta product catalog id, if connected
  access_token_enc      text NOT NULL,           -- lib/crypto.ts encryptSecret() — never stored plaintext
  refresh_token_enc     text,                    -- TikTok issues one; Meta long-lived tokens don't
  token_expires_at      timestamptz,
  scopes                text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'connected'
                          CHECK (status IN ('connected', 'needs_reauth', 'revoked', 'error')),
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, channel)
);

CREATE INDEX IF NOT EXISTS qads_ad_accounts_project_idx ON qads_ad_accounts(project_id);

CREATE TRIGGER qads_ad_accounts_updated_at BEFORE UPDATE ON qads_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- One campaign brief + generated strategy. Deliberately has NO external_id/external_status
-- column — a campaign can span multiple channels at once (see `channels` array below), and
-- Meta/TikTok campaigns are entirely separate external objects with independent ids and
-- independent states (a merchant might pause the Meta side and keep TikTok running). That
-- per-channel state lives on qads_campaign_channel_links instead — see the note above that
-- table. This is a deliberate, flagged deviation from the brief's literal schema sketch
-- (which put external_id directly here) — see docs/qads-proposal.md §2.1.
CREATE TABLE IF NOT EXISTS qads_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  goal                  text NOT NULL CHECK (goal IN ('launch', 'sale', 'black_friday', 'awareness', 'custom')),
  channels              text[] NOT NULL,          -- subset of {'meta','tiktok'}
  budget_minor          integer NOT NULL,          -- total planned campaign budget, minor currency units
  currency              text NOT NULL DEFAULT 'usd',
  duration_days         integer NOT NULL,
  product_ids           text[] NOT NULL DEFAULT '{}', -- store_inventory.product_id values in scope
  brief                 text NOT NULL,              -- raw user goal description (not a brand brief — see brand_context)
  brand_context         jsonb,                       -- frozen brand-context snapshot, see lib/qads/claude/brand-context.ts
  strategy              jsonb,                       -- positioning + summary once generated
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'generating', 'ready_for_review',
                                            'deploying', 'deployed_paused', 'active',
                                            'paused', 'completed', 'failed')),
  pipeline_state        jsonb NOT NULL DEFAULT '{}', -- compact node-graph status snapshot for fast reads
  credits_reserved      integer NOT NULL DEFAULT 0,
  credits_spent         integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_campaigns_project_idx ON qads_campaigns(project_id);
CREATE INDEX IF NOT EXISTS qads_campaigns_status_idx ON qads_campaigns(status);

CREATE TRIGGER qads_campaigns_updated_at BEFORE UPDATE ON qads_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- A campaign deploys to N channels; each channel gets its OWN external campaign object.
-- This join table carries the real per-channel external id/status/dry-run flag.
CREATE TABLE IF NOT EXISTS qads_campaign_channel_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  channel               text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  ad_account_id         uuid NOT NULL REFERENCES qads_ad_accounts(id),
  external_campaign_id  text,                       -- set once deployed (real, or dry-run-simulated id)
  external_status       text,                        -- channel-native status string (e.g. 'PAUSED'), not our enum
  deploy_payload        jsonb,                        -- full payload snapshot shown on the approval screen (§5.1)
  dry_run               boolean NOT NULL DEFAULT true,
  deployed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, channel)
);

CREATE INDEX IF NOT EXISTS qads_campaign_channel_links_campaign_idx ON qads_campaign_channel_links(campaign_id);

-- Strategic angle — maps to one or more ad sets, never directly to a creative.
CREATE TABLE IF NOT EXISTS qads_angles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  label                 text NOT NULL,
  hypothesis            text NOT NULL,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_angles_campaign_idx ON qads_angles(campaign_id);

-- Field names deliberately mirror Meta's Ad Set object (audience/targeting, budget,
-- placements, schedule, bid strategy) so the channel mapper stays close to 1:1 — see
-- docs/qads-proposal.md §5.
CREATE TABLE IF NOT EXISTS qads_ad_sets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  angle_id              uuid NOT NULL REFERENCES qads_angles(id) ON DELETE CASCADE,
  channel               text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  name                  text NOT NULL,
  audience              jsonb NOT NULL,             -- { ageMin, ageMax, genders[], geo[], interests[], lookalike?, customAudienceRef? }
  placements            text[] NOT NULL DEFAULT '{}', -- e.g. 'feed','stories','reels','tiktok_for_you'
  budget_minor          integer NOT NULL,
  budget_type           text NOT NULL DEFAULT 'daily' CHECK (budget_type IN ('daily', 'lifetime')),
  schedule_start        timestamptz,
  schedule_end          timestamptz,
  bid_strategy          text,                        -- channel-native string, validated per channel not by a fixed enum
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'ready', 'deployed_paused', 'active', 'paused')),
  external_id           text,
  external_status       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_ad_sets_campaign_idx ON qads_ad_sets(campaign_id);
CREATE INDEX IF NOT EXISTS qads_ad_sets_status_idx ON qads_ad_sets(status);

CREATE TRIGGER qads_ad_sets_updated_at BEFORE UPDATE ON qads_ad_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- The actual generated (or in-progress) media asset file. Kept separate from
-- qads_creatives: this row is the STORED FILE, qads_creatives is the GENERATION record.
-- Declared before qads_creatives since qads_creatives references it.
CREATE TABLE IF NOT EXISTS qads_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storage_path          text NOT NULL,               -- Supabase Storage path, 'qads-assets' bucket
  mime_type             text NOT NULL,
  width                 integer,
  height                integer,
  duration_seconds      numeric,
  bytes                 integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_assets_project_idx ON qads_assets(project_id);

-- One generated (or in-progress) media asset generation record: provider, model, params,
-- source product/photo, moderation flag. A creative can fail and be retried without ever
-- producing an asset row — that's why this is separate from qads_assets.
CREATE TABLE IF NOT EXISTS qads_creatives (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN ('static', 'video')),
  format                text NOT NULL CHECK (format IN ('1:1', '4:5', '9:16', '16:9')),
  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'generating', 'completed', 'failed', 'flagged_for_review')),
  provider              text NOT NULL DEFAULT 'higgsfield',
  model                 text,                         -- exact model id — pinned once Higgsfield console access confirms it (open question)
  provider_request_id   text,                          -- Higgsfield request_id, for polling/webhook correlation
  input_params          jsonb NOT NULL,                -- prompt, source_photo_asset_id, product_id, strength, etc.
  source_product_id     text,                           -- store_inventory.product_id — the real product this must depict
  source_photo_asset_id uuid REFERENCES qads_assets(id), -- reference photo used as image-to-image/video input (product fidelity, §3.3)
  asset_id              uuid REFERENCES qads_assets(id),
  consistency_flag      boolean NOT NULL DEFAULT false, -- true = flagged for human review
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_creatives_campaign_idx ON qads_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS qads_creatives_status_idx ON qads_creatives(status);
CREATE INDEX IF NOT EXISTS qads_creatives_provider_request_idx ON qads_creatives(provider_request_id);

CREATE TRIGGER qads_creatives_updated_at BEFORE UPDATE ON qads_creatives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- One ad = one creative + one text variant, in a format matching its ad set's placements.
CREATE TABLE IF NOT EXISTS qads_ads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_set_id             uuid NOT NULL REFERENCES qads_ad_sets(id) ON DELETE CASCADE,
  format                text NOT NULL CHECK (format IN ('1:1', '4:5', '9:16', '16:9')),
  texts                 jsonb NOT NULL,               -- { headline, primaryText, description, cta } — channel char-limited variants
  creative_id           uuid REFERENCES qads_creatives(id),
  approval_status       text NOT NULL DEFAULT 'pending'
                          CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
  external_id           text,
  external_status       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_ads_ad_set_idx ON qads_ads(ad_set_id);

CREATE TRIGGER qads_ads_updated_at BEFORE UPDATE ON qads_ads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Daily metric rows, one per (entity, day) — upserted by day so history is preserved,
-- never overwritten in place. entity_id is the channel-native external_id (TEXT, not an
-- FK) since insights are pulled per external object and can outlive the Qads-side row.
CREATE TABLE IF NOT EXISTS qads_metrics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  level                 text NOT NULL CHECK (level IN ('campaign', 'ad_set', 'ad')),
  entity_id             text NOT NULL,                 -- external_id of the campaign/ad_set/ad
  channel               text NOT NULL CHECK (channel IN ('meta', 'tiktok')),
  day                   date NOT NULL,
  impressions           bigint NOT NULL DEFAULT 0,
  clicks                bigint NOT NULL DEFAULT 0,
  spend_minor           integer NOT NULL DEFAULT 0,     -- real money on the merchant's own ad account — never a credits field, see §6
  conversions           integer NOT NULL DEFAULT 0,
  conversion_value_minor integer NOT NULL DEFAULT 0,
  ctr                   numeric,
  cpc_minor             integer,
  cpa_minor             integer,
  roas                  numeric,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, entity_id, day)
);

CREATE INDEX IF NOT EXISTS qads_metrics_campaign_idx ON qads_metrics(campaign_id, day DESC);
CREATE INDEX IF NOT EXISTS qads_metrics_entity_idx ON qads_metrics(entity_id, day DESC);

CREATE TABLE IF NOT EXISTS qads_experiments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES qads_campaigns(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN ('creative', 'copy', 'audience')),
  variants              jsonb NOT NULL,                -- [{ id, refType, refId, trafficShare }]
  budget_split          jsonb NOT NULL,
  success_metric        text NOT NULL CHECK (success_metric IN ('ctr', 'cpa', 'roas', 'conversions')),
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'evaluating', 'concluded', 'inconclusive')),
  min_sample_note       text,                           -- e.g. "48 conversions so far — need ~120 for 95% confidence"
  result                jsonb,                           -- { winnerVariantId?, confidence, appliedAt? }
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_experiments_campaign_idx ON qads_experiments(campaign_id);

CREATE TRIGGER qads_experiments_updated_at BEFORE UPDATE ON qads_experiments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Every money-adjacent or state-changing action. Append-only audit trail — same shape
-- convention as credit_ledger / partner_commission_ledger / marketplace_seller_ledger.
CREATE TABLE IF NOT EXISTS qads_audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               text NOT NULL,
  campaign_id           uuid REFERENCES qads_campaigns(id) ON DELETE SET NULL,
  action                text NOT NULL,                  -- 'budget_change','activate','pause','kill_switch','deploy','experiment_apply'
  entity_type           text,
  entity_id             text,
  before_json           jsonb,
  after_json            jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_audit_log_campaign_idx ON qads_audit_log(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qads_audit_log_user_idx ON qads_audit_log(user_id, created_at DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────────────
-- All server code reads/writes through supabaseAdmin (service role), same as every other
-- table in this repo — these policies are defense-in-depth for any future direct-from-
-- browser Supabase access, matching the canonical (auth.jwt() ->> 'sub') pattern from
-- migration-rls-consistency.sql (never auth.uid()).

ALTER TABLE qads_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_campaign_channel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_angles ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_ad_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE qads_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_ad_accounts' AND policyname = 'qads_ad_accounts owner all') THEN
    CREATE POLICY "qads_ad_accounts owner all" ON qads_ad_accounts
      FOR ALL USING (user_id = (auth.jwt() ->> 'sub')) WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_campaigns' AND policyname = 'qads_campaigns owner all') THEN
    CREATE POLICY "qads_campaigns owner all" ON qads_campaigns
      FOR ALL USING (user_id = (auth.jwt() ->> 'sub')) WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_campaign_channel_links' AND policyname = 'qads_campaign_channel_links via campaign') THEN
    CREATE POLICY "qads_campaign_channel_links via campaign" ON qads_campaign_channel_links
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_angles' AND policyname = 'qads_angles via campaign') THEN
    CREATE POLICY "qads_angles via campaign" ON qads_angles
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_ad_sets' AND policyname = 'qads_ad_sets via campaign') THEN
    CREATE POLICY "qads_ad_sets via campaign" ON qads_ad_sets
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_assets' AND policyname = 'qads_assets via project') THEN
    CREATE POLICY "qads_assets via project" ON qads_assets
      FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_creatives' AND policyname = 'qads_creatives via campaign') THEN
    CREATE POLICY "qads_creatives via campaign" ON qads_creatives
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_ads' AND policyname = 'qads_ads via ad_set') THEN
    CREATE POLICY "qads_ads via ad_set" ON qads_ads
      FOR ALL USING (ad_set_id IN (
        SELECT s.id FROM qads_ad_sets s JOIN qads_campaigns c ON c.id = s.campaign_id
        WHERE c.user_id = (auth.jwt() ->> 'sub')
      ))
      WITH CHECK (ad_set_id IN (
        SELECT s.id FROM qads_ad_sets s JOIN qads_campaigns c ON c.id = s.campaign_id
        WHERE c.user_id = (auth.jwt() ->> 'sub')
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_metrics' AND policyname = 'qads_metrics via campaign') THEN
    CREATE POLICY "qads_metrics via campaign" ON qads_metrics
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_experiments' AND policyname = 'qads_experiments via campaign') THEN
    CREATE POLICY "qads_experiments via campaign" ON qads_experiments
      FOR ALL USING (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')))
      WITH CHECK (campaign_id IN (SELECT id FROM qads_campaigns WHERE user_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qads_audit_log' AND policyname = 'qads_audit_log read own') THEN
    CREATE POLICY "qads_audit_log read own" ON qads_audit_log
      FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;
