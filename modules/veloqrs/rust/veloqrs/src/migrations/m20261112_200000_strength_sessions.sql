-- Strength sessions recorded on the phone, and the workouts the athlete saved.
--
-- A phone-recorded session has no source but these rows until an upload lands,
-- and its side and groups never reach intervals.icu at all: the FIT set message
-- has no field for either. So they are the athlete's own and are not refilled
-- by a sync, unlike `exercise_sets`, which holds sets as a FIT file gave them.
--
-- `kind` is `live` for the session in progress, `finished` for a saved
-- recording and `saved` for a named workout started from later. A finished
-- session's done working sets are written to `exercise_sets` under
-- `activity_key`, the engine key of the ride the recording made, so the
-- strength screens read them as they read a watch's. `intervals_id` is the id
-- the upload gave that ride, which the later download of its FIT file is
-- matched against.
--
-- No row here names `activities` by a foreign key: a sync that removes and
-- stores an activity again must not take the athlete's session with it.

CREATE TABLE IF NOT EXISTS strength_sessions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    activity_key TEXT,
    intervals_id TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strength_sessions_activity_key
    ON strength_sessions(activity_key);
CREATE INDEX IF NOT EXISTS idx_strength_sessions_intervals_id
    ON strength_sessions(intervals_id);

-- A session's exercises in the order they sit. `exercise_category` and
-- `exercise_name` are the FIT profile's pair. `group_no` joins exercises done
-- together, and `rest_secs` is the rest planned after the exercise.
CREATE TABLE IF NOT EXISTS strength_session_exercises (
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER,
    group_no INTEGER,
    rest_secs INTEGER,
    PRIMARY KEY (session_id, position)
);

-- Planned values are what the athlete set before the session; reps, weight
-- and duration are what was done. `side` is kept here only.
CREATE TABLE IF NOT EXISTS strength_session_sets (
    session_id TEXT NOT NULL,
    exercise_position INTEGER NOT NULL,
    set_index INTEGER NOT NULL,
    reps INTEGER,
    weight_kg REAL,
    duration_secs REAL,
    side TEXT,
    warm_up INTEGER NOT NULL DEFAULT 0,
    planned_reps INTEGER,
    planned_weight_kg REAL,
    planned_duration_secs REAL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER,
    PRIMARY KEY (session_id, exercise_position, set_index)
);

-- The rest planned after a group of exercises.
CREATE TABLE IF NOT EXISTS strength_session_groups (
    session_id TEXT NOT NULL,
    group_no INTEGER NOT NULL,
    rest_secs INTEGER,
    PRIMARY KEY (session_id, group_no)
);

-- The rest periods as they happened.
CREATE TABLE IF NOT EXISTS strength_session_rests (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    started_at INTEGER,
    duration_secs REAL,
    PRIMARY KEY (session_id, seq)
);
