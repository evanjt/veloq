-- The ground the retired sections map pairs on, worked out once by the
-- engine in the background rather than on every read.
--
-- `retired_ground_lines` holds a fingerprint of each line the stored pairs
-- were measured against, side 0 for a retired section's newest line and
-- side 1 for a catalogue row's. A line whose fingerprint no longer matches
-- is owed a rescan, and only its own pairs are measured again.
-- `retired_ground_pairs` holds every retired and current pair whose lines
-- share ground, with the larger coverage fraction.
--
-- Both start empty, so an upgraded library reads every line as owed until
-- the worker fills them. No existing row is touched.

CREATE TABLE IF NOT EXISTS retired_ground_lines (
    section_id TEXT NOT NULL,
    side INTEGER NOT NULL,
    fingerprint INTEGER NOT NULL,
    PRIMARY KEY (section_id, side)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS retired_ground_pairs (
    retired_id TEXT NOT NULL,
    current_id TEXT NOT NULL,
    overlap REAL NOT NULL,
    PRIMARY KEY (retired_id, current_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_retired_ground_pairs_current ON retired_ground_pairs(current_id);
