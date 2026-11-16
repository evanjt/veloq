-- The heart rate readings taken while a strength session was live, one row a
-- second at most. They are the athlete's own like the rest of the session,
-- and a gap in the readings is a gap in the rows.

CREATE TABLE IF NOT EXISTS strength_session_heart_rate (
    session_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    bpm INTEGER NOT NULL,
    PRIMARY KEY (session_id, at)
);
