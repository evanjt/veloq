-- The internal key is ours; the intervals.icu id is metadata on the activity.
-- Every existing key IS the server's id, so the backfill is true by
-- construction, and nothing that references an activity moves.
ALTER TABLE activities ADD COLUMN intervals_id TEXT;

UPDATE activities SET intervals_id = id WHERE intervals_id IS NULL;

-- Partial, so a row that has never been uploaded is not one of a crowd of
-- NULLs competing for the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_intervals_id
    ON activities(intervals_id) WHERE intervals_id IS NOT NULL;
