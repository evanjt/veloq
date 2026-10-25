-- The Garmin activities that matched more than one intervals.icu activity.
--
-- A Garmin original is linked to the intervals.icu activity that holds it.
-- When the match is ambiguous nothing is linked, and the row is recorded here
-- so nothing offers it to an upload while the question is open. It goes when a
-- later pass links the row or finds no candidate left.
--
-- One row per Garmin activity, with how many candidates matched. Empty on
-- every library from before the table.
CREATE TABLE garmin_link_unresolved (
    activity_id TEXT PRIMARY KEY,
    candidates INTEGER NOT NULL
);
