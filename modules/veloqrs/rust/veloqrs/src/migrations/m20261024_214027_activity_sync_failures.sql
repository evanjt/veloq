-- The fault a sync met readying one activity, kept against that activity.
--
-- A body that does not store or decode belongs to the activity it was fetched
-- for, so it no longer fails the run for the rest of the library. The row is
-- what the feed card and the activity screen draw the "couldn't sync" mark
-- from, and it goes when that activity next readies cleanly.
--
-- One row per activity, replaced by each failed attempt. Empty on every
-- library from before the table.
CREATE TABLE activity_sync_failures (
    activity_id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    failed_at INTEGER NOT NULL
);
