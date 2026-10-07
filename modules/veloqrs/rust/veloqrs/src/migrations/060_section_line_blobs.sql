-- Migration 060: a trimmed section's original line and a section intent's
-- footprint are stored through the quantised codec, as every other point list.
--
-- Both lines were JSON text. Rows an older build wrote keep their JSON and are
-- read through it until they are next written; nothing is rewritten here.
--
-- `section_intents.polyline_json` was NOT NULL, and relaxing a constraint in
-- SQLite is a create-copy-drop-rename over live user intents. Every row is
-- carried across, so suppression, deletion, naming and lift flags all survive.

ALTER TABLE sections ADD COLUMN original_polyline_blob BLOB;

DROP TABLE IF EXISTS section_intents_line_blob;

CREATE TABLE section_intents_line_blob (
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted', 'named', 'fixed', 'lift')),
    polyline_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT,
    sport_type TEXT,
    polyline_blob BLOB,
    PRIMARY KEY (id, kind)
);

INSERT INTO section_intents_line_blob (id, kind, polyline_json, created_at, name, sport_type)
    SELECT id, kind, polyline_json, created_at, name, sport_type FROM section_intents;

DROP TABLE section_intents;

ALTER TABLE section_intents_line_blob RENAME TO section_intents;
