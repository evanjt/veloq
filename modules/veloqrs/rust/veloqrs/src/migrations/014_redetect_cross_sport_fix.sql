-- Migration 014: Force section re-detection to clean cross-sport activity associations
-- Clears processed_activities so next sync triggers full re-detection with sport-filtered queries
DELETE FROM processed_activities;
