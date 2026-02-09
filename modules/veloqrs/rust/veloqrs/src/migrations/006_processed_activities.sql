-- Migration 006: Track which activities have been through section detection.
-- Prevents re-processing activities that didn't match any section.

CREATE TABLE IF NOT EXISTS processed_activities (
    activity_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
