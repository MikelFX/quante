-- F5: byrd fulfillment
-- Run in the Supabase SQL editor.

-- byrd API credentials (per project)
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS byrd_api_key text;
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS byrd_api_secret text;

-- Fulfillment tracking on orders (provider-agnostic)
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS fulfillment_provider text;   -- e.g. 'byrd'
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS fulfillment_ref text;        -- provider shipment id (byrd_id)
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS fulfillment_status text;     -- provider-native status
