-- The original file of a ride no connector can serve again, deflated, beside
-- the rows decoded from it. One row per activity key. `raw_len` and `sha256`
-- describe the inflated bytes, so a read can tell a damaged body from the file.
CREATE TABLE IF NOT EXISTS ride_originals (
    activity_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    format TEXT NOT NULL,
    raw_len INTEGER NOT NULL,
    sha256 BLOB NOT NULL,
    body BLOB NOT NULL,
    kept_at INTEGER NOT NULL
);
