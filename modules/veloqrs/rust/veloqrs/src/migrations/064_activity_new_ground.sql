-- How much of each activity's ground no earlier activity had covered.
--
-- Ground is the set of z17 tiles an activity's track touches. `tiles` counts
-- them and `new_tiles` counts the ones no activity with an earlier start
-- touched, so the fraction is derived at read and never stored. A row of zero
-- tiles is an activity whose track holds no readable point: measured, with no
-- fraction. An activity's value depends on every activity before it, so the
-- table is rewritten whole by one pass and an activity with a stored track and
-- no row is the sign the pass is owed.
--
-- Empty on upgrade: the rows are a backfill.

CREATE TABLE activity_new_ground (
    activity_id TEXT NOT NULL PRIMARY KEY,
    tiles INTEGER NOT NULL,
    new_tiles INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
) WITHOUT ROWID;
