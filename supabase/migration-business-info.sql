-- Business/payments/shipping settings for code-gen mode stores.
--
-- Background: the "Publish" panel's business-details / payments / shipping form
-- (app/(app)/project/[id]/MerchantPanel.tsx) was built against the legacy
-- ShopManifest.merchant/payments/shipping shape (manifest_versions table). After the
-- code-gen architecture pivot, StudioClient.tsx's `currentManifest` was stubbed to a
-- permanent `null` ("Legacy compatibility stubs — keep panels from crashing during
-- transition"), which silently made the panel's Save buttons no-ops for every
-- code-gen store (they early-return on `if (!manifest) return`). Even wiring a live
-- fetch of manifest_versions wouldn't fully fix it: ShopManifestSchema requires
-- brand/design/catalog/pages/nav/footer/seo, none of which exist for a pure code-gen
-- project, so a partial save would fail validation.
--
-- Fix: store this data independently of the manifest, on project_secrets (already the
-- home for per-project settings — email sender, gateway credentials, Packeta creds —
-- one row per project, extended incrementally via migrations exactly like this one).
--
-- All columns added to project_secrets (already exists).

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS merchant_json jsonb,   -- { name, taxId?, vatId?, vatPayer, address: {street, city, postalCode, country}, contact: {email, phone}, bankAccount?, responsiblePerson? }
  ADD COLUMN IF NOT EXISTS payments_json jsonb,   -- { providers: string[], codEnabled, codFeeMinor?, bankTransferEnabled, bankTransferQr? }
  ADD COLUMN IF NOT EXISTS shipping_json jsonb;   -- { methods: [{ id, label, priceMinor, currency }], freeShippingThresholdMinor?, pickupEnabled }
