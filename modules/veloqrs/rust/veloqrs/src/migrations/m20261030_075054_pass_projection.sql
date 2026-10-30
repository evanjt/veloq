-- How far a pass's time was projected to reach the section's gates.
--
-- A pass that starts or stops short of a gate, within the slack the matcher
-- admits, has that end projected to the gate at the pass's own speed. The
-- longer of the two ends' projections is stored in metres, so a short reach
-- reads as a plain time and a long one as an estimate. NULL is a pass timed
-- between both gates, and every row from before the column.
ALTER TABLE section_activities ADD COLUMN projected_m REAL;
