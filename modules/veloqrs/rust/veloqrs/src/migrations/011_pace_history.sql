-- Migration 011: Pace history cache for trend tracking
-- Stores critical speed snapshots for running and swimming pace trends

CREATE TABLE IF NOT EXISTS pace_history (
    date INTEGER NOT NULL,
    sport_type TEXT NOT NULL,
    critical_speed REAL NOT NULL,
    d_prime REAL,
    r2 REAL,
    PRIMARY KEY (date, sport_type)
);
CREATE INDEX idx_pace_history_sport_date ON pace_history(sport_type, date DESC);
