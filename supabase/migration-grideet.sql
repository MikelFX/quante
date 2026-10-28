-- Grideet (2026-10-28). Idempotent; safe to re-run. Run manually in the Supabase SQL Editor.
-- Until it has run, Grideet works and lists every Qscan scan under "Unassigned".
--
-- qscan_scans.project_id  the store a scan built ("Build my new store" on /qscan, recorded by
--                         POST /api/qscan/[id]/project). Grideet shows the scan under that store.
--                         ON DELETE SET NULL: deleting the store keeps the scan (unassigned).

ALTER TABLE qscan_scans ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS qscan_scans_project_idx ON qscan_scans (project_id) WHERE project_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Check:
--   SELECT count(*) FILTER (WHERE project_id IS NOT NULL) AS linked, count(*) AS scans FROM qscan_scans;
