-- Migration 050: a lap whose series held nothing over its traversal.
--
-- `avg_hr` and `avg_power` stay NULL for a traversal that falls wholly in a
-- sensor dropout, and a NULL beside a stored series was read as "not yet
-- computed", so the row was decoded again on every pass. `hr_empty` and
-- `power_empty` record that the stored series was read and had no sample in
-- the traversal. Storing a new series of that kind clears them.
--
-- Nothing backfills them. Every row is 0 after the upgrade, which reads as
-- not yet looked at.

ALTER TABLE section_activities ADD COLUMN hr_empty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_activities ADD COLUMN power_empty INTEGER NOT NULL DEFAULT 0;
