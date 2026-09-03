//! Settings: key-value storage for user preferences.
//!
//! Consolidates AsyncStorage preferences into SQLite so a single database
//! backup captures the complete app state.

use rusqlite::{Result as SqlResult, params};

use super::PersistentEngine;

/// Reserved setting keys owned by Rust internals. The double-underscore
/// prefix distinguishes them from user-facing preferences set via
/// `SettingsManager.set_setting`. TS code should treat these as opaque.
pub mod settings_keys {
    /// Minimum match percentage threshold (f64 stored as decimal string).
    pub const MATCH_MIN_MATCH_PCT: &str = "__match_min_match_pct";
    /// Endpoint distance threshold in metres (f64 stored as decimal string).
    pub const MATCH_ENDPOINT_THRESHOLD: &str = "__match_endpoint_threshold";

    /// SectionConfig.proximity_threshold in metres (f64 stored as decimal string).
    pub const SECTION_PROXIMITY_THRESHOLD: &str = "__section_proximity_threshold";
    /// SectionConfig.min_section_length in metres (f64 stored as decimal string).
    pub const SECTION_MIN_LENGTH: &str = "__section_min_length";
    /// SectionConfig.min_activities (u32 stored as decimal string).
    pub const SECTION_MIN_ACTIVITIES: &str = "__section_min_activities";
    /// The WHOLE SectionConfig as a JSON blob. The individual keys above persist
    /// the strictness-slider fields; this captures every field so a restart
    /// restores the EXACT config that was last set. Without it the load path
    /// rebuilds `default()` + the four slider fields, and the TS launch re-apply
    /// (which spreads the current config and re-sets whatever it holds) then
    /// reads as a genuine change every boot, clearing the processed set and
    /// renumbering every section. Preferred by the loader; the individual keys remain as a
    /// pre-blob-install fallback.
    pub const SECTION_CONFIG_JSON: &str = "__section_config_json";
}

impl PersistentEngine {
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

    /// Mirror of `load_match_strictness_from_settings` for `section_config`.
    /// Missing or unparseable values fall back to the default SectionConfig
    /// fields already in place (set during `PersistentEngine::new`).
    pub(super) fn load_section_config_from_settings(&mut self) -> SqlResult<()> {
        // Prefer the whole-config blob: it restores EVERY field, so the TS launch
        // re-apply of the same preset compares equal and no-ops (no re-detect, no
        // section renumber). Fall back to the individual slider keys below for
        // installs written before the blob key existed.
        if let Some(json) = self.get_setting(settings_keys::SECTION_CONFIG_JSON)? {
            match serde_json::from_str::<tracematch::SectionConfig>(&json) {
                Ok(cfg) => {
                    self.section_config = cfg;
                    return Ok(());
                }
                Err(e) => log::warn!(
                    "veloqrs: [load_section_config] config blob unparseable, falling back to slider keys: {}",
                    e
                ),
            }
        }

        if let Some(raw) = self.get_setting(settings_keys::SECTION_PROXIMITY_THRESHOLD)? {
            if let Ok(v) = raw.parse::<f64>() {
                self.section_config.proximity_threshold = v;
            }
        }
        if let Some(raw) = self.get_setting(settings_keys::SECTION_MIN_LENGTH)? {
            if let Ok(v) = raw.parse::<f64>() {
                self.section_config.min_section_length = v;
            }
        }
        if let Some(raw) = self.get_setting(settings_keys::SECTION_MIN_ACTIVITIES)? {
            if let Ok(v) = raw.parse::<u32>() {
                self.section_config.min_activities = v;
            }
        }
        Ok(())
    }
}
