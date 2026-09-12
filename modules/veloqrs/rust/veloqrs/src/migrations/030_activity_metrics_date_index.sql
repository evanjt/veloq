-- Migration 030: an index on activity_metrics(date) alone.
--
-- Every date-window aggregate here is a date-only predicate, and the only date
-- index leads with sport_type, which such a predicate cannot use. So the launch
-- path scanned the whole table once per window: twice for startup_data, four
-- times for insights_data, again for the home card, the widget and one per week
-- of the fitness cards. The MIN/MAX date range scanned a covering index instead,
-- which is the same walk. All of it is linear in the library for no reason.

CREATE INDEX IF NOT EXISTS idx_activity_metrics_date ON activity_metrics(date);
