use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::{NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats};
use log::info;
use rusqlite::backup;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct VeloqEngine {
    #[allow(dead_code)]
    db_path: String,
}

#[uniffi::export]
impl VeloqEngine {
    #[uniffi::constructor]
    fn create(db_path: String) -> Arc<Self> {
        init_logging();

        let already = PERSISTENT_ENGINE
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);

        if !already {
            info!("[VeloqEngine] Initializing at {}", db_path);
            crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path.clone());
        }

        Arc::new(Self { db_path })
    }

    fn is_initialized(&self) -> bool {
        PERSISTENT_ENGINE
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_stats(&self) -> Result<PersistentEngineStats, VeloqError> {
        with_engine(|e| e.stats())
    }

    fn get_activity_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.activity_count() as u32)
    }

    fn clear(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear().map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Drop the persistent engine entirely, closing the SQLite connection.
    /// The next call to `create()` will re-initialize from scratch.
    fn destroy(&self) {
        if let Ok(mut guard) = PERSISTENT_ENGINE.lock() {
            info!("[VeloqEngine] Destroying persistent engine");
            *guard = None;
        }
    }

    fn cleanup_old_activities(&self, retention_days: u32) -> Result<u32, VeloqError> {
        with_engine(|e| {
            let count =
                e.cleanup_old_activities(retention_days)
                    .map_err(|e| VeloqError::Database {
                        msg: format!("{}", e),
                    })?;
            if retention_days > 0 && count > 0 {
                info!("[VeloqEngine] Cleanup: {} activities removed", count);
            }
            Ok(count)
        })?
    }

    fn mark_for_recomputation(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.mark_for_recomputation();
            info!("[VeloqEngine] Marked for re-computation");
        })
    }

    fn set_name_translations(&self, route_word: String, section_word: String) {
        if let Ok(mut translations) = NAME_TRANSLATIONS.write() {
            translations.route_word = route_word;
            translations.section_word = section_word;
        }
    }

    fn sections(&self) -> Arc<super::sections::SectionManager> {
        Arc::new(super::sections::SectionManager { _private: () })
    }

    fn activities(&self) -> Arc<super::activities::ActivityManager> {
        Arc::new(super::activities::ActivityManager { _private: () })
    }

    fn routes(&self) -> Arc<super::routes::RouteManager> {
        Arc::new(super::routes::RouteManager { _private: () })
    }

    fn maps(&self) -> Arc<super::maps::MapManager> {
        Arc::new(super::maps::MapManager { _private: () })
    }

    fn fitness(&self) -> Arc<super::fitness::FitnessManager> {
        Arc::new(super::fitness::FitnessManager { _private: () })
    }

    fn settings(&self) -> Arc<super::settings::SettingsManager> {
        Arc::new(super::settings::SettingsManager { _private: () })
    }

    fn detection(&self) -> Arc<super::detection::DetectionManager> {
        Arc::new(super::detection::DetectionManager { _private: () })
    }

    fn strength(&self) -> Arc<super::strength::StrengthManager> {
        Arc::new(super::strength::StrengthManager { _private: () })
    }

    fn heatmap(&self) -> Arc<super::tiles::HeatmapManager> {
        Arc::new(super::tiles::HeatmapManager { _private: () })
    }

    /// Create an atomic SQLite backup at the given path.
    /// Uses sqlite3_backup API — safe to call while the database is in use.
    fn backup_database(&self, dest_path: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            let mut dest =
                rusqlite::Connection::open(&dest_path).map_err(|e| VeloqError::Database {
                    msg: format!("Failed to open backup destination: {}", e),
                })?;
            let b = backup::Backup::new(&e.db, &mut dest).map_err(|e| VeloqError::Database {
                msg: format!("Failed to init backup: {}", e),
            })?;
            b.run_to_completion(100, std::time::Duration::from_millis(10), None)
                .map_err(|e| VeloqError::Database {
                    msg: format!("Backup failed: {}", e),
                })?;
            info!("[VeloqEngine] Database backed up to {}", dest_path);
            Ok(())
        })?
    }

    /// Get backup metadata as JSON for validation before restore.
    /// Returns: {"schema_version", "activity_count", "section_count", "athlete_id"}.
    fn get_backup_metadata(&self) -> Result<String, VeloqError> {
        with_engine(|e| {
            let stats = e.stats();
            let athlete_id: Option<String> = e
                .get_setting("__athlete_id")
                .ok()
                .flatten();
            let schema_version = e
                .db
                .query_row(
                    "SELECT value FROM schema_info WHERE key = 'schema_version'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "0".to_string());

            let metadata = serde_json::json!({
                "schema_version": schema_version,
                "activity_count": stats.activity_count,
                "section_count": stats.section_count,
                "gps_track_count": stats.gps_track_count,
                "oldest_date": stats.oldest_date,
                "newest_date": stats.newest_date,
                "athlete_id": athlete_id,
            });
            Ok(metadata.to_string())
        })?
    }

    /// Bulk export all activities with GPS data as a ZIP of GPX files.
    /// Streams one track at a time — constant memory regardless of activity count.
    fn bulk_export_gpx(&self, dest_path: String) -> Result<crate::persistence::export::BulkExportResult, VeloqError> {
        with_engine(|e| {
            e.bulk_export_gpx(&dest_path).map_err(|msg| VeloqError::Database { msg })
        })?
    }

    /// Bulk export all activities with GPS data as a single GeoJSON FeatureCollection.
    fn bulk_export_geojson(&self, dest_path: String) -> Result<crate::persistence::export::BulkExportResult, VeloqError> {
        with_engine(|e| {
            e.bulk_export_geojson(&dest_path).map_err(|msg| VeloqError::Database { msg })
        })?
    }
}
