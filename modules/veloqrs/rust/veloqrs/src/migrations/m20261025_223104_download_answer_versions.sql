-- The version of an activity an elevation or series answer was given for.
--
-- A track upstream answered "no altitude" for, or would not serve, is
-- settled for that version of the activity. An edit, a reprocess or a
-- replaced file moves the census row's `icu_sync_date` off the recorded
-- version, which is what asks again. A track with no recorded version, every
-- row from before the column, is never asked again on a version change.
--
-- `withheld` marks a series download upstream refused with a 403. It is not an
-- attempt and never retires the activity: it waits for a new version or for
-- the athlete to ask again.
ALTER TABLE gps_tracks ADD COLUMN elevation_settled_version TEXT;
ALTER TABLE activity_stream_backfill ADD COLUMN withheld INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity_stream_backfill ADD COLUMN settled_version TEXT;
