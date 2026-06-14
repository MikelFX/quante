-- Packeta International support: store the branch country so we know the destination,
-- and add optional parcel dimensions (required by some international carriers).

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS zasilkovna_branch_country text,   -- ISO 3166-1 alpha-2, e.g. "de", "sk"
  ADD COLUMN IF NOT EXISTS parcel_weight_kg numeric(6,3),    -- kg, used when creating the Packeta parcel
  ADD COLUMN IF NOT EXISTS parcel_size jsonb;                -- {width_cm, height_cm, depth_cm} for carriers that need it
