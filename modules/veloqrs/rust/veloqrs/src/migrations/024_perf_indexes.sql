-- M24: Performance indexes on read-hot query shapes.
--
-- 1. `section_activities` is queried heavily by section_id with filters on
--    `excluded` and `lap_time IS NOT NULL` to derive visit_count and
--    cached lap times. Today the only index on this table is
--    `idx_section_activities_activity` (the activity_id direction). Add a
--    composite covering the section direction + filter columns so the
--    common COUNT(*)/SELECT queries hit an index instead of scanning.
--
-- 2. `activity_metrics` is filtered by sport_type AND ordered by date
--    constantly (Routes screen, timerange selectors, feed pagination).
--    Today no index covers that combination. Add (sport_type, date DESC)
--    so the planner can satisfy both predicate and ORDER BY from the
--    index alone.

CREATE INDEX IF NOT EXISTS idx_section_activities_perf
    ON section_activities(section_id, excluded, lap_time);

CREATE INDEX IF NOT EXISTS idx_activity_metrics_sport_date
    ON activity_metrics(sport_type, date DESC);
