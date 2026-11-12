-- Which side worked a wellness day's fitness, fatigue and ramp rate out:
-- 'veloq' for a day Veloq folded from its own loads, NULL for a day that
-- carries what intervals.icu served or has no such figures.
--
-- Empty on every library from before the column, and every existing day
-- reads as the server's.
ALTER TABLE wellness ADD COLUMN source TEXT;
