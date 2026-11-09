-- Clear every stored climb best so the backfill measures each activity again.
--
-- Rows written before a step steeper than the plausibility cap was refused
-- could hold a window ending on one corrected-elevation sample that reads far
-- off its neighbours. Rows are rewritten only when an input moves, so they are
-- cleared here once, and an activity with no row is owed and re-measured.

DELETE FROM activity_climb_bests;
