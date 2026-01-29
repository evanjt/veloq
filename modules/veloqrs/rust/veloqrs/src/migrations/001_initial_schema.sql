-- Migration 001: Initial schema
-- Uses IF NOT EXISTS for compatibility with pre-migration databases

-- Activity metadata (always loaded)
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    sport_type TEXT NOT NULL,
    min_lat REAL NOT NULL,
    max_lat REAL NOT NULL,
    min_lng REAL NOT NULL,
    max_lng REAL NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    start_date INTEGER,
    name TEXT,
    distance_meters REAL,
    duration_secs INTEGER
);

-- Signatures stored separately (LRU cached)
CREATE TABLE IF NOT EXISTS signatures (
    activity_id TEXT PRIMARY KEY,
    points BLOB NOT NULL,
    start_point_lat REAL NOT NULL,
    start_point_lng REAL NOT NULL,
    end_point_lat REAL NOT NULL,
    end_point_lng REAL NOT NULL,
    total_distance REAL NOT NULL,
    point_count INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- Full GPS tracks (loaded on-demand only)
CREATE TABLE IF NOT EXISTS gps_tracks (
    activity_id TEXT PRIMARY KEY,
    track_data BLOB NOT NULL,
    point_count INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- Computed route groups (persisted)
CREATE TABLE IF NOT EXISTS route_groups (
    id TEXT PRIMARY KEY,
    representative_id TEXT NOT NULL,
    activity_ids TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    bounds_min_lat REAL,
    bounds_max_lat REAL,
    bounds_min_lng REAL,
    bounds_max_lng REAL
);

-- Custom route names (user-defined)
CREATE TABLE IF NOT EXISTS route_names (
    route_id TEXT PRIMARY KEY,
    custom_name TEXT NOT NULL
);

-- Per-activity match info within route groups
CREATE TABLE IF NOT EXISTS activity_matches (
    route_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    match_percentage REAL NOT NULL,
    direction TEXT NOT NULL,
    PRIMARY KEY (route_id, activity_id)
);

-- Activity metrics for performance calculations
CREATE TABLE IF NOT EXISTS activity_metrics (
    activity_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date INTEGER NOT NULL,
    distance REAL NOT NULL,
    moving_time INTEGER NOT NULL,
    elapsed_time INTEGER NOT NULL,
    elevation_gain REAL NOT NULL,
    avg_hr INTEGER,
    avg_power INTEGER,
    sport_type TEXT NOT NULL
);

-- Time streams for section performance calculations
CREATE TABLE IF NOT EXISTS time_streams (
    activity_id TEXT PRIMARY KEY,
    times BLOB NOT NULL,
    point_count INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- Overlap cache for section detection
CREATE TABLE IF NOT EXISTS overlap_cache (
    activity_a TEXT NOT NULL,
    activity_b TEXT NOT NULL,
    has_overlap INTEGER NOT NULL,
    overlap_data BLOB,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (activity_a, activity_b)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
CREATE INDEX IF NOT EXISTS idx_activities_bounds ON activities(min_lat, max_lat, min_lng, max_lng);
CREATE INDEX IF NOT EXISTS idx_groups_sport ON route_groups(sport_type);
CREATE INDEX IF NOT EXISTS idx_activity_matches_route ON activity_matches(route_id);
CREATE INDEX IF NOT EXISTS idx_overlap_cache_a ON overlap_cache(activity_a);
CREATE INDEX IF NOT EXISTS idx_overlap_cache_b ON overlap_cache(activity_b);

-- Enable foreign keys
PRAGMA foreign_keys = ON;
