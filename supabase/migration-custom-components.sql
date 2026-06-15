-- Custom components — stores validated AI-generated React component code.
-- Keyed by a ref (uuid), referenced from manifest sections of type "customComponent".

CREATE TABLE IF NOT EXISTS custom_components (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref         text NOT NULL,               -- short human-readable ref, e.g. "promo-banner-2026"
  name        text NOT NULL,               -- display name in Studio
  code        text NOT NULL,               -- validated TSX source
  prompt      text,                        -- instruction that created it
  passed_validation boolean NOT NULL DEFAULT true,
  warnings    text[],                      -- non-blocking validation warnings
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_components_project_ref_idx
  ON custom_components (project_id, ref);

ALTER TABLE custom_components ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'custom_components' AND policyname = 'Users can view own custom components'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own custom components" ON custom_components
      FOR ALL USING (
        project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()::text)
      )';
  END IF;
END $$;
