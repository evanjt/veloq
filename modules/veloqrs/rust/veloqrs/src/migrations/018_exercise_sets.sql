-- Migration 018: Exercise set data from FIT files for strength training activities

CREATE TABLE IF NOT EXISTS exercise_sets (
    activity_id TEXT NOT NULL,
    set_order INTEGER NOT NULL,
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER,
    set_type INTEGER NOT NULL,
    repetitions INTEGER,
    weight_kg REAL,
    duration_secs REAL,
    start_time INTEGER,
    PRIMARY KEY (activity_id, set_order)
);

-- Track which activities have had their FIT files processed
CREATE TABLE IF NOT EXISTS fit_file_status (
    activity_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL,
    has_sets INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exercise_sets_activity ON exercise_sets(activity_id);
