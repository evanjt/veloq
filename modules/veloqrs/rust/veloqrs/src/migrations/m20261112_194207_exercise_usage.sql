-- Which exercises an athlete has done, ranked and followed.
--
-- `exercise_sets` was indexed by activity alone, so "which exercises have I
-- done and when" scanned every set. This index answers it by exercise.
CREATE INDEX IF NOT EXISTS idx_exercise_sets_exercise
    ON exercise_sets(exercise_category, exercise_name);

-- One row per exercise: its category, its name (-1 for a set that carries
-- none), the day it was last done, how many sessions used it, and the sum of
-- exp(-(last_done - session) / decay) over those sessions, which the reader
-- ages to the present.
CREATE TABLE IF NOT EXISTS exercise_usage (
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER NOT NULL,
    last_done INTEGER NOT NULL,
    score REAL NOT NULL,
    sessions INTEGER NOT NULL,
    PRIMARY KEY (exercise_category, exercise_name)
) WITHOUT ROWID;

-- How often one exercise followed another within a session.
CREATE TABLE IF NOT EXISTS exercise_followers (
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER NOT NULL,
    next_category INTEGER NOT NULL,
    next_name INTEGER NOT NULL,
    times INTEGER NOT NULL,
    PRIMARY KEY (exercise_category, exercise_name, next_category, next_name)
) WITHOUT ROWID;
