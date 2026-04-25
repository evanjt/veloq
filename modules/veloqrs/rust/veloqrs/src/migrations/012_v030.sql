-- Migration 012: Consolidated 0.2.2 → 0.3.0 schema upgrade.
--
-- Merges what were 14 incremental development migrations into a single
-- atomic step. Covers: section trimming, outlier exclusion, aerobic
-- efficiency tracking, FIT-file exercise sets, section visibility,
-- settings consolidation, activity indicators, wellness persistence,
-- hot-path indexes, and incremental consensus state.

-- Section columns
ALTER TABLE sections ADD COLUMN original_polyline_json TEXT;
ALTER TABLE sections ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sections ADD COLUMN superseded_by TEXT DEFAULT NULL;
ALTER TABLE sections ADD COLUMN consensus_state_blob BLOB;

-- Outlier exclusion flags (soft-hide without deletion)
ALTER TABLE section_activities ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_activities ADD COLUMN avg_hr REAL;

-- Route activity exclusion
ALTER TABLE activity_matches ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;

-- Exercise set data from FIT files
CREATE TABLE IF NOT EXISTS exercise_sets (
    activity_id TEXT NOT NULL,
    set_order INTEGER NOT NULL,
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER,
    set_type INTEGER NOT NULL,
    repetitions INTEGER,
    weight_kg REAL,
    duration_secs REAL,
    start_time INTEGER,
    PRIMARY KEY (activity_id, set_order)
);

CREATE TABLE IF NOT EXISTS fit_file_status (
    activity_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL,
    has_sets INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exercise_sets_activity ON exercise_sets(activity_id);

-- Section visibility indexes
CREATE INDEX IF NOT EXISTS idx_sections_disabled ON sections(disabled);
CREATE INDEX IF NOT EXISTS idx_sections_superseded ON sections(superseded_by);

-- Key-value settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Materialized activity indicators for PR/trend badges
CREATE TABLE IF NOT EXISTS activity_indicators (
    activity_id TEXT NOT NULL,
    indicator_type TEXT NOT NULL CHECK(indicator_type IN (
        'section_pr', 'route_pr', 'section_trend', 'route_trend'
    )),
    target_id TEXT NOT NULL,
    target_name TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT 'same',
    lap_time REAL,
    trend INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (activity_id, indicator_type, target_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_activity_indicators_activity ON activity_indicators(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_indicators_target ON activity_indicators(target_id);

-- Wellness data
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

-- Composite indexes on hot read paths
CREATE INDEX IF NOT EXISTS idx_section_activities_perf
    ON section_activities(section_id, excluded, lap_time);

CREATE INDEX IF NOT EXISTS idx_activity_metrics_sport_date
    ON activity_metrics(sport_type, date DESC);

-- Force section re-detection with improved lap splitting and cross-sport filtering
DELETE FROM processed_activities;
