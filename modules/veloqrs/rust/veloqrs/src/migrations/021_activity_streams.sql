-- Migration 021: durable per-activity stream store.
--
-- `stream_bodies` is a cache of raw server payloads with a ceiling. This is
-- the store the athlete sizes: one row per activity and series, packed with
-- the quantised codec, held for as long as the retention window says.

CREATE TABLE IF NOT EXISTS activity_streams (
    activity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data BLOB NOT NULL,
    sample_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (activity_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_activity_streams_activity
    ON activity_streams(activity_id);
