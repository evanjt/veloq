//! Settings: key-value storage for user preferences.
//!
//! Consolidates AsyncStorage preferences into SQLite so a single database
//! backup captures the complete app state.

use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::PersistentRouteEngine;

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
}
