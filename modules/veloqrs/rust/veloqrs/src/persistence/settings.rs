//! Settings: key-value storage for user preferences.
//!
//! Consolidates AsyncStorage preferences into SQLite so a single database
//! backup captures the complete app state.

use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::PersistentRouteEngine;

/// Reserved setting keys owned by Rust internals. The double-underscore
/// prefix distinguishes them from user-facing preferences set via
/// `SettingsManager.set_setting`. TS code should treat these as opaque.
pub mod settings_keys {
    /// Minimum match percentage threshold (f64 stored as decimal string).
    pub const MATCH_MIN_MATCH_PCT: &str = "__match_min_match_pct";
    /// Endpoint distance threshold in metres (f64 stored as decimal string).
    pub const MATCH_ENDPOINT_THRESHOLD: &str = "__match_endpoint_threshold";
}

impl PersistentRouteEngine {
    /// Get a single setting by key.
    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        self.db
            .query_row(
                "SELECT value FROM settings WHERE key = ?",
                params![key],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
    }

    /// Set a single setting (upsert).
    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?, ?, strftime('%s', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value],
        )?;
        Ok(())
    }

    /// Get all settings as a HashMap.
    pub fn get_all_settings(&self) -> SqlResult<HashMap<String, String>> {
        let mut stmt = self.db.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut settings = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            settings.insert(key, value);
        }
        Ok(settings)
    }

    /// Bulk upsert settings from a HashMap.
    pub fn set_all_settings(&self, settings: &HashMap<String, String>) -> SqlResult<()> {
        let mut stmt = self.db.prepare(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?, ?, strftime('%s', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )?;
        for (key, value) in settings {
            stmt.execute(params![key, value])?;
        }
        Ok(())
    }

    /// Delete a single setting.
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        self.db
            .execute("DELETE FROM settings WHERE key = ?", params![key])?;
        Ok(())
    }

    /// Apply persisted match-strictness overrides to the in-memory `match_config`.
    /// Called from `load()` so a fresh engine instance reflects the user's last
    /// chosen strictness without any TS round-trip. Missing or unparseable
    /// values silently fall back to whatever `match_config` already holds.
    pub(super) fn load_match_strictness_from_settings(&mut self) -> SqlResult<()> {
        if let Some(raw) = self.get_setting(settings_keys::MATCH_MIN_MATCH_PCT)? {
            if let Ok(v) = raw.parse::<f64>() {
                self.match_config.min_match_percentage = v;
            }
        }
        if let Some(raw) = self.get_setting(settings_keys::MATCH_ENDPOINT_THRESHOLD)? {
            if let Ok(v) = raw.parse::<f64>() {
                self.match_config.endpoint_threshold = v;
            }
        }
        Ok(())
    }
}
