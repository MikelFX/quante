-- Migration: Supabase Storage bucket for store assets (product images, gallery, etc.)
-- Run in Supabase SQL Editor

INSERT INTO storage.buckets (id, name, public)
VALUES ('store-assets', 'store-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read of all files in the bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read store-assets'
  ) THEN
    EXECUTE 'CREATE POLICY "Public read store-assets" ON storage.objects FOR SELECT TO public USING (bucket_id = ''store-assets'')';
  END IF;
END $$;
