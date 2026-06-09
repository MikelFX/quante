-- Migration: Hosting billing (trial + annual subscription)
-- Run in Supabase SQL Editor after migration-hosting.sql

-- Track when the 30-day free trial ends (set on first successful deploy)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hosting_trial_ends_at timestamptz;
