-- Migration 005: Athlete profile and sport settings cache tables
-- These store JSON blobs from the intervals.icu API for instant startup rendering.

CREATE TABLE IF NOT EXISTS athlete_profile (
    id TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_settings (
    id TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
