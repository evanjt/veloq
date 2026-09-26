-- Migration 034: what intervals.icu says the athlete's history holds.
--
-- The census pull already spans all history in one request, and its rows were
-- reduced to a list of ids, used once to drop activities that left the account
-- and then thrown away. Nothing durable said which activities exist upstream,
-- so a launch had to assume it held none of them and re-download a fixed
-- window.
--
-- This is the upstream side of that answer and nothing else: what the server
-- said, when the activity was created and when it last changed there. Whether
-- the device has it is the `activities` table's answer, and the diff of the
-- two is what a sync fetches.
--
-- Keyed on the athlete as well as the activity, so signing in as a second
-- athlete cannot read the first one's coverage.
--
-- Empty until the next sync, which pulls the whole census on every run.

CREATE TABLE IF NOT EXISTS activity_census (
    athlete_id TEXT NOT NULL,
    intervals_id TEXT NOT NULL,
    start_date_local TEXT,
    created TEXT,
    icu_sync_date TEXT,
    census_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (athlete_id, intervals_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_census_date
    ON activity_census(athlete_id, start_date_local);
