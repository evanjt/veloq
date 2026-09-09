-- The Unified detector's per-cluster evidence, so a restart does not
-- cold-rebatch the whole pool to reach the catalogue already in SQLite.
--
-- One row. `config_digest` is the config the cache was folded under: a
-- config change makes the row a miss rather than a lie. `cache` and
-- `folded_ids` move together and mean nothing apart, so they share a row.
CREATE TABLE IF NOT EXISTS evidence_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_digest TEXT NOT NULL,
    folded_ids BLOB NOT NULL,
    cache BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
