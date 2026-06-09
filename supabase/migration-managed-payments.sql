-- Managed payments: Quante handles Stripe, tracks earnings, pays out to IBAN

-- Per-sale earnings records
CREATE TABLE IF NOT EXISTS store_earnings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stripe_session_id text UNIQUE NOT NULL,
  gross_amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL,
  net_amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  customer_email text,
  customer_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE store_earnings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS store_earnings_project_id_idx ON store_earnings (project_id);
CREATE INDEX IF NOT EXISTS store_earnings_session_id_idx ON store_earnings (stripe_session_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_earnings' AND policyname = 'Users can view own store earnings'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own store earnings" ON store_earnings
      FOR SELECT USING (
        project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()::text)
      )';
  END IF;
END $$;

-- IBAN / payout bank account per project
CREATE TABLE IF NOT EXISTS store_payout_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  iban text NOT NULL,
  account_holder_name text NOT NULL,
  bank_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE store_payout_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_payout_accounts' AND policyname = 'Users can manage own payout accounts'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can manage own payout accounts" ON store_payout_accounts
      FOR ALL USING (user_id = auth.uid()::text)';
  END IF;
END $$;

-- Payout requests
CREATE TABLE IF NOT EXISTS payout_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending',
  iban text NOT NULL,
  account_holder_name text NOT NULL,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS payout_requests_project_id_idx ON payout_requests (project_id);
CREATE INDEX IF NOT EXISTS payout_requests_status_idx ON payout_requests (status);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_requests' AND policyname = 'Users can view own payout requests'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own payout requests" ON payout_requests
      FOR SELECT USING (user_id = auth.uid()::text)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payout_requests' AND policyname = 'Users can insert own payout requests'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can insert own payout requests" ON payout_requests
      FOR INSERT WITH CHECK (user_id = auth.uid()::text)';
  END IF;
END $$;

-- Per-project API key for deployed store → Quante communication
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS quante_api_key text UNIQUE;
CREATE INDEX IF NOT EXISTS project_secrets_api_key_idx ON project_secrets (quante_api_key) WHERE quante_api_key IS NOT NULL;
