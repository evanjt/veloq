-- The activities intervals.icu holds but answers as an empty stub, kept
-- against the activity.
--
-- intervals.icu does not serve some activities to apps (a Garmin import is
-- the usual one) and answers a stub with every figure empty. The row marks
-- that activity so the queues that fetch streams and elevation leave it out
-- and its screen says why it is empty. It goes when a later list page serves
-- the activity in full.
--
-- One row per activity. Empty on every library from before the table, and
-- filled by the next sync that meets a stub.
CREATE TABLE activity_held_back (
    activity_id TEXT PRIMARY KEY,
    source TEXT,
    external_id TEXT
);
