-- Migration 004: Extend activity_metrics for aggregate queries
-- Adds training load (TSS), FTP, and zone time distributions
-- These enable SQL-based aggregation (period stats, zone distribution, FTP trends)
-- Existing rows will have NULLs; next sync fills them via INSERT OR REPLACE.

ALTER TABLE activity_metrics ADD COLUMN training_load REAL;
ALTER TABLE activity_metrics ADD COLUMN ftp INTEGER;
ALTER TABLE activity_metrics ADD COLUMN power_zone_times TEXT;  -- JSON array: [secs, secs, ...]
ALTER TABLE activity_metrics ADD COLUMN hr_zone_times TEXT;     -- JSON array: [secs, secs, ...]
