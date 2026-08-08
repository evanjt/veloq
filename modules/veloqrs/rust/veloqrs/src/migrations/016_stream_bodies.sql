-- Untyped activity stream payloads, fetched when a chart or map asks for them.
--
-- Streams are the largest thing intervals.icu returns (100-500KB per activity),
-- so this is a bounded cache rather than a mirror: the sync never prefetches
-- them, and `prune_stream_bodies` keeps only the most recently read ones.

CREATE TABLE IF NOT EXISTS stream_bodies (
    activity_id TEXT NOT NULL,
    -- The requested series, comma-joined and sorted. A latlng-only preview and
    -- a full chart pull are different payloads for the same activity.
    types TEXT NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (activity_id, types)
);

CREATE INDEX IF NOT EXISTS idx_stream_bodies_updated ON stream_bodies(updated_at);
