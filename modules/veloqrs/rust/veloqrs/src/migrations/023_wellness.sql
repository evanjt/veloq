-- Migration 023: Wellness data persisted in SQLite
-- Unlocks Rust-side aggregation (sparklines, HRV trend) for hooks that
-- previously iterated over API-fetched wellness arrays in TS.
--
-- Fields match the intervals.icu /wellness endpoint; fields not yet
-- consumed by Rust atomics (sleepScore, soreness, etc.) can be added
-- in a later migration without breaking callers.

CREATE TABLE IF NOT EXISTS wellness (
    -- ISO-8601 YYYY-MM-DD day key (matches WellnessData.id in TS)
    date TEXT PRIMARY KEY,
    -- Training load metrics (either ctl/atl or ctlLoad/atlLoad depending on
    -- the intervals.icu athlete's settings — TS callers already coalesce
    -- these, so we store whichever is provided in the single column).
    ctl REAL,
    atl REAL,
    ramp_rate REAL,
    -- Recovery + vitals
    hrv REAL,
    resting_hr REAL,
    weight REAL,
    sleep_secs INTEGER,
    sleep_score REAL,
    -- Self-report (0-5 intervals.icu scale)
    soreness INTEGER,
    fatigue INTEGER,
    stress INTEGER,
    mood INTEGER,
    motivation INTEGER,
    -- Cache bookkeeping
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_wellness_date_desc ON wellness(date DESC);
