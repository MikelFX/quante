-- AI Store Analyzer: cached insight cards per project (one row per project, upserted on refresh)
CREATE TABLE IF NOT EXISTS store_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  insights jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their store insights" ON store_insights
  FOR ALL USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
