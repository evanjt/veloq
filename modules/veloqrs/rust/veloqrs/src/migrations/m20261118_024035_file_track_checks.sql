-- How many records an imported file of a synced ride holds against how many the
-- server holds, kept against the ride.
--
-- The intervals of a ride address the server's own samples, so a file stands in
-- for the ride's track only where its record count is the server's, which is
-- where its last interval ends. A row is written when a file of a ride the
-- library holds is read. `server_records` is empty until an interval body is
-- stored for the ride. `supplied` says the ride's track and series are the
-- file's. A file whose count differs from a known server count is not used, and
-- a track a file supplied is dropped when a later interval body disagrees, so
-- the download is owed again.
--
-- One row per activity. Empty on every library from before the table.
CREATE TABLE file_track_checks (
    activity_id TEXT PRIMARY KEY,
    file_records INTEGER NOT NULL,
    server_records INTEGER,
    supplied INTEGER NOT NULL DEFAULT 0
);
