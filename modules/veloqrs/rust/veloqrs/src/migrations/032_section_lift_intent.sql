-- Migration 032: let a section intent say "this is not a lift".
--
-- `is_lift` is derived, not user state: the enrichment pass re-UPDATEs the
-- column from the detector's own answer on every run, so an unflag written to
-- the column comes back at the next detect. The durable record has to be a
-- section intent, which is the table that outlives a catalogue rebuild.
--
-- `kind` is CHECK-constrained, and widening a CHECK in SQLite is a
-- create-copy-drop-rename over live user intents. Every row is carried across,
-- so suppression, deletion and naming all survive.

DROP TABLE IF EXISTS section_intents_lift_shape;

CREATE TABLE section_intents_lift_shape (
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted', 'named', 'fixed', 'lift')),
    polyline_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT,
    sport_type TEXT,
    PRIMARY KEY (id, kind)
);

INSERT INTO section_intents_lift_shape (id, kind, polyline_json, created_at, name, sport_type)
    SELECT id, kind, polyline_json, created_at, name, sport_type FROM section_intents;

DROP TABLE section_intents;

ALTER TABLE section_intents_lift_shape RENAME TO section_intents;
