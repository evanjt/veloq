-- Where a live strength session stands, so a killed app resumes it at the set
-- it was on: the exercise and set the athlete is at, and when the rest in
-- progress began. Both are empty for a session that is not live, and for a
-- live one with no set left to do.

ALTER TABLE strength_sessions ADD COLUMN current_exercise INTEGER;
ALTER TABLE strength_sessions ADD COLUMN current_set INTEGER;
ALTER TABLE strength_sessions ADD COLUMN rest_started_at INTEGER;
