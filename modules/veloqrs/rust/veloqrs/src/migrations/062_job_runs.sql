-- Each background job's last run: when it finished, how it ended and what it
-- handled and changed.
--
-- The phases a job reports while running are process-global and start at idle
-- on every launch, and `job_attempts` forgets a key once its work lands, so
-- nothing durable said what the last run did. One row per job, replaced on each
-- run, so the table never holds more than one row for each job there is.
--
-- The counts are columns rather than a serialised blob, so a reader never
-- parses. A job leaves at zero the counts it has no measure of.
CREATE TABLE IF NOT EXISTS job_runs (
    -- detection, elevationBackfill, streamBackfill or cutover.
    job TEXT NOT NULL PRIMARY KEY,

    -- When the run finished, in epoch milliseconds.
    finished_at INTEGER NOT NULL,

    -- complete, partial, failed, paused or stopped.
    outcome TEXT NOT NULL,

    -- Items the run took on.
    handled INTEGER NOT NULL DEFAULT 0,

    added INTEGER NOT NULL DEFAULT 0,
    changed INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0
);
