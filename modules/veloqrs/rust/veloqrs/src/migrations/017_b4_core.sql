-- Migration 017: B4 core — durable identity + intent + read-path columns.
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
-- Ground truth (behavioural probe): rusqlite's bundled SQLite defaults foreign
-- keys ON per connection, so enforcement is live for FRESH and REOPENED engines
-- alike — the activity_id cascade fires at runtime for existing users too, not
-- only for the fresh install that ran migration 001's explicit PRAGMA.
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

-- The Phase 3 visit_count column + its recompute triggers are added by the
-- post-migration Rust hook `ensure_visit_count_denormalisation` rather than here:
-- SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and this file is run
-- verbatim and repeatedly by migration_017_is_rerunnable, so a bare ADD COLUMN
-- would fail the second pass. The hook is pragma-guarded and idempotent, and it
-- runs after the junction rebuild so the triggers bind the rebuilt table.

-- The gps_tracks.elevation_state column (0 unknown, 1 fetched, 2 unavailable
-- upstream) belongs to this version and is added the same way, by the hook
-- `ensure_gps_track_elevation_state`, for the same re-runnability reason. It
-- records whether an activity's stored points carry elevation, so a backfill is
-- resumable and detection can be gated on the library being uniformly elevated:
-- a partly elevated library vetoes genuine climbs as lifts, because a track
-- without elevation can mint a lift candidate but can never rescue one.

-- Phase 2: durable suppression records for user-disabled and user-deleted
-- corridors (invariant 6: evidence is permanent, sections are views; a
-- user-hidden or user-removed corridor must NOT re-emerge from detection, ever,
-- while ground evidence keeps counting). The per-save section wipe cannot hold
-- this intent: a disabled auto row is is_user_defined=0 and a deleted row is
-- gone, so both would be re-detected and re-emerge. The ground lives here, in a
-- table the wipe never touches, and the identity emitter drops any fresh
-- candidate whose ground matches a row here (the same suppression that already
-- spares custom/accepted grounds, generalised to hide intent). `kind` separates
-- a re-enableable hide from a permanent delete; `id` is the section id at intent
-- time, kept for dedup and so enable can clear its own row. Survives restart
-- because it is read fresh from the DB on every detect, needing no in-memory state.
--
-- kind = 'named' rows are the third intent class: a corridor name is permanent
-- user data keyed to ground, not to a catalogue row. The footprint records what
-- the user named; the name is resolved at read time onto whichever visible
-- section best covers it. Named rows carry a minted `ni_` id (never a section
-- id), NEVER suppress detection (the emitter reads suppression grounds from
-- disabled/deleted rows only), and outlive every catalogue rebuild.
--
-- The key is (id, kind): one section carries at most one intent PER kind, so
-- intents of different kind on the same ground coexist instead of overwriting
-- one another.
--
-- kind = 'fixed' is the reserved user-pinned class. It sits in the CHECK from
-- the start because widening a CHECK costs a create-copy-drop-rename over live
-- user intents.
CREATE TABLE IF NOT EXISTS section_intents (
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted', 'named', 'fixed')),
    polyline_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT,
    sport_type TEXT,
    PRIMARY KEY (id, kind)
);

-- D4: section history, versioned geometry, and pins. All three key on the
-- durable real section id with NO foreign key to sections: that table is
-- wipe-managed per save, and history must outlive any catalogue rebuild —
-- events are kept forever, geometry versions survive a re-cut of the row
-- they describe. Ships dark: the D5 emitter writes these rows.

-- One row per lifecycle event (re-cut, split, merge, dissolve, restore,
-- pin, ...). `kind` vocabulary and `details` payload shape belong to the
-- emitter; `geometry_version` names the section_geometry row in force
-- after the event when it changed geometry.
CREATE TABLE IF NOT EXISTS section_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL,
    details TEXT,
    geometry_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_section_history_section
    ON section_history(section_id, at);
-- Catalogue-wide reads walk the ledger by time, across sections: "what
-- happened since the last sync", and the backdated baseline row an upgrade
-- writes. The composite index above leads on section_id and cannot serve them.
CREATE INDEX IF NOT EXISTS idx_section_history_at
    ON section_history(at);

-- Versioned polylines. encoding 1 = quantised zigzag-varint stream
-- (codec.rs encode_polyline: 1e-6 deg, 0.1 m elevation, ~3 B/point on the
-- measured corpora vs ~62 B/point JSON). Versions are independent — each
-- row decodes alone, no delta chains — so a revert needs no chain walk
-- and a quarantine salvage cannot lose a version to a torn predecessor.
-- Retention on write: version 1 (birth geometry), milestones, the pinned
-- version, and the newest three always survive; other versions are pruned.
--
-- A section's line is one contiguous range of one real activity, so the
-- (rep_activity_id, rep_start_index, rep_end_index) triple is the truth and the
-- blob is a decoded cache of it. The triple is nullable because a corridor-era
-- version is an averaged consensus line belonging to no single activity.
--
-- `source` says which of the two a version is. 'exact' means the triple is
-- present and re-slicing the stored stream reproduces the blob byte for byte;
-- 'consensus' is an averaged line no activity carries, so the triple stays
-- NULL; 'orphaned' means the representative activity is gone and the blob is
-- the last honest picture. NULL is unstated provenance, read as not-exact.
-- Readers take the blob for anything that is not 'exact' with a triple.
CREATE TABLE IF NOT EXISTS section_geometry (
    section_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    encoding INTEGER NOT NULL DEFAULT 1,
    blob BLOB NOT NULL,
    milestone INTEGER NOT NULL DEFAULT 0,
    rep_activity_id TEXT,
    rep_start_index INTEGER,
    rep_end_index INTEGER,
    source TEXT CHECK(source IS NULL OR source IN ('exact', 'consensus', 'orphaned')),
    PRIMARY KEY (section_id, version)
);

-- Revert = pin at version: the user freezes a section at a stored
-- geometry. Separate from section_intents (a pin is not a suppression and
-- must not enter the emitter's intent reads); one pin per section.
CREATE TABLE IF NOT EXISTS section_pins (
    section_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
