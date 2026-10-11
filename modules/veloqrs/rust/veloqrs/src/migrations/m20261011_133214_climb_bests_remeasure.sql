-- Clear every stored climb best so the backfill measures each activity again.
--
-- Rows written before this ignored the step into an activity's last sample, so
-- a pause or dropout ending the track could stand as a climbing best. Rows are
-- rewritten only when an input moves, so they are cleared here once, and an
-- activity with no row is owed and re-measured.

DELETE FROM activity_climb_bests;
