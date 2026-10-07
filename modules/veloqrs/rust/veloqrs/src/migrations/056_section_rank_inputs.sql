-- Migration 056: the relevance ranking's per-section inputs, kept as a running summary.
--
-- Ranking sections for the insights cards scored every traversal of every
-- section on each read. `section_rank_inputs` holds what that score needs from
-- the history, one row per section and sport, so the read scores rows and
-- reads laps only for the sections it keeps. `section_rank_dirty` names the
-- sections whose rows no longer match their traversals: the triggers
-- add to it on any write that can change a score, the engine recomputes those
-- rows when a write commits, and a read recomputes any still named there.
--
-- The triggers are made by `ensure_section_rank_triggers` on every open, not here: the
-- rebuilds of `sections` and `section_activities` drop the triggers on them, and a
-- trigger body that names a table a rebuild has dropped fails the rename.
--
-- Every section starts dirty, so the first write after the upgrade fills the
-- table and a read before it is still exact.

CREATE TABLE section_rank_inputs (
    section_id TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    traversal_count INTEGER NOT NULL,
    last_date INTEGER NOT NULL,
    improvement_score REAL NOT NULL,
    improvement_change REAL,
    improvement_basis INTEGER,
    anomaly_score REAL NOT NULL,
    best_time_secs REAL NOT NULL,
    best_date REAL,
    median_recent_secs REAL NOT NULL,
    trend INTEGER NOT NULL,
    latest_is_pr INTEGER NOT NULL,
    PRIMARY KEY (section_id, sport_type)
) WITHOUT ROWID;

CREATE TABLE section_rank_dirty (
    section_id TEXT PRIMARY KEY
) WITHOUT ROWID;

-- The same for an activity whose date, sport or metrics row changed: the
-- sections it was ridden in are found when the mark is read, so the triggers
-- on those tables need not name the junction.
CREATE TABLE section_rank_dirty_activity (
    activity_id TEXT PRIMARY KEY
) WITHOUT ROWID;

INSERT INTO section_rank_dirty (section_id) SELECT id FROM sections;
