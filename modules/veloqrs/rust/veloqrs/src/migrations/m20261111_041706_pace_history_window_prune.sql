-- Drop the pace snapshots stored under any window but the six-week one.
--
-- Only the six-week reading is compared, and the engine writes only that one
-- now, so snapshots of other windows (the year range a screen once saved) are
-- read by nothing. Rows with no recorded window predate the column and stay.

DELETE FROM pace_history WHERE window_days != 42;
