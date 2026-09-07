use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::persistent_engine_ffi::{BACKUP_HANDLE, BULK_EXPORT_HANDLE, CLEAR_HANDLE};
use crate::persistence::{
    DerivedClear, NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats, WorkerPoll,
};
use log::info;
use std::sync::Arc;

/// What a running or finished bulk export has done. `skipped` and
/// `total_bytes` are only meaningful once `state` reads "complete".
#[derive(Debug, Clone, uniffi::Record)]
pub struct BulkExportPoll {
    pub state: String,
    pub exported: u32,
    pub total: u32,
    pub skipped: u32,
    pub total_bytes: u64,
}

impl BulkExportPoll {
    fn idle() -> Self {
        BulkExportPoll {
            state: "idle".to_string(),
            exported: 0,
            total: 0,
            skipped: 0,
            total_bytes: 0,
        }
    }
}

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

    /// How the last init in this process ended.
    ///
    /// `is_initialized` says whether the engine is usable, which is what the
    /// caller needs to decide what to do next. This says why it is not, which
    /// is what the athlete needs to decide what to do about it.
    fn init_outcome(&self) -> crate::objects::init::FfiInitOutcome {
        crate::objects::init::last_init_outcome()
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

    /// Start the route/section wipe on a background thread. Poll
    /// `poll_clear_routes_and_sections` for the outcome.
    ///
    /// The wipe takes the engine write lock like any other writer, so unlike a
    /// backup it does not get its own connection. What moves off the calling
    /// thread is the wait: a 750-activity library takes 367 ms to wipe, and the
    /// caller is the settings toggle, so on the JS thread that is a switch the
    /// athlete flipped freezing the app.
    fn start_clear_routes_and_sections(&self) -> Result<(), VeloqError> {
        let mut guard = CLEAR_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return Err(VeloqError::Database {
                msg: "A clear is already running".to_string(),
            });
        }
        // No engine check here on purpose. Reading `PERSISTENT_ENGINE` takes
        // the read lock, which a live writer holds exclusively, so the check
        // would reintroduce exactly the wait this method exists to remove. A
        // missing engine comes back through the poll instead.
        *guard = Some(crate::persistence::clear_routes_and_sections_background());
        Ok(())
    }

    /// Poll the running wipe: "idle" | "running" | "complete". A failed or
    /// panicking wipe is an error, and either outcome clears the slot so the
    /// next toggle can start one.
    fn poll_clear_routes_and_sections(&self) -> Result<String, VeloqError> {
        let mut guard = CLEAR_HANDLE.lock().unwrap_or_else(|e| e.into_inner());

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
                    msg: "Clear thread died without a result".to_string(),
                })
            }
        }
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

    fn recordings(&self) -> Arc<super::recordings::RecordingManager> {
        Arc::new(super::recordings::RecordingManager { _private: () })
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

    /// Start a bulk export of every activity with GPS data, in `format`, on a
    /// background thread. Poll `poll_bulk_export` for progress and outcome.
    /// The file is written from a connection of its own, so neither the JS
    /// thread nor the engine's write lock waits for it.
    fn start_bulk_export(
        &self,
        format: crate::persistence::export::BulkExportFormat,
        dest_path: String,
    ) -> Result<(), VeloqError> {
        let mut guard = BULK_EXPORT_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return Err(VeloqError::Database {
                msg: "An export is already running".to_string(),
            });
        }
        let handle = with_engine(|e| e.bulk_export_background(format, &dest_path))?;
        *guard = Some(handle);
        Ok(())
    }

    /// Poll the running export. `state` is "idle" | "running" | "complete",
    /// and `exported` against `total` is what a progress bar reads while it
    /// runs. A failed export is an error, and either outcome clears the slot
    /// so the next export can start.
    fn poll_bulk_export(&self) -> Result<BulkExportPoll, VeloqError> {
        let mut guard = BULK_EXPORT_HANDLE.lock().unwrap_or_else(|e| e.into_inner());

        let Some(handle) = guard.as_ref() else {
            return Ok(BulkExportPoll::idle());
        };

        let (exported, total) = handle.progress();
        match handle.poll_state() {
            WorkerPoll::Running => Ok(BulkExportPoll {
                state: "running".to_string(),
                exported,
                total,
                skipped: 0,
                total_bytes: 0,
            }),
            WorkerPoll::Ready(Ok(result)) => {
                *guard = None;
                Ok(BulkExportPoll {
                    state: "complete".to_string(),
                    exported: result.exported,
                    total: result.exported,
                    skipped: result.skipped,
                    total_bytes: result.total_bytes,
                })
            }
            WorkerPoll::Ready(Err(msg)) => {
                *guard = None;
                Err(VeloqError::Database { msg })
            }
            WorkerPoll::Died => {
                *guard = None;
                Err(VeloqError::Database {
                    msg: "Export thread died without a result".to_string(),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::export::BulkExportFormat;
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

    /// Turning route matching off wipes the derived catalogue. Measured at a
    /// 750-activity library the wipe takes 367 ms, and it ran on the JS thread
    /// under the engine write lock, so a switch the athlete flipped froze the
    /// app for its duration.
    ///
    /// Expected behaviour: the start returns while another writer still holds
    /// the lock, so the caller never waits on the wipe; a second start is
    /// refused while one runs; and the poll carries the terminal state.
    #[test]
    fn the_clear_runs_off_the_calling_thread() {
        use std::sync::mpsc;
        use std::thread;
        use std::time::{Duration, Instant};

        /// Long enough that a caller which waited for the lock could not be
        /// mistaken for one that did not.
        const HOLD: Duration = Duration::from_millis(500);
        /// A start that took this long went through the lock, not around it.
        const START_BUDGET: Duration = Duration::from_millis(100);

        let _guard = serial_global_state();
        let _tmp = init_global_engine("clear.db");
        let engine = VeloqEngine;

        assert_eq!(
            engine.poll_clear_routes_and_sections().unwrap(),
            "idle",
            "nothing has started yet"
        );

        seed_activity("a1");

        let (holding, held) = mpsc::channel();
        let writer = thread::spawn(move || {
            with_persistent_engine(|_| {
                holding.send(()).ok();
                thread::sleep(HOLD);
            })
            .expect("engine");
        });
        held.recv().expect("the writer took the lock");

        let start = Instant::now();
        engine
            .start_clear_routes_and_sections()
            .expect("first start");
        let returned_in = start.elapsed();
        assert!(
            returned_in < START_BUDGET,
            "start blocked for {returned_in:?}, so it waited on the write lock"
        );

        assert!(
            engine.start_clear_routes_and_sections().is_err(),
            "a second clear started while the first was still running"
        );

        writer.join().expect("writer thread");

        let deadline = Instant::now() + Duration::from_secs(10);
        let terminal = loop {
            let state = engine.poll_clear_routes_and_sections().unwrap();
            if state != "running" {
                break state;
            }
            assert!(Instant::now() < deadline, "the clear never settled");
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(terminal, "complete");

        assert_eq!(
            engine.poll_clear_routes_and_sections().unwrap(),
            "idle",
            "the terminal poll clears the slot"
        );
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
        seed_activity("a1");

        let gpx = tmp.path().join("all.zip").to_string_lossy().into_owned();
        let result = with_engine(|e| e.bulk_export_gpx(&gpx)).unwrap().unwrap();
        assert_eq!(result.exported, 1);
        assert!(std::path::Path::new(&gpx).exists());

        let geojson = tmp
            .path()
            .join("all.geojson")
            .to_string_lossy()
            .into_owned();
        let result = with_engine(|e| e.bulk_export_geojson(&geojson))
            .unwrap()
            .unwrap();
        assert_eq!(result.exported, 1);
        assert!(
            std::fs::read_to_string(&geojson)
                .unwrap()
                .contains("FeatureCollection")
        );
    }
    /// Scenario: an export of a whole library runs while a sync holds the
    /// engine's write lock.
    /// Expected behaviour: it finishes anyway, because it reads from a
    /// connection of its own.
    #[test]
    fn an_export_finishes_while_the_engine_write_lock_is_held() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        assert_eq!(engine.poll_bulk_export().unwrap().state, "idle");

        let dest = tmp.path().join("all.zip").to_string_lossy().into_owned();
        engine
            .start_bulk_export(BulkExportFormat::Gpx, dest.clone())
            .unwrap();

        let poll = with_engine(|_| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            loop {
                let poll = engine.poll_bulk_export().unwrap();
                if poll.state != "running" {
                    return poll;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "the export must not wait on the engine write lock"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        })
        .unwrap();

        assert_eq!(poll.state, "complete");
        assert_eq!(poll.exported, 1);
        assert!(poll.total_bytes > 0);
        assert!(std::path::Path::new(&dest).exists());
        assert_eq!(
            engine.poll_bulk_export().unwrap().state,
            "idle",
            "a finished export clears its slot"
        );
    }

    #[test]
    fn a_second_export_is_refused_while_one_runs() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let dest = tmp.path().join("all.zip").to_string_lossy().into_owned();
        engine
            .start_bulk_export(BulkExportFormat::Gpx, dest.clone())
            .unwrap();
        let second = engine.start_bulk_export(
            BulkExportFormat::GeoJson,
            tmp.path()
                .join("all.geojson")
                .to_string_lossy()
                .into_owned(),
        );
        drain_export(&engine);
        assert!(
            second.is_err() || std::path::Path::new(&dest).exists(),
            "a second start while one runs is refused; one that lands after it is a fresh export"
        );
    }

    #[test]
    fn a_geojson_export_reports_its_counts_and_writes_the_collection() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let dest = tmp
            .path()
            .join("all.geojson")
            .to_string_lossy()
            .into_owned();
        engine
            .start_bulk_export(BulkExportFormat::GeoJson, dest.clone())
            .unwrap();
        let poll = drain_export(&engine);

        assert_eq!(poll.state, "complete");
        assert_eq!(poll.exported, 1);
        assert!(
            std::fs::read_to_string(&dest)
                .unwrap()
                .contains("FeatureCollection")
        );
    }

    /// An export of an empty library still terminates and still writes a file.
    #[test]
    fn an_export_with_nothing_to_write_completes() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;

        let dest = tmp.path().join("empty.zip").to_string_lossy().into_owned();
        engine
            .start_bulk_export(BulkExportFormat::Gpx, dest.clone())
            .unwrap();
        let poll = drain_export(&engine);

        assert_eq!(poll.state, "complete");
        assert_eq!(poll.exported, 0);
        assert_eq!(poll.total, 0);
        assert!(std::path::Path::new(&dest).exists());
    }

    /// A destination that cannot be created fails the poll rather than
    /// stranding the slot at "running" forever.
    #[test]
    fn an_unwritable_destination_fails_the_poll_and_frees_the_slot() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let dest = tmp
            .path()
            .join("no-such-directory")
            .join("all.zip")
            .to_string_lossy()
            .into_owned();
        engine
            .start_bulk_export(BulkExportFormat::Gpx, dest)
            .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            match engine.poll_bulk_export() {
                Ok(poll) if poll.state == "running" => {
                    assert!(std::time::Instant::now() < deadline, "export never failed");
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Ok(poll) => panic!("expected a failure, got {}", poll.state),
                Err(_) => break,
            }
        }
        assert_eq!(
            engine.poll_bulk_export().unwrap().state,
            "idle",
            "a failed export clears its slot"
        );
    }

    /// Poll until the export leaves "running", failing rather than hanging.
    fn drain_export(engine: &VeloqEngine) -> BulkExportPoll {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            let poll = engine.poll_bulk_export().expect("export failed");
            if poll.state != "running" {
                return poll;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "export never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
