-- Migration: Store Health Score
-- Adds a single column so the "Test transakčního e-mailu" checklist item
-- (lib/store-health.ts) can be computed from real state instead of guessed.
-- Everything else the health score needs (merchant/payments/shipping/customPages,
-- code-gen products, deployments) already exists — no other schema changes required.
--
-- DO NOT RUN AGAINST PRODUCTION — file only, per project safety rules. Apply manually
-- via the Supabase SQL editor when ready.

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS email_test_sent_at timestamptz;
