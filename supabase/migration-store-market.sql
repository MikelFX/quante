-- Store market/language override for code-gen mode stores.
--
-- Background: data/config.ts (StoreConfig.brand) already carries a `language` field
-- (and, as of this change, a new `country` field) that the AI sets at generation
-- time based on the brief's target market — this is what the deterministic scaffold
-- (cart/checkout, success page, cookie banner, legal-page fallback, 404, footer legal
-- links) reads via lib/i18n.ts to render in the store's actual market/language
-- instead of always English. See lib/store-template/build.ts and lib/claude.ts.
--
-- That's sufficient at generation time, but merchants have no way to see or change
-- their store's market/language afterwards short of an AI chat prompt — there's no
-- durable, Studio-editable record of it. These two columns give the Publish panel's
-- new "Market & language" control (MerchantPanel.tsx) somewhere to read/write, and
-- give /api/quante/generate an explicit signal to seed config.brand.country/language
-- from on the next generation or iteration, rather than only ever inferring from the
-- brief text. Nullable — when unset, the AI keeps inferring from the brief as before.
--
-- Column added to project_secrets (already exists, extended incrementally — see
-- migration-business-info.sql for the same pattern).

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS market_country text,   -- ISO 3166-1 alpha-2, e.g. "US", "CZ" — merchant override for config.brand.country
  ADD COLUMN IF NOT EXISTS market_language text;  -- ISO 639-1, e.g. "en", "cs" — merchant override for config.brand.language
