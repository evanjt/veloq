-- Migration 053: a track whose download keeps failing.
--
-- A download that ends on a server answer, run after run, left no record: the
-- activity stayed missing, was requested on every sync and was counted as owed
-- for as long as the install lived.
--
-- `track_fetch_failures` counts the settled runs that failed for the activity.
-- `track_failed_sync_date` is the row's `icu_sync_date` when the last of them
-- ended, so an edit upstream, which can repair the stream, no longer matches it
-- and the count starts again. A landed track resets both. Neither is
-- upstream's to say, so a census pull leaves both alone.
--
-- Nothing backfills them. Every row reads as never failed after the upgrade.

ALTER TABLE activity_census ADD COLUMN track_fetch_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity_census ADD COLUMN track_failed_sync_date TEXT;
