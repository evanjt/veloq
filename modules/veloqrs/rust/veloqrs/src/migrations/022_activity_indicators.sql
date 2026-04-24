-- M22: Materialized activity indicators table for PR and trend badges.
-- Pre-computed after sync/detection so feed card rendering is a simple table read.
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
