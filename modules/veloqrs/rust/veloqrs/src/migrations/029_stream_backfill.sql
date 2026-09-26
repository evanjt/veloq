-- Migration 029: what the stream backfill has already asked about.
--
-- The backfill's queue is derived from `activity_streams` being empty for an
-- activity, so an activity upstream carries no extra series for would be
-- offered by every pass for the life of the install. This table is the only
-- durable record that it was asked, and the count is what retires it.

CREATE TABLE IF NOT EXISTS activity_stream_backfill (
    activity_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
