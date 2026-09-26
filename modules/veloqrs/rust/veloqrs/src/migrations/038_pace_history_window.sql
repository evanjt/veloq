-- The window a pace snapshot was read over.
--
-- `pace_history` had two writers with different windows: the pace curve screen
-- wrote the critical speed of whatever range it was showing, 7 days to a year,
-- and the sync writes the 42-day curve. A year curve's critical speed is the
-- athlete's best year and a 42-day curve's is the last six weeks, so the pace
-- milestone compared two estimates of different things and called the
-- difference an improvement.
--
-- The window joins the key, so a screen row and a sync row stamped the same day
-- are two rows rather than one overwriting the other. SQLite cannot alter a
-- primary key, so the table is rebuilt.
--
-- Rows written before this column are of an unknown window and keep NULL. They
-- are not assumed to be the sync's: assuming is what the bug was, and the trend
-- leaves an unknown window out rather than comparing it with a known one. The
-- card is quiet for a sync or two and then correct.
CREATE TABLE pace_history_new (
    date INTEGER NOT NULL,
    sport_type TEXT NOT NULL,
    critical_speed REAL NOT NULL,
    d_prime REAL,
    r2 REAL,
    window_days INTEGER,
    PRIMARY KEY (date, sport_type, window_days)
);

INSERT INTO pace_history_new (date, sport_type, critical_speed, d_prime, r2, window_days)
SELECT date, sport_type, critical_speed, d_prime, r2, NULL FROM pace_history;

DROP TABLE pace_history;
ALTER TABLE pace_history_new RENAME TO pace_history;
CREATE INDEX idx_pace_history_sport_date ON pace_history(sport_type, date DESC);
