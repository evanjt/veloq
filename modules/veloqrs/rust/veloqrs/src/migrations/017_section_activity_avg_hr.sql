-- Migration 017: Add avg_hr column to section_activities for aerobic efficiency tracking
-- Stores the average heart rate during each section traversal
ALTER TABLE section_activities ADD COLUMN avg_hr REAL;
