-- Migration 020: Section visibility state
-- Moves disabled/superseded state from TypeScript AsyncStorage into SQLite.
-- disabled = 1 means user has hidden this section (reversible).
-- superseded_by stores the custom section ID that replaced this auto section.

ALTER TABLE sections ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sections ADD COLUMN superseded_by TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sections_disabled ON sections(disabled);
CREATE INDEX IF NOT EXISTS idx_sections_superseded ON sections(superseded_by);
