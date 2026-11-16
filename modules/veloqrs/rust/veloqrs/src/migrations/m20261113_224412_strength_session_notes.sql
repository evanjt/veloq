-- The lines of a plan that were not exercises, kept with the session that was
-- started from the plan, one line to a row of text joined by a newline. Empty
-- for every session that had none.

ALTER TABLE strength_sessions ADD COLUMN notes TEXT;
