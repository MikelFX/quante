-- Store orders — tracks all orders across all payment methods.
-- Stripe-completed sales also appear in store_earnings for backwards compatibility.

CREATE TABLE IF NOT EXISTS store_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Human-readable order number, e.g. "2026-0001"
  order_number text NOT NULL,

  -- Lifecycle
  status text NOT NULL DEFAULT 'pending',        -- pending, paid, shipped, cancelled, refunded
  payment_status text NOT NULL DEFAULT 'pending', -- pending, paid, failed, refunded

  -- Payment
  payment_method text NOT NULL DEFAULT 'stripe', -- stripe, comgate, gopay, dobirka, prevod
  payment_ref text,                              -- Stripe session ID, Comgate transId, etc.

  -- Shipping
  shipping_method text,                          -- zasilkovna, ppl, dpd, osobni_odber, custom
  zasilkovna_branch_id text,
  zasilkovna_branch_name text,
  tracking_code text,
  tracking_url text,

  -- Customer
  customer_name text,
  customer_email text,
  customer_phone text,
  shipping_address jsonb,                        -- {ulice, mesto, psc}

  -- Financial
  items jsonb NOT NULL DEFAULT '[]',             -- [{id, name, price, quantity}]
  subtotal_cents integer NOT NULL DEFAULT 0,
  shipping_cents integer NOT NULL DEFAULT 0,
  dobirka_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'czk',

  -- Invoice
  invoice_number text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE store_orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS store_orders_project_id_idx ON store_orders (project_id);
CREATE INDEX IF NOT EXISTS store_orders_payment_ref_idx ON store_orders (payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS store_orders_status_idx ON store_orders (status);

-- Only the owning merchant can see their store orders
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_orders' AND policyname = 'Users can view own store orders'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own store orders" ON store_orders
      FOR SELECT USING (
        project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()::text)
      )';
  END IF;
END $$;

-- Order number generator — sequential per project, format: YYYY-NNNN
CREATE OR REPLACE FUNCTION next_order_number(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  year_part text := to_char(now(), 'YYYY');
  seq_num integer;
BEGIN
  SELECT COUNT(*) + 1
    INTO seq_num
    FROM store_orders
   WHERE project_id = p_project_id
     AND order_number LIKE year_part || '-%';

  RETURN year_part || '-' || lpad(seq_num::text, 4, '0');
END;
$$;
