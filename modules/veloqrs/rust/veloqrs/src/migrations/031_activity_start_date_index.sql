-- Migration 031: index activities(start_date).
--
-- The stream retention prune runs on the way out of every stream write, inside
-- the per-activity write hold, and selects the activities to drop on
-- `start_date`. Without an index SQLite scans the whole table once per stored
-- activity, so a 500-activity sync into a 5,000-activity library scans 2.5
-- million rows it does not need, holding the lock every screen read waits on.
--
-- Partial on `start_date IS NOT NULL`, because that is the prune's own
-- predicate and an activity with no date is never a candidate.

CREATE INDEX IF NOT EXISTS idx_activities_start_date
    ON activities (start_date)
    WHERE start_date IS NOT NULL;
