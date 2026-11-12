-- Curves worked out on the phone from a ride's own streams.
--
-- `activity_curves` holds one activity's best figure at each standard
-- duration (power) or distance (pace), so a library curve over any window is
-- the best of the rides in it without reading a stream again. The library
-- curve itself is a `curve_bodies` row in the server body's shape, and
-- `source` says whose it is: 'intervals' for a body the server sent, 'veloq'
-- for one worked out here. A library with an intervals.icu account never
-- holds a 'veloq' row, and a server body is never replaced by one.
--
-- Both are empty on every library from before the tables, and every existing
-- curve body reads as the server's.
CREATE TABLE activity_curves (
    activity_id TEXT NOT NULL,
    -- 'power' or 'pace'
    kind TEXT NOT NULL,
    -- The best figures at the standard durations or distances, packed.
    points BLOB NOT NULL,
    PRIMARY KEY (activity_id, kind),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

ALTER TABLE curve_bodies ADD COLUMN source TEXT NOT NULL DEFAULT 'intervals';
