-- What a native push run did, so a handset can say why the tray holds only the
-- placeholder.
--
-- The Android worker runs in a process with no JavaScript in it, so the run log
-- the Developer Dashboard shows, which AsyncStorage holds and the JavaScript
-- task writes, says nothing about a push the worker handled. The worker's own
-- outcomes were `info`, and a device build logs at `Warn`, so on a phone there
-- was no record of which gate ended a run at all.
--
-- The writer trims to the newest rows rather than a trigger doing it: the trim
-- is one DELETE beside the INSERT, and a trigger on insert would fire again on
-- its own delete.
CREATE TABLE push_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    activity_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT
);

CREATE INDEX idx_push_runs_ts ON push_runs(ts DESC, id DESC);
