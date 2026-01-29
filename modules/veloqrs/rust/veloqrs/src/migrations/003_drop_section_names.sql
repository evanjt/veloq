-- Migration 003: Drop legacy section_names table
-- Section names are now stored directly in the sections.name column

-- Migrate any existing names from section_names to sections
-- (Only updates sections where name is NULL to avoid overwriting)
UPDATE sections
SET name = (SELECT custom_name FROM section_names WHERE section_names.section_id = sections.id)
WHERE name IS NULL
  AND EXISTS (SELECT 1 FROM section_names WHERE section_names.section_id = sections.id);

-- Drop the legacy table
DROP TABLE IF EXISTS section_names;
