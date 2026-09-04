use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::persistent_engine_ffi::BACKUP_HANDLE;
use crate::persistence::{NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats, WorkerPoll};
use log::info;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct VeloqEngine;

#[uniffi::export]
impl VeloqEngine {
    #[uniffi::constructor]
    fn create(db_path: String) -> Arc<Self> {
        init_logging();

        let already = PERSISTENT_ENGINE
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();

        if !already {
            info!("[VeloqEngine] Initialising at {}", db_path);
            crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path);
        }

        Arc::new(Self)
    }

    fn is_initialized(&self) -> bool {
        PERSISTENT_ENGINE
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    fn get_stats(&self) -> Result<PersistentEngineStats, VeloqError> {
        with_engine(|e| e.stats())
    }

    fn get_activity_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.activity_count() as u32)
    }

    /// Get activity IDs that need time streams fetched (have NULL lap_time, no time_stream).
    /// Used for one-time backfill after upgrade.
    fn get_activities_needing_time_streams(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activities_needing_time_streams())
    }

    fn clear(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear().map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Clear only route/section data, keeping GPS tracks and activities.
    /// Used when route matching is toggled off.
    fn clear_routes_and_sections(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear_routes_and_sections()
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Drop the persistent engine entirely, closing the SQLite connection.
    /// The next call to `create()` will re-initialise from scratch.
    fn destroy(&self) {
        let mut guard = PERSISTENT_ENGINE.write().unwrap_or_else(|e| e.into_inner());
        info!("[VeloqEngine] Destroying persistent engine");
        *guard = None;
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

    fn sync(&self) -> Arc<super::sync::SyncManager> {
        Arc::new(super::sync::SyncManager { _private: () })
    }

    /// Start an atomic SQLite backup at the given path on a background thread.
    /// Poll `poll_backup` for the outcome. The copy runs on its own connection,
    /// so neither the engine lock nor the calling thread waits for it.
    fn start_backup(&self, dest_path: String) -> Result<(), VeloqError> {
        let mut guard = BACKUP_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return Err(VeloqError::Database {
                msg: "A backup is already running".to_string(),
            });
        }
        let handle = with_engine(|e| e.backup_database_background(&dest_path))?;
        *guard = Some(handle);
        Ok(())
    }

    /// Poll the running backup: "idle" | "running" | "complete". A failed copy
    /// is an error, and either outcome clears the slot so the next backup can
    /// start.
    fn poll_backup(&self) -> Result<String, VeloqError> {
        let mut guard = BACKUP_HANDLE.lock().unwrap_or_else(|e| e.into_inner());

        let Some(handle) = guard.as_ref() else {
            return Ok("idle".to_string());
        };

        match handle.poll_state() {
            WorkerPoll::Running => Ok("running".to_string()),
            WorkerPoll::Ready(Ok(())) => {
                *guard = None;
                Ok("complete".to_string())
            }
            WorkerPoll::Ready(Err(msg)) => {
                *guard = None;
                Err(VeloqError::Database { msg })
            }
            WorkerPoll::Died => {
                *guard = None;
                Err(VeloqError::Database {
                    msg: "Backup thread died without a result".to_string(),
                })
            }
        }
    }

    /// Get backup metadata as JSON for validation before restore.
    /// Returns: {"schema_version", "activity_count", "section_count", "athlete_id"}.
    fn get_backup_metadata(&self) -> Result<String, VeloqError> {
        with_engine(|e| {
            let stats = e.stats();
            let athlete_id: Option<String> = e.get_setting("__athlete_id").ok().flatten();
            let schema_version =
                e.db.query_row(
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
    /// Streams one track at a time - constant memory regardless of activity count.
    fn bulk_export_gpx(
        &self,
        dest_path: String,
    ) -> Result<crate::persistence::export::BulkExportResult, VeloqError> {
        with_engine(|e| {
            e.bulk_export_gpx(&dest_path)
                .map_err(|msg| VeloqError::Database { msg })
        })?
    }

    /// Bulk export all activities with GPS data as a single GeoJSON FeatureCollection.
    fn bulk_export_geojson(
        &self,
        dest_path: String,
    ) -> Result<crate::persistence::export::BulkExportResult, VeloqError> {
        with_engine(|e| {
            e.bulk_export_geojson(&dest_path)
                .map_err(|msg| VeloqError::Database { msg })
        })?
    }
}
