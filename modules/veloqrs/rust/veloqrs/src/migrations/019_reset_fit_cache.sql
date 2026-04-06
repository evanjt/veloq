-- Migration 019: Reset FIT file processing cache after parser fix
-- The initial parse may have cached incorrect results
DELETE FROM fit_file_status;
DELETE FROM exercise_sets;
