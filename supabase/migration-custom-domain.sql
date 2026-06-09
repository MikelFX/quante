-- Add custom domain tracking to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_domain_verified boolean DEFAULT false;
