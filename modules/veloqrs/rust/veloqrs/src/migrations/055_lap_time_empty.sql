-- Migration 055: a lap its stored time stream cannot time.
--
-- `lap_time` stays NULL for a traversal whose stream is not the track's
-- length or lies outside the stream, and a NULL beside a stored stream was
-- read as "not yet computed", so the stream was decoded again on every pass.
-- `time_empty` records that the stored stream was read and could not time the
-- traversal. Storing a new time stream clears it.
--
-- Nothing backfills it. Every row is 0 after the upgrade, which reads as not
-- yet looked at.

ALTER TABLE section_activities ADD COLUMN time_empty INTEGER NOT NULL DEFAULT 0;
