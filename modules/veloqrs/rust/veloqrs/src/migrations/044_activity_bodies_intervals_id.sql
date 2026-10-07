-- The intervals.icu id of an activity with no track.
--
-- A row with a track keeps the server's id on `activities`, but the track
-- store is the only writer of that table, so a manual entry or an indoor ride
-- has a body and metrics and no row there. Its upload's id had nowhere to go,
-- and the next sync stored the server's copy beside the device's one.
--
-- Written only for a body with no `activities` row. Partial and unique for the
-- same reason as the `activities` index.
ALTER TABLE activity_bodies ADD COLUMN intervals_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_bodies_intervals_id
    ON activity_bodies(intervals_id) WHERE intervals_id IS NOT NULL;
