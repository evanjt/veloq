-- Heart rate zone seconds for the sixth and seventh zones.
--
-- The cache kept five heart rate zones, so time above the fifth was dropped
-- and the distribution summed a total that excluded it. Rows written before
-- this carry zero here until their activity is synced again.
ALTER TABLE activity_metrics ADD COLUMN hr_z6 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z7 REAL DEFAULT 0;
