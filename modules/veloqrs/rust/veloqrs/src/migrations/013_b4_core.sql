-- Migration 013: B4 core — durable identity + intent + read-path columns.
--
-- Phase 1 (this block): persist the B2 identity registries. The section and
-- route registries were in-memory pre-B4 (reseeded from the DB on open, which
-- loses the hysteresis debounce streaks and the tombstones a dissolved section
-- re-emerges under). A single blob per registry survives a restart intact. The
-- design (Part 5) persists the WHOLE serde state blob rather than a shredded
-- per-field store, so this is one row per registry keyed by name.
CREATE TABLE IF NOT EXISTS identity_state (
    key TEXT PRIMARY KEY,
    blob BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
