-- What each linked browser changed in the library, newest last.
--
-- One row per write the phone accepted from a browser, kept for the athlete
-- to read and pruned to the most recent rows on insert. A row goes with the
-- browser that made it. Empty on every library from before the table.
CREATE TABLE remote_writes (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES linked_devices(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    target_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    at INTEGER NOT NULL
);

CREATE INDEX idx_remote_writes_device ON remote_writes(device_id, id);
