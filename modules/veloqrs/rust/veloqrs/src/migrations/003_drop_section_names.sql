-- Migration 003: Drop legacy section_names table
-- Section names are now stored directly in the sections.name column
-- Note: section_names only exists for pre-migration databases, not fresh installs

-- Drop the legacy table if it exists (no-op for fresh installs)
DROP TABLE IF EXISTS section_names;
