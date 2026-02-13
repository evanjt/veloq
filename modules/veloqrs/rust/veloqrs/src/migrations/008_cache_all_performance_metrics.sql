-- Migration 008: Cache all performance metrics
-- Consolidates zone distributions, FTP history, and heatmap intensity
-- into a single migration for cleaner implementation

-- Part 1: Zone distribution columns (Bug 7)
-- Add individual zone columns to activity_metrics for fast aggregation
ALTER TABLE activity_metrics ADD COLUMN power_z1 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z2 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z3 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z4 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z5 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z6 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN power_z7 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z1 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z2 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z3 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z4 REAL DEFAULT 0;
ALTER TABLE activity_metrics ADD COLUMN hr_z5 REAL DEFAULT 0;

-- Part 2: FTP history cache (Bug 8)
-- Dedicated table for FTP progression tracking
CREATE TABLE IF NOT EXISTS ftp_history (
    date INTEGER PRIMARY KEY,
    ftp INTEGER NOT NULL,
    activity_id TEXT,
    sport_type TEXT
);
CREATE INDEX idx_ftp_history_date ON ftp_history(date DESC);

-- Part 3: Heatmap intensity cache (Bug 10)
-- Precomputed daily activity intensity brackets
CREATE TABLE IF NOT EXISTS activity_heatmap (
    date TEXT PRIMARY KEY,
    intensity INTEGER NOT NULL,
    max_duration INTEGER NOT NULL,
    activity_count INTEGER NOT NULL
);
CREATE INDEX idx_heatmap_date ON activity_heatmap(date);

-- Note: Data will be populated by Rust migration code after table updates
