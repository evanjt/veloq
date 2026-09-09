-- The untyped intervals.icu activity body, stored alongside activity_metrics.
--
-- activity_metrics models the fields Rust aggregates on. The activity list and
-- detail screens read many more (locality, calories, stream_types, weather,
-- skyline bytes). The body lives in its own table rather than a column on
-- activity_metrics because that table is written with INSERT OR REPLACE from
-- two paths, either of which would erase a column it does not know about.
--
-- Metadata-only: an activity with no GPS never reaches the `activities` table,
-- but it still belongs in the feed, so this table has no dependency on it.

CREATE TABLE IF NOT EXISTS activity_bodies (
    activity_id TEXT PRIMARY KEY,
    -- Start time as epoch seconds, so range queries do not parse JSON.
    date INTEGER NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_bodies_date ON activity_bodies(date DESC);
