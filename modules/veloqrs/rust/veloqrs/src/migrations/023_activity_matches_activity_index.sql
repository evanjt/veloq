-- The section-to-route join reads activity_matches by activity, which the
-- route-keyed primary key cannot serve.
CREATE INDEX IF NOT EXISTS idx_activity_matches_activity ON activity_matches(activity_id, route_id);
