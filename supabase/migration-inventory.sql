-- Stock tracking for hosted stores.
-- One row per (project_id, product_id) for simple products,
-- or per (project_id, product_id, variant_id) for variant products.
-- ZIP exports use the manifest-level product.variants[].stock field instead.

CREATE TABLE IF NOT EXISTS store_inventory (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id     text NOT NULL,   -- matches manifest Product.id
  variant_id     text,            -- matches ProductVariant.id; NULL = base product / no variants
  stock_qty      integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5,
  updated_at     timestamptz DEFAULT now()
);

-- Composite uniqueness: one row per product/variant per store
CREATE UNIQUE INDEX IF NOT EXISTS store_inventory_product_variant_idx
  ON store_inventory (project_id, product_id, COALESCE(variant_id, ''));

CREATE INDEX IF NOT EXISTS store_inventory_project_idx ON store_inventory (project_id);

ALTER TABLE store_inventory ENABLE ROW LEVEL SECURITY;

-- Merchants can only see/edit their own store inventory
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_inventory' AND policyname = 'Users can manage own store inventory'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can manage own store inventory" ON store_inventory
      FOR ALL USING (
        project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> ''sub''))
      )';
  END IF;
END $$;

-- Atomic stock decrement used by the checkout API.
-- Returns TRUE if stock was successfully decremented, FALSE if insufficient stock.
CREATE OR REPLACE FUNCTION decrement_stock(
  p_project_id uuid,
  p_product_id text,
  p_variant_id text,
  p_qty        integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE store_inventory
     SET stock_qty  = stock_qty - p_qty,
         updated_at = now()
   WHERE project_id = p_project_id
     AND product_id = p_product_id
     AND COALESCE(variant_id, '') = COALESCE(p_variant_id, '')
     AND stock_qty >= p_qty;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- Low-stock view: all inventory rows currently at or below their threshold.
-- security_invoker = true ensures RLS on store_inventory/projects is enforced
-- for the querying user rather than the view creator.
CREATE OR REPLACE VIEW store_inventory_low_stock
  WITH (security_invoker = true) AS
  SELECT i.*, p.user_id AS merchant_user_id
    FROM store_inventory i
    JOIN projects p ON p.id = i.project_id
   WHERE i.stock_qty <= i.low_stock_threshold;
