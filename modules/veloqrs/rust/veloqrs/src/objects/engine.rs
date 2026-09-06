use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::persistent_engine_ffi::BACKUP_HANDLE;
use crate::persistence::{
    DerivedClear, NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats, WorkerPoll,
};
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

    /// Register the listener Rust calls when work finishes off the JavaScript
    /// thread. One per process; a second call replaces the first.
    fn set_observer(&self, observer: Option<Arc<dyn crate::objects::observer::EngineObserver>>) {
        crate::objects::observer::set_observer(observer);
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

    /// Empty what the engine can re-derive and keep what the athlete made:
    /// the clear-cache button's database half.
    fn clear_derived_data(&self) -> Result<DerivedClear, VeloqError> {
        with_engine(|e| {
            e.clear_derived().map_err(|e| VeloqError::Database {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};
    use crate::with_persistent_engine;
    use tracematch::GpsPoint;

    fn seed_activity(id: &str) {
        with_persistent_engine(|e| {
            let track: Vec<GpsPoint> = (0..8)
                .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
                .collect();
            e.add_activity(id.to_string(), track, "Ride".into())
                .expect("add activity");
            e.update_activity_metadata(
                id,
                Some(1_700_000_000),
                Some("ride"),
                Some(1000.0),
                Some(600),
            )
            .expect("metadata");
        })
        .expect("engine");
    }

    #[test]
    fn create_on_a_live_engine_keeps_it_and_destroy_drops_it() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        seed_activity("a1");

        let engine =
            VeloqEngine::create(tmp.path().join("other.db").to_string_lossy().into_owned());
        assert!(engine.is_initialized());
        assert_eq!(
            engine.get_activity_count().unwrap(),
            1,
            "a second create must not reopen"
        );

        engine.destroy();
        assert!(!engine.is_initialized());
        assert!(matches!(
            engine.get_activity_count(),
            Err(VeloqError::NotInitialized)
        ));
        assert!(matches!(
            engine.get_stats(),
            Err(VeloqError::NotInitialized)
        ));
    }

    #[test]
    fn create_opens_a_database_when_none_is_live() {
        let _guard = serial_global_state();
        let tmp = tempfile::TempDir::new().unwrap();
        VeloqEngine::create(tmp.path().join("fresh.db").to_string_lossy().into_owned()).destroy();
        let engine =
            VeloqEngine::create(tmp.path().join("fresh.db").to_string_lossy().into_owned());
        assert!(engine.is_initialized());
        assert_eq!(engine.get_activity_count().unwrap(), 0);
        engine.destroy();
    }

    #[test]
    fn stats_counts_and_backfill_list_read_through_the_object() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        assert_eq!(engine.get_stats().unwrap().activity_count, 0);
        assert!(
            engine
                .get_activities_needing_time_streams()
                .unwrap()
                .is_empty()
        );

        seed_activity("a1");
        let stats = engine.get_stats().unwrap();
        assert_eq!(stats.activity_count, 1);
        assert_eq!(stats.gps_track_count, 1);
        // The backfill list is section activities without a time stream, so an
        // activity no section holds is not on it.
        assert!(
            engine
                .get_activities_needing_time_streams()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn the_three_clears_remove_what_they_say() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        seed_activity("a2");

        engine.clear_routes_and_sections().unwrap();
        assert_eq!(engine.get_activity_count().unwrap(), 2);

        // A synced activity is re-derivable, so the derived clear takes it and
        // keeps only what a section still references.
        let derived = engine.clear_derived_data().unwrap();
        assert_eq!(derived.activities_removed, 2);
        assert_eq!(derived.activities_kept, 0);
        assert_eq!(derived.sections_removed, 0);
        assert_eq!(engine.get_activity_count().unwrap(), 0);

        seed_activity("a3");
        engine.clear().unwrap();
        assert_eq!(engine.get_activity_count().unwrap(), 0);
        engine.mark_for_recomputation().unwrap();
    }

    #[test]
    fn name_translations_are_written_to_the_shared_words() {
        let engine = VeloqEngine;
        engine.set_name_translations("Strecke".into(), "Abschnitt".into());
        let words = NAME_TRANSLATIONS.read().unwrap();
        assert_eq!(words.route_word, "Strecke");
        assert_eq!(words.section_word, "Abschnitt");
        drop(words);
        engine.set_name_translations("Route".into(), "Section".into());
    }

    #[test]
    fn every_manager_hangs_off_the_engine() {
        let engine = VeloqEngine;
        let _ = engine.sections();
        let _ = engine.activities();
        let _ = engine.routes();
        let _ = engine.maps();
        let _ = engine.fitness();
        let _ = engine.settings();
        let _ = engine.detection();
        let _ = engine.strength();
        let _ = engine.heatmap();
        let _ = engine.sync();
    }

    #[test]
    fn backup_runs_once_at_a_time_and_reports_its_metadata() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        assert_eq!(engine.poll_backup().unwrap(), "idle");

        let dest = tmp.path().join("backup.db").to_string_lossy().into_owned();
        engine.start_backup(dest.clone()).unwrap();
        let second = engine.start_backup(dest.clone());
        let mut state = engine.poll_backup().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while state == "running" {
            assert!(
                std::time::Instant::now() < deadline,
                "backup never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
            state = engine.poll_backup().unwrap();
        }
        assert_eq!(state, "complete");
        assert!(
            second.is_err() || std::path::Path::new(&dest).exists(),
            "a second start while one runs is refused; one that lands after it is a fresh backup"
        );
        assert!(std::path::Path::new(&dest).exists());
        assert_eq!(
            engine.poll_backup().unwrap(),
            "idle",
            "a finished backup clears its slot"
        );

        let metadata: serde_json::Value =
            serde_json::from_str(&engine.get_backup_metadata().unwrap()).unwrap();
        assert_eq!(metadata["activity_count"], 1);
        assert_eq!(metadata["gps_track_count"], 1);
        assert_ne!(metadata["schema_version"], "0");
        assert!(metadata["athlete_id"].is_null());
    }

    #[test]
    fn bulk_exports_write_a_file_per_format() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let gpx = tmp.path().join("all.zip").to_string_lossy().into_owned();
        let result = engine.bulk_export_gpx(gpx.clone()).unwrap();
        assert_eq!(result.exported, 1);
        assert!(std::path::Path::new(&gpx).exists());

        let geojson = tmp
            .path()
            .join("all.geojson")
            .to_string_lossy()
            .into_owned();
        let result = engine.bulk_export_geojson(geojson.clone()).unwrap();
        assert_eq!(result.exported, 1);
        assert!(
            std::fs::read_to_string(&geojson)
                .unwrap()
                .contains("FeatureCollection")
        );
    }
}
