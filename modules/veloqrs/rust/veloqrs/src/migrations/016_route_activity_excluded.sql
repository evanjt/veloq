-- Add excluded flag to activity_matches for hiding outlier route activities
ALTER TABLE activity_matches ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;
