-- Migration 049: a track the engine refused for good.
--
-- An activity whose stream carries no latlngs, or fewer than two usable
-- points, is refused at storage and never enters `gps_tracks`, so nothing said
-- it had been asked for and every sync requested its stream again.
--
-- The refusal is kept on the census row, the table that already holds the
-- device's own mark of what it came away with. `track_refusal` is the kind
-- (`no_track` or `too_short`). `track_refused_sync_date` is the row's
-- `icu_sync_date` when the refusal was made, so an edit upstream, which can
-- add the track the first download lacked, no longer matches it and the
-- activity is asked for again. Neither is upstream's to say, so a census pull
-- leaves both alone.
--
-- Nothing backfills them. Every row is NULL after the upgrade, which reads as
-- never refused.

ALTER TABLE activity_census ADD COLUMN track_refusal TEXT;
ALTER TABLE activity_census ADD COLUMN track_refused_sync_date TEXT;
