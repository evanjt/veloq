-- Migration 013: B4 core — durable identity + intent + read-path columns.
--
-- Phase 1 (this block): persist the B2 identity registries. The section and
-- route registries were in-memory pre-B4 (reseeded from the DB on open, which
-- loses the hysteresis debounce streaks and the tombstones a dissolved section
-- re-emerges under). A single blob per registry survives a restart intact. The
-- design (Part 5) persists the WHOLE serde state blob rather than a shredded
-- per-field store, so this is one row per registry keyed by name.
CREATE TABLE IF NOT EXISTS identity_state (
    key TEXT PRIMARY KEY,
    blob BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 2: cascade a removed activity out of the section junction.
--
-- remove_activity runs DELETE FROM activities and leans on a foreign-key cascade
-- to purge that activity's section_activities rows, but the junction only had the
-- section_id FK. So a deleted ride left a phantom member behind: an inflated
-- visit_count and a performance record for a GPS track that no longer exists.
-- SQLite cannot ADD a constraint to a live table, so rebuild it with the second
-- cascade. foreign_keys defaults ON on this connection (so it is ON here — the
-- whole migration is one transaction, where a PRAGMA toggle would be a no-op), so
-- the copy FILTERS orphans rather than aborting the insert on one. That filter
-- also cleans any phantom rows an earlier remove_activity already stranded.
--
-- Re-runnable by design: the DROP … _rebuild guard makes a repeat run rebuild
-- from whatever section_activities currently is and land on the same both-FK
-- table. Nothing references section_activities inbound, so the DROP/RENAME sets
-- off no cascade of its own.
DROP TABLE IF EXISTS section_activities_rebuild;

CREATE TABLE section_activities_rebuild (
    section_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'same',
    start_index INTEGER NOT NULL DEFAULT 0,
    end_index INTEGER NOT NULL DEFAULT 0,
    distance_meters REAL NOT NULL DEFAULT 0,
    lap_time REAL,
    lap_pace REAL,
    excluded INTEGER NOT NULL DEFAULT 0,
    avg_hr REAL,
    PRIMARY KEY (section_id, activity_id, start_index),
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

INSERT INTO section_activities_rebuild
    (section_id, activity_id, direction, start_index, end_index,
     distance_meters, lap_time, lap_pace, excluded, avg_hr)
SELECT section_id, activity_id, direction, start_index, end_index,
       distance_meters, lap_time, lap_pace, excluded, avg_hr
FROM section_activities
WHERE section_id IN (SELECT id FROM sections)
  AND activity_id IN (SELECT id FROM activities);

DROP TABLE section_activities;
ALTER TABLE section_activities_rebuild RENAME TO section_activities;

CREATE INDEX IF NOT EXISTS idx_section_activities_activity
    ON section_activities(activity_id);
CREATE INDEX IF NOT EXISTS idx_section_activities_perf
    ON section_activities(section_id, excluded, lap_time);
