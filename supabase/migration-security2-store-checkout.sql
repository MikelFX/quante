-- Security pass 2 — store checkout (audit #56).
--
-- Bank-transfer orders get a random per-order token that the checkout puts in the
-- store's /success redirect (instead of the account, amount and QR payload). Only its
-- SHA-256 (hex) is stored here; GET /api/store/order-status verifies it and returns
-- the payment instructions. Until this runs, the checkout still works: the redirect
-- simply carries no token and the success page tells the customer to use the email.
--
-- Idempotent. Run in the Supabase SQL editor.

ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS public_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS store_orders_public_token_hash_idx
  ON store_orders (public_token_hash)
  WHERE public_token_hash IS NOT NULL;
