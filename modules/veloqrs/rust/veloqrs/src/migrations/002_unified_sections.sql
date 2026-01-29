-- Migration 002: Unified sections table (auto + custom)
-- Note: Legacy blob-based sections are migrated in Rust code BEFORE this runs

CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    section_type TEXT NOT NULL CHECK(section_type IN ('auto', 'custom')),
    name TEXT,
    sport_type TEXT NOT NULL,
    polyline_json TEXT NOT NULL,
    distance_meters REAL NOT NULL,
    representative_activity_id TEXT,

    -- Auto-specific fields (nullable for custom)
    confidence REAL,
    observation_count INTEGER,
    average_spread REAL,
    point_density_json TEXT,
    scale TEXT,
    version INTEGER DEFAULT 1,
    is_user_defined INTEGER DEFAULT 0,
    stability REAL,

    -- Custom-specific fields (nullable for auto)
    source_activity_id TEXT,
    start_index INTEGER,
    end_index INTEGER,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

-- Junction table for section-activity relationships
CREATE TABLE IF NOT EXISTS section_activities (
    section_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    PRIMARY KEY (section_id, activity_id),
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_section_activities_activity ON section_activities(activity_id);
CREATE INDEX IF NOT EXISTS idx_sections_type ON sections(section_type);
CREATE INDEX IF NOT EXISTS idx_sections_sport ON sections(sport_type);
