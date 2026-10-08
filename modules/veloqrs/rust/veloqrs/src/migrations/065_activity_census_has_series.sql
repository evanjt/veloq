-- Migration 065: which activities without a GPS track still carry a series.
--
-- The stream backfill's queue found its activities through `gps_tracks`, so an
-- activity recorded without coordinates, a strength session with heart rate,
-- never had its series stored and its charts needed signal once the cached
-- body was evicted. The census pull already reads `stream_types` for
-- `has_latlng`, so this bit rides along at no extra cost and the queue can
-- take exactly the trackless activities upstream holds a series for, rather
-- than asking about every one of them.
--
-- Nothing backfills it. Every row reads 0 after the upgrade and the next
-- census pull rewrites the athlete's rows wholesale, as for `has_latlng`.
--
-- The index serves the queue's lookup by id, which carries no athlete, and
-- holds only the rows that lookup can match.

ALTER TABLE activity_census ADD COLUMN has_series INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_activity_census_trackless_series
    ON activity_census(intervals_id) WHERE has_series = 1 AND has_latlng = 0;
