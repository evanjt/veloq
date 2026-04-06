-- Migration 021: Key-value settings table for user preferences
-- Consolidates AsyncStorage preferences into SQLite for single-file backup

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
