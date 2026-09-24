-- migration-security-store-public.sql — audit 2026-09, group "store-public"
-- (findings #3 / #11 / #45 / #57 / #61)
--
-- Idempotent: safe to run more than once. File only — review before running.


-- ─── 1. Store API key: look up by hash, not plaintext (#61) ──────────────────
-- app/api/store/_lib/store-auth.ts looks keys up by quante_api_key_hash and falls
-- back to the plaintext column only for rows without a hash. The trigger keeps the
-- hash in sync whenever the deploy route writes/rotates quante_api_key, so no app
-- change is needed on the write side.
--
-- Follow-up (needs app/api/deploy/route.ts to stop reading the plaintext key back):
-- once every row has a hash, NULL out / drop project_secrets.quante_api_key.

ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS quante_api_key_hash text;

CREATE OR REPLACE FUNCTION project_secrets_hash_api_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quante_api_key IS NOT NULL AND NEW.quante_api_key <> '' THEN
    NEW.quante_api_key_hash := encode(sha256(convert_to(NEW.quante_api_key, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_secrets_hash_api_key_trg ON project_secrets;
CREATE TRIGGER project_secrets_hash_api_key_trg
  BEFORE INSERT OR UPDATE OF quante_api_key ON project_secrets
  FOR EACH ROW EXECUTE FUNCTION project_secrets_hash_api_key();

-- Backfill existing keys.
UPDATE project_secrets
SET quante_api_key_hash = encode(sha256(convert_to(quante_api_key, 'UTF8')), 'hex')
WHERE quante_api_key IS NOT NULL
  AND quante_api_key <> ''
  AND (quante_api_key_hash IS NULL
       OR quante_api_key_hash <> encode(sha256(convert_to(quante_api_key, 'UTF8')), 'hex'));

CREATE UNIQUE INDEX IF NOT EXISTS project_secrets_quante_api_key_hash_idx
  ON project_secrets (quante_api_key_hash)
  WHERE quante_api_key_hash IS NOT NULL;


-- ─── 2. Invoice numbers can't be assigned twice (#45) ────────────────────────
-- app/invoice/[orderId] assigns numbers with a compare-and-set and retries on a
-- unique violation. Existing duplicates would make the index creation fail, so it
-- is only created when there are none; otherwise a NOTICE lists what to fix.
--   Find duplicates:
--   SELECT project_id, invoice_number, count(*) FROM store_orders
--   WHERE invoice_number IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM store_orders
    WHERE invoice_number IS NOT NULL
    GROUP BY project_id, invoice_number
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'store_orders has duplicate (project_id, invoice_number) rows — fix them, then re-run this migration to create store_orders_project_invoice_number_idx';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS store_orders_project_invoice_number_idx
             ON store_orders (project_id, invoice_number)
             WHERE invoice_number IS NOT NULL';
  END IF;
END $$;


-- ─── 3. Checkout abuse limits (#11 / #12) ────────────────────────────────────
-- /api/store/checkout counts recent orders per project and per recipient before
-- creating unpaid (dobirka / prevod) orders; keep those counts index-backed.

CREATE INDEX IF NOT EXISTS store_orders_project_created_idx
  ON store_orders (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_project_email_created_idx
  ON store_orders (project_id, customer_email, created_at DESC);
-- Cross-store per-recipient cap on unpaid orders (the checkout stores customer_email
-- lower-cased from now on).
CREATE INDEX IF NOT EXISTS store_orders_email_created_idx
  ON store_orders (customer_email, created_at DESC);


-- ─── 4. Remove the dead /api/notify/order token (#57) ────────────────────────
-- The endpoint was deleted; nothing ever generated these tokens. Dropping the
-- column also drops project_secrets_notification_token_idx.

ALTER TABLE project_secrets DROP COLUMN IF EXISTS notification_token;
