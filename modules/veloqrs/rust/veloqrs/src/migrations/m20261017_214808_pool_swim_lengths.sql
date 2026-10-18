-- A pool swim's lengths and pool length, read from its FIT file.
--
-- The FIT queue owed a download to strength sessions alone, so a swim's file
-- was never fetched and nothing held a length. A swim's verdict written before
-- this came from the strength parse, which reads no lengths, so it is cleared
-- and the swim is owed its file again, like every pool swim already held.

CREATE TABLE IF NOT EXISTS swim_lengths (
    activity_id TEXT NOT NULL,
    length_index INTEGER NOT NULL,
    start_time INTEGER,
    elapsed_secs REAL,
    timer_secs REAL,
    length_type INTEGER,
    swim_stroke INTEGER,
    total_strokes INTEGER,
    avg_speed REAL,
    PRIMARY KEY (activity_id, length_index)
);

CREATE TABLE IF NOT EXISTS pool_swims (
    activity_id TEXT PRIMARY KEY,
    pool_length_m REAL
);

DELETE FROM fit_file_status
WHERE activity_id IN (SELECT activity_id FROM activity_metrics WHERE sport_type = 'Swim');
