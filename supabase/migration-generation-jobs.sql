-- Generation jobs — durable checkpoint record for /api/quante/generate.
-- NOT RUN AGAINST PRODUCTION. Prepared as a file only — run in the Supabase SQL editor
-- once reviewed and approved.
--
-- Level 1 of the "device dies mid-generation" fix (see docs/update-log.md). Today, the
-- entire store-code generation (Claude call + parsing + save) happens in one serverless
-- function invocation, and NOTHING is persisted until the very end — if the client
-- disconnects and the function dies before the final code_versions insert, whatever
-- Claude had already produced is gone with no trace. This table gives that in-flight work
-- a durable home: a row is created the moment a generation actually starts (after the
-- credit/rate-limit/project-limit guard clauses pass, right before the first Claude call),
-- and its `raw_output`/`files` columns are updated periodically as the stream progresses
-- — so a crash close to the end loses at most ~15s of output, not the whole generation.
--
-- UPDATE (Level 3, same day): this table is now also the live record a polling client
-- reads — /api/quante/generate returns a jobId immediately and schedules the actual
-- generation to run via Next.js `after()`, decoupled from the client's HTTP connection
-- entirely (not just checkpointed against it dying, as Level 1 was). Added for that:
-- `phase` (fine-grained progress text, replaces the old NDJSON `status` events),
-- `deployment_id`/`preview_url` (the validation-preview-deploy result, previously only
-- ever sent once over the stream's `done` event — now the poll endpoint's job is the only
-- place that information exists, so it has to live somewhere durable). This table was
-- never run against production, so these are added directly to the CREATE TABLE below
-- rather than as a separate ALTER — there is no live schema yet to migrate incrementally.

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  -- NULL until a brand-new project is created partway through generation (existing
  -- projects — regenerating from the Studio — have this set from the start).
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  brief text NOT NULL,
  status text NOT NULL DEFAULT 'running',   -- running | completed | failed
  -- Fine-grained progress within `running`, mirrors the old NDJSON status messages —
  -- see phaseToStatusText() in lib/generation-poll.ts for the display-text mapping.
  -- designing | retrying_fallback | parsing | saving | validating_build | null
  phase text,
  model_used text,
  -- Full accumulated Claude output so far — includes any trailing, not-yet-closed
  -- <file> block. Kept even after completion for debugging; not read by the UI.
  raw_output text NOT NULL DEFAULT '',
  -- Only *complete* <file>...</file> blocks extracted from raw_output so far — see
  -- lib/generation-checkpoint.ts extractFileBlocks(). Same shape as code_versions.files.
  files jsonb NOT NULL DEFAULT '{}',
  summary text,
  error text,
  code_version_id uuid REFERENCES code_versions(id),
  -- Validation-preview-deploy result (see the long comment in generate/route.ts about why
  -- this preview deploy exists) — the poll endpoint's only source for these once the old
  -- stream's one-shot `done` event no longer carries them anywhere.
  deployment_id text,
  preview_url text,
  credits_debited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user (Level 3's poll endpoint reads through the user-scoped
-- client). All writes happen through the generate route's own user-scoped `supabase`
-- client during the request, which already satisfies this same check via WITH CHECK —
-- no separate service-role write path needed, same pattern as code_versions.
CREATE POLICY "Users own their generation jobs" ON generation_jobs
  FOR ALL USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE INDEX IF NOT EXISTS generation_jobs_user_status_idx ON generation_jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_project_idx ON generation_jobs (project_id);

CREATE TRIGGER generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Verification query — run after applying:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'generation_jobs';
-- should return one row.
