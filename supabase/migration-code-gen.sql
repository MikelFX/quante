-- code_versions table replaces manifest_versions for the new direct code generation approach
CREATE TABLE IF NOT EXISTS code_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  files jsonb NOT NULL DEFAULT '{}',
  prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE code_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their code versions" ON code_versions
  FOR ALL USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE INDEX code_versions_project_id_idx ON code_versions (project_id, created_at DESC);

-- Add code_version_id to deployments
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS code_version_id uuid REFERENCES code_versions(id);
