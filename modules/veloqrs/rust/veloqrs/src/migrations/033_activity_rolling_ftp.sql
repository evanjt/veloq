-- Migration 033: the activities that moved the athlete's accepted eFTP.
--
-- intervals.icu reports the rolling value and the change an activity made to
-- it, and the sync already asks for the pair, but only the stored body carried
-- them. The fitness plot's markers were derived in TypeScript from the parsed
-- body of every activity in the window.
--
-- A marker table rather than two columns on `activity_metrics`: the row there
-- is written whole by two paths, one of which is a TypeScript caller that does
-- not carry these fields and would empty them on every replace.
--
-- Empty until the next sync, which rewrites its window in full on every run,
-- so the markers fill in on the first sync after the upgrade.

CREATE TABLE IF NOT EXISTS eftp_changes (
    activity_id TEXT PRIMARY KEY,
    date INTEGER NOT NULL,
    eftp REAL NOT NULL,
    delta REAL NOT NULL,
    activity_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eftp_changes_date ON eftp_changes(date);
