-- Activities the athlete hid from the heatmap.
--
-- A hidden activity stays in every list, statistic and section, and only the
-- heatmap leaves it out. The choice is the athlete's own and the activities
-- table is refilled by a sync, so it has a table of its own, keyed by the
-- activity id and not tied to the activity row.

CREATE TABLE IF NOT EXISTS heatmap_hidden_activities (
    activity_id TEXT PRIMARY KEY,
    hidden_at INTEGER NOT NULL
);
