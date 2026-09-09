-- The recording index, moved off AsyncStorage.
--
-- It was one JSON key rewritten whole under a promise chain, because two
-- writers reading the same snapshot silently dropped a recording that has no
-- server copy to fall back on. A row per recording gives that for free.
--
-- The FIT and the streams sidecar stay on the filesystem: this table holds
-- where they are and what the upload has done, not their bytes.
CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    fit_path TEXT NOT NULL,
    streams_path TEXT,
    activity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    distance_meters REAL NOT NULL,
    elevation_gain REAL,
    avg_heartrate REAL,
    paired_event_id INTEGER,
    created_at INTEGER NOT NULL,
    upload_status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_error TEXT,
    intervals_activity_id TEXT,
    engine_activity_id TEXT
);

-- The library lists newest first, and the upload processor walks the pending
-- ones. Both are the whole table today, and neither stays small forever.
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_upload_status ON recordings(upload_status);
