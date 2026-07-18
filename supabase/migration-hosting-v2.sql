-- Migration: Hosting v2 — suspension + expiry reminder tracking
-- Run in Supabase SQL Editor after migration-hosting-billing.sql

-- When hosting expired and the maintenance page was deployed. NULL = store live.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hosting_suspended_at timestamptz;

-- Tracks sent expiry reminder emails so the daily cron never sends duplicates.
-- kind: 'reminder_7d' | 'reminder_1d' | 'suspended'
-- ref_date: the expiry date the reminder refers to (new billing period = new ref_date = reminders fire again)
CREATE TABLE IF NOT EXISTS hosting_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, ref_date)
);

ALTER TABLE hosting_reminders ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only.
