-- Migration 007: Add performance cache to section_activities table
-- This eliminates expensive recalculation of lap times/paces on every query

-- Add cached performance columns (NULL allowed for existing rows)
ALTER TABLE section_activities ADD COLUMN lap_time REAL;
ALTER TABLE section_activities ADD COLUMN lap_pace REAL;

-- Note: Data will be populated by Rust migration code after table update
