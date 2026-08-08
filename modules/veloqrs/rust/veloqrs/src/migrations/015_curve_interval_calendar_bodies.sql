-- On-demand intervals.icu payloads: power and pace curves, activity intervals,
-- and calendar events.
--
-- Each is stored as its untyped body under the parameters that produced it,
-- because the screens read fields no Rust type models and a curve is only
-- meaningful alongside the sport, window and gap flag it was computed for.

CREATE TABLE IF NOT EXISTS curve_bodies (
    -- 'power' or 'pace'
    kind TEXT NOT NULL,
    sport TEXT NOT NULL,
    days INTEGER NOT NULL,
    -- Gradient-adjusted pace. Always 0 for power curves.
    gap INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (kind, sport, days, gap)
);

CREATE TABLE IF NOT EXISTS interval_bodies (
    activity_id TEXT PRIMARY KEY,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS calendar_event_bodies (
    event_id TEXT PRIMARY KEY,
    -- Event day as epoch seconds, so range queries do not parse JSON.
    date INTEGER NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_bodies_date ON calendar_event_bodies(date);
