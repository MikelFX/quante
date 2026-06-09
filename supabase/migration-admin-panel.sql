-- Project secrets (Stripe keys for live store)
CREATE TABLE IF NOT EXISTS project_secrets (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  stripe_publishable_key text,
  stripe_secret_key      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own project_secrets" ON project_secrets FOR ALL
  USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
