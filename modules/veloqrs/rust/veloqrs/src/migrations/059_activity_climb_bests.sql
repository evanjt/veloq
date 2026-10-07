-- Each climbing activity's best window per length, kept beside the activity.
--
-- The climb curve reads the best vertical speed of every window length over a
-- sport's history. Measuring it on demand differentiated every stored track on
-- each read. `activity_climb_bests` holds one row per activity and window length,
-- written whenever the activity's track or time stream lands, so the read takes
-- a maximum per window over these rows. A window the activity cannot measure
-- has no row. W/kg is derived from `vam` at read and is not stored.
--
-- Empty on upgrade: rows for activities stored before this table are a backfill.

CREATE TABLE activity_climb_bests (
    activity_id TEXT NOT NULL,
    window_s INTEGER NOT NULL,
    start_idx INTEGER NOT NULL,
    end_idx INTEGER NOT NULL,
    vam REAL NOT NULL,
    PRIMARY KEY (activity_id, window_s),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
) WITHOUT ROWID;
