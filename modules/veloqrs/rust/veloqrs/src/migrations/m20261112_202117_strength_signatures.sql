-- The exercises a strength session used, as one comparable value.
--
-- `signature` is the sorted set of the session's exercises, each written
-- `category.name` (name -1 when a set carries none) and joined by commas, so two
-- sessions that did the same exercises in a different order share it. `done_at`
-- is the session's day, the activity's date else its first set's start.
--
-- Derived from `exercise_sets` and kept by the writers of those rows, like
-- `exercise_usage`. A session with no active set of a named exercise has no row.
CREATE TABLE IF NOT EXISTS strength_signatures (
    activity_id TEXT NOT NULL PRIMARY KEY,
    signature TEXT NOT NULL,
    done_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Lists the groups of sessions by signature, newest first, from the index alone.
CREATE INDEX IF NOT EXISTS idx_strength_signatures_group
    ON strength_signatures(signature, done_at);
