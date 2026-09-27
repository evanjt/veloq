use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::persistent_engine_ffi::CLEAR_ALL_HANDLE;
use crate::persistence::{
    DerivedClear, NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats, WorkerPoll,
};
use log::info;
use std::sync::Arc;

/// What the clear-cache wipe removed.
#[derive(Debug, Clone, uniffi::Record)]
pub struct DerivedClearCounts {
    pub sections_removed: u32,
    pub activities_removed: u32,
    pub activities_kept: u32,
}

/// One wipe of each kind at a time.
///
/// The flag is cleared by the wipe itself rather than by the caller's future,
/// because the two part company: a caller gives up at its own ceiling and the
/// wipe carries on, and the next caller has to be refused until the wipe, not
/// the wait, is over.
static CLEAR_CATALOGUE_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static CLEAR_DERIVED_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static BACKUP_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BULK_EXPORT_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// What the running export has written, for the progress read to find. Held
/// beside the flag rather than in the handle, which the awaiting task owns.
static BULK_EXPORT_PROGRESS: std::sync::Mutex<
    Option<std::sync::Arc<crate::persistence::export::BulkExportProgress>>,
> = std::sync::Mutex::new(None);

/// A claim on a job slot, released when the work ends however it ends.
struct InFlight(&'static std::sync::atomic::AtomicBool);

impl InFlight {
    /// The slot, or the refusal the caller shows.
    fn claim(
        flag: &'static std::sync::atomic::AtomicBool,
        taken: &str,
    ) -> Result<Self, VeloqError> {
        use std::sync::atomic::Ordering;
        if flag.swap(true, Ordering::SeqCst) {
            return Err(VeloqError::Database {
                msg: taken.to_string(),
            });
        }
        Ok(InFlight(flag))
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Whether a job slot is still held by a worker that is running, reaping it
/// when it is not.
///
/// A finished worker's result sits in its channel until something polls it,
/// and only the poll exports do. Every JS caller polls behind a deadline and
/// stops when the deadline runs out, so one copy that outlived five minutes
/// left the slot occupied for the life of the process and every later start
/// refused. The auto-backup path swallows that refusal, so the athlete got no
/// backups and no message until relaunch.
///
/// Reaping discards the outcome, which is right: the only caller of the poll
/// is the deadline that already gave up on it.
fn slot_still_running<H>(guard: &mut Option<H>, running: impl FnOnce(&H) -> bool) -> bool {
    let still = guard.as_ref().is_some_and(running);
    if !still {
        *guard = None;
    }
    still
}

/// Ask every running job to stop, without waiting for any of them.
///
/// Called before the engine goes away. Each is a latch the worker reads
/// between stages, so this returns immediately and the workers wind down on
/// their own.
fn cancel_every_job() {
    if let Some(handle) = crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        handle.request_cancel();
    }
    if let Some(handle) = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        handle.cancel();
    }
    crate::persistence::cancel_tile_sweeps();
    crate::objects::sync::SYNC_SERVICE.request_cancel();
}

/// What an export has written so far. Read on a timer while one runs, which is
/// what a progress bar is: an event per activity would park the writing thread
/// on the JS thread once per file.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBulkExportProgress {
    /// Whether an export is running at all.
    pub running: bool,
    /// Activities written so far, and how many it expects to visit.
    pub exported: u32,
    pub total: u32,
}

/// What a finished bulk export wrote.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBulkExportResult {
    pub exported: u32,
    pub skipped: u32,
    pub total_bytes: f64,
}

/// What a running or finished bulk export has done. `skipped` and
/// `total_bytes` are only meaningful once `state` reads "complete".
#[derive(Debug, Clone, uniffi::Record)]
pub struct BulkExportPoll {
    pub state: String,
    pub exported: u32,
    pub total: u32,
    pub skipped: u32,
    pub total_bytes: f64,
}

#[derive(uniffi::Object)]
pub struct VeloqEngine;

#[uniffi::export]
impl VeloqEngine {
    #[uniffi::constructor]
    fn create(db_path: String) -> Arc<Self> {
        init_logging();

        let already = PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();

        if !already {
            info!("[VeloqEngine] Initialising at {}", db_path);
            crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path);
        }

        Arc::new(Self)
    }

    /// Take whatever a push handler wrote while the app was away, and say
    /// whether there was anything to take.
    ///
    /// Call it on the foreground transition. On iOS the notification service
    /// extension is a second process against the same App Group database: it
    /// fetches a body, stores a track, writes the metrics row and indexes the
    /// activity, and a foreground engine that stayed alive through it holds
    /// tiers that predate all of it. Nothing else notices, because the rows
    /// are committed and this engine simply never re-reads them.
    ///
    /// False is the common resume and costs one `SELECT`. True means the tiers
    /// were replaced, which on the S22's own library is 23.9 ms of the 100 ms a
    /// transition gets, so it blocks the JavaScript thread rather than
    /// reporting progress. The screens re-read after it, as they do after any
    /// other change.
    fn take_external_writes(&self) -> bool {
        crate::persistence::with_persistent_engine(|engine| engine.take_external_writes())
            .unwrap_or(false)
    }

    /// Register the listener Rust calls when work finishes off the JavaScript
    /// thread. One per process; a second call replaces the first.
    ///
    /// Required rather than `Option`, because the binding lowers an optional
    /// through its byte cursor, and that path never consults the handle map a
    /// JavaScript implementation lives in: `setObserver` threw "Cannot lower
    /// this object to a pointer" on every launch from the generator upgrade on
    /// 2026-09-15 until 2026-09-20, and every screen ran deaf. A bare object
    /// goes through `lower`, which does. Clearing is its own method.
    fn set_observer(&self, observer: Arc<dyn crate::objects::observer::EngineObserver>) {
        crate::objects::observer::set_observer(Some(observer));
    }

    /// Drop the registered listener. Nothing calls it today, it exists so the
    /// register method can take a bare object.
    fn clear_observer(&self) {
        crate::objects::observer::set_observer(None);
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
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    fn get_stats(&self) -> Result<PersistentEngineStats, VeloqError> {
        with_engine(|e| e.stats())
    }

    /// What each recent native push run did, newest first, for the Developer
    /// Dashboard.
    ///
    /// Off the read pool rather than the engine lock: it is a diagnostic
    /// opened while the foreground is live, and it answers `[]` on an install
    /// that has had no push rather than refusing.
    fn push_runs(&self) -> Vec<crate::push::FfiPushRun> {
        crate::push::runs::recent()
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

    /// Wipe the routes and sections, resolving when the wipe is done.
    ///
    /// The wipe takes the engine write lock like any other writer, so unlike a
    /// backup it does not get its own connection. What moves off the calling
    /// thread is the wait: a 750-activity library takes 367 ms to wipe, and the
    /// caller is the settings toggle, so on the JS thread that is a switch the
    /// athlete flipped freezing the app.
    ///
    /// The ceiling stays with the caller. A screen that gives up at its own
    /// deadline leaves the wipe running, which is what the counts on the next
    /// read will reflect, and a second call is refused until it ends.
    ///
    /// No engine check before the wipe starts, on purpose: reading
    /// `PERSISTENT_ENGINE` takes the read lock, which a live writer holds
    /// exclusively, so the check would reintroduce the wait this exists to
    /// remove. A missing engine comes back as the error the wipe reports.
    async fn run_clear_routes_and_sections(&self) -> Result<(), VeloqError> {
        let slot = InFlight::claim(&CLEAR_CATALOGUE_IN_FLIGHT, "A clear is already running")?;
        let handle = crate::persistence::clear_routes_and_sections_background();
        // Detached on purpose: the blocking task outlives an abandoned future,
        // so a caller that gave up does not take the wipe with it.
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle.wait();
                drop(slot);
                outcome
            })
            .await
            .unwrap_or_else(|e| Err(format!("Clear thread died without a result: {e}")))
            .map_err(|msg| VeloqError::Database { msg })
    }

    /// Wipe everything the engine can re-derive, resolving with what went.
    ///
    /// 734 ms on a 750-activity library, the worst of the three wipes, and it
    /// sits behind the clear-cache button. Same shape as the catalogue wipe
    /// above, ceiling and refusal included.
    async fn run_clear_derived(&self) -> Result<DerivedClearCounts, VeloqError> {
        let slot = InFlight::claim(&CLEAR_DERIVED_IN_FLIGHT, "A clear is already running")?;
        let handle = crate::persistence::clear_derived_background();
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle.wait();
                drop(slot);
                outcome
            })
            .await
            .unwrap_or_else(|e| Err(format!("Clear thread died without a result: {e}")))
            .map(|cleared| DerivedClearCounts {
                sections_removed: cleared.sections_removed,
                activities_removed: cleared.activities_removed,
                activities_kept: cleared.activities_kept,
            })
            .map_err(|msg| VeloqError::Database { msg })
    }

    /// Start the whole-database wipe on a Rust thread. Refuses while one runs.
    ///
    /// The caller re-opens the engine once this completes, so the poll is what
    /// keeps the re-open ordered after the wipe rather than racing it.
    ///
    /// The heatmap tiles under `heatmap_tiles_path` go with it, whether or not
    /// this engine has the heatmap on: the path is set only when the heatmap
    /// turns on, and the login screen wipes before that.
    fn start_clear_all(&self, heatmap_tiles_path: String) -> Result<(), VeloqError> {
        let mut guard = CLEAR_ALL_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
        if slot_still_running(&mut guard, |h| {
            matches!(h.poll_state(), WorkerPoll::Running)
        }) {
            return Err(VeloqError::Database {
                msg: "A clear is already running".to_string(),
            });
        }
        *guard = Some(crate::persistence::clear_all_background(Some(
            heatmap_tiles_path,
        )));
        Ok(())
    }

    /// Poll the running whole-database wipe: "idle" | "running" | "complete".
    fn poll_clear_all(&self) -> Result<String, VeloqError> {
        let mut guard = CLEAR_ALL_HANDLE.lock().unwrap_or_else(|e| e.into_inner());

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
    ///
    /// Every running job is asked to stop first. Nothing here waits for them:
    /// a cancel is cooperative and read between stages, so a worker already
    /// past its last check still finishes, and a detection that finishes
    /// after this applies into whatever database is open by then. What the
    /// cancel buys is that a job with any of its work left ahead of it stops
    /// before reaching the new library, which is the window the restore path
    /// opens when it calls this and then `initWithPath` on the restored file.
    fn destroy(&self) {
        cancel_every_job();
        let mut guard = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
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

    /// Everything launch does to the engine once the library's identity is
    /// settled, in one call.
    ///
    /// The name translations, the heatmap toggle, the athlete id, an activity
    /// count and the stats the date-range store opens from were five calls
    /// taken one after another before first paint. Each is under a millisecond
    /// against a real library, so what this saves is four takes of the engine
    /// lock rather than a payload. The translations are a process global and
    /// take none.
    fn launch_data(
        &self,
        route_word: String,
        section_word: String,
        athlete_id: Option<String>,
        heatmap_tiles_path: Option<String>,
    ) -> Result<PersistentEngineStats, VeloqError> {
        self.set_name_translations(route_word, section_word);
        with_engine(|e| e.launch_data(athlete_id, heatmap_tiles_path))
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

    /// One backup at a time.
    ///
    /// The slot is the copy's, not the waiter's: a caller that gives up at its
    /// own ceiling leaves the copy running, and the next caller is refused
    /// until the copy ends rather than until somebody reads its outcome.
    async fn run_backup(&self, dest_path: String) -> Result<(), VeloqError> {
        let slot = InFlight::claim(&BACKUP_IN_FLIGHT, "A backup is already running")?;
        let handle = with_engine(|e| e.backup_database_background(&dest_path))?;
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle
                    .recv_blocking()
                    .unwrap_or_else(|| Err("Backup thread died without a result".to_string()));
                drop(slot);
                outcome
            })
            .await
            .unwrap_or_else(|e| Err(format!("Backup thread died without a result: {e}")))
            .map_err(|msg| VeloqError::Database { msg })
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

    /// Write every activity to one file, resolving with what it wrote.
    ///
    /// The export is minutes of work on a whole library and runs on its own
    /// thread and connection. The ceiling is the caller's: a screen that stops
    /// waiting says the export is still running, and `bulk_export_progress`
    /// is what its progress bar reads in the meantime.
    async fn run_bulk_export(
        &self,
        format: crate::persistence::export::BulkExportFormat,
        dest_path: String,
    ) -> Result<FfiBulkExportResult, VeloqError> {
        let slot = InFlight::claim(&BULK_EXPORT_IN_FLIGHT, "An export is already running")?;
        let handle = with_engine(|e| e.bulk_export_background(format, &dest_path))?;
        *BULK_EXPORT_PROGRESS
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle.progress_handle());

        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle
                    .recv_blocking()
                    .unwrap_or_else(|| Err("Export thread died without a result".to_string()));
                *BULK_EXPORT_PROGRESS
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = None;
                drop(slot);
                outcome
            })
            .await
            .unwrap_or_else(|e| Err(format!("Export thread died without a result: {e}")))
            .map(|result| FfiBulkExportResult {
                exported: result.exported,
                skipped: result.skipped,
                total_bytes: result.total_bytes,
            })
            .map_err(|msg| VeloqError::Database { msg })
    }

    /// How far the running export has got, or nothing running.
    ///
    /// One mutex and two atomic loads, which is what a progress bar may cost.
    fn bulk_export_progress(&self) -> FfiBulkExportProgress {
        let guard = BULK_EXPORT_PROGRESS
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(progress) => {
                let (exported, total) = progress.read();
                FfiBulkExportProgress {
                    running: true,
                    exported,
                    total,
                }
            }
            None => FfiBulkExportProgress {
                running: false,
                exported: 0,
                total: 0,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::export::BulkExportFormat;
    use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
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
    /// Expected behaviour: the wipe is under way while another writer still
    /// holds the lock, so no caller waits on the lock to start one; a second
    /// call is refused while the first is running; and the call resolves once
    /// the wipe is done, leaving the next one free to start.
    #[test]
    fn the_clear_runs_off_the_calling_thread() {
        use std::sync::mpsc;
        use std::thread;
        use std::time::{Duration, Instant};

        /// Long enough that a caller which waited for the lock could not be
        /// mistaken for one that did not.
        const HOLD: Duration = Duration::from_millis(500);
        /// A call that took this long to be under way went through the lock.
        const START_BUDGET: Duration = Duration::from_millis(100);

        let _guard = serial_global_state();
        let _tmp = init_global_engine("clear.db");
        let engine = VeloqEngine;

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
        let running = crate::runtime::ASYNC_RUNTIME
            .spawn(async { VeloqEngine.run_clear_routes_and_sections().await });

        // The slot is claimed before the wipe touches the engine, so the claim
        // going up while another writer holds the lock is the proof that no
        // caller waits on the lock to get a wipe going.
        while !CLEAR_CATALOGUE_IN_FLIGHT.load(std::sync::atomic::Ordering::SeqCst) {
            assert!(
                start.elapsed() < START_BUDGET,
                "no clear was under way after {:?}",
                start.elapsed()
            );
            thread::sleep(Duration::from_millis(5));
        }

        assert!(
            crate::runtime::block_on(engine.run_clear_routes_and_sections()).is_err(),
            "a second clear started while the first was still running"
        );

        writer.join().expect("writer thread");

        crate::runtime::block_on(running)
            .expect("the clear task")
            .expect("the wipe");

        crate::runtime::block_on(engine.run_clear_routes_and_sections())
            .expect("a finished wipe does not block the next one");
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

    /// Scenario: a copy on a full library outran `runBackup.ts`'s five-minute
    /// deadline, or a wipe queued behind a long lock hold. The JS threw and
    /// stopped polling, so nothing ever observed the worker finishing and the
    /// slot stayed occupied. Every later backup in that process answered "A
    /// backup is already running", and the auto-backup path swallows that, so
    /// the athlete had no backups and no message until relaunch.
    ///
    /// Expected behaviour: a start reaps a slot whose worker has finished.
    /// Nobody is waiting on that result any more, by definition: the only
    /// callers of the poll exports are the deadlines that gave up.
    /// Scenario: the restore path calls `destroy` and then `initWithPath` on
    /// the restored file, with no cancel of anything first. A detection,
    /// a tile pass or a sync that was running kept running, and the detection
    /// applied a catalogue computed from the old library into the new one.
    ///
    /// Expected behaviour: every job is asked to stop before the engine goes.
    /// The cancel is cooperative, so this is what stops a worker with work
    /// still ahead of it rather than a guarantee about one already past its
    /// last check, which is an open question.
    #[test]
    fn destroy_asks_every_running_job_to_stop() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("destroy-cancels.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let detection = with_persistent_engine(|e| e.detect_sections_background()).expect("engine");
        let cancelled_before = detection.cancel_requested();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(detection);

        engine.destroy();

        assert!(!cancelled_before, "nothing was cancelled before destroy");
        let handle = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        assert!(
            handle.as_ref().expect("handle").cancel_requested(),
            "the detection was asked to stop"
        );
        drop(handle);

        // Leave nothing running behind this test: a detached worker holds the
        // engine write lock and the next test's backup then reads as one
        // already running.
        let finished = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .expect("handle");
        let _ = finished.recv();
    }

    #[test]
    fn a_backup_nobody_waited_for_still_frees_the_next_one() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("reap.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        // An abandoned wait is what an overrun ceiling leaves behind: the copy
        // runs on, and the slot is its to release.
        let first = tmp.path().join("first.db").to_string_lossy().into_owned();
        let abandoned =
            crate::runtime::ASYNC_RUNTIME.spawn(async move { VeloqEngine.run_backup(first).await });
        abandoned.abort();

        let second = tmp.path().join("second.db").to_string_lossy().into_owned();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            match crate::runtime::block_on(engine.run_backup(second.clone())) {
                Ok(()) => break,
                Err(e) => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "the abandoned copy never released the slot: {e}"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            }
        }
        assert!(std::path::Path::new(&second).exists());
    }

    /// Scenario: a caller gives up on a wipe at the ceiling its session allows,
    /// which it may, and the wipe carries on.
    ///
    /// Expected behaviour: the slot belongs to the wipe and not to the wait, so
    /// the abandoned run releases it when the wiping ends and the next caller
    /// is not refused for the life of the process. That is what the polled
    /// shape got wrong: a finished worker nobody polled held its slot for ever,
    /// and the auto-backup path swallowed the refusal.
    #[test]
    fn a_wipe_nobody_waited_for_still_frees_the_next_one() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("reap-clear.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let abandoned =
            crate::runtime::ASYNC_RUNTIME.spawn(async { VeloqEngine.run_clear_derived().await });
        abandoned.abort();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            match crate::runtime::block_on(engine.run_clear_derived()) {
                Ok(_) => break,
                Err(e) => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "the abandoned wipe never released the slot: {e}"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            }
        }
    }

    #[test]
    fn backup_runs_once_at_a_time_and_reports_its_metadata() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        let dest = tmp.path().join("backup.db").to_string_lossy().into_owned();
        let running = {
            let dest = dest.clone();
            crate::runtime::ASYNC_RUNTIME.spawn(async move { VeloqEngine.run_backup(dest).await })
        };
        // Refused while the first is in flight; once it has landed the next
        // call is a fresh copy rather than a refusal that never lifts.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !BACKUP_IN_FLIGHT.load(std::sync::atomic::Ordering::SeqCst) {
            assert!(
                std::time::Instant::now() < deadline,
                "no copy was under way"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(
            crate::runtime::block_on(engine.run_backup(dest.clone())).is_err(),
            "a second copy started while the first was still running"
        );
        crate::runtime::block_on(running)
            .expect("the backup task")
            .expect("the copy");
        assert!(std::path::Path::new(&dest).exists());
        crate::runtime::block_on(engine.run_backup(dest.clone()))
            .expect("a finished copy does not block the next one");

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
        assert!(
            !engine.bulk_export_progress().running,
            "nothing running yet"
        );

        let dest = tmp.path().join("all.zip").to_string_lossy().into_owned();
        let running = {
            let dest = dest.clone();
            crate::runtime::ASYNC_RUNTIME.spawn(async move {
                VeloqEngine
                    .run_bulk_export(BulkExportFormat::Gpx, dest)
                    .await
            })
        };

        // The export takes the write lock once, to open its own connection.
        // Past that point it is on that connection, which is what the lock held
        // below has to leave alone.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !engine.bulk_export_progress().running && !running.is_finished() {
            assert!(
                std::time::Instant::now() < deadline,
                "the export never opened its connection"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        let result = with_engine(|_| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            loop {
                if running.is_finished() {
                    return crate::runtime::block_on(running).expect("the export task");
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "the export must not wait on the engine write lock"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        })
        .unwrap()
        .expect("the export");

        assert_eq!(result.exported, 1);
        assert!(result.total_bytes > 0.0);
        assert!(std::path::Path::new(&dest).exists());
        assert!(
            !engine.bulk_export_progress().running,
            "a finished export frees its slot"
        );
    }

    #[test]
    fn a_second_export_is_refused_while_one_runs() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");

        // The write lock holds the first export at its one lock take, so the
        // second call meets a run that is certainly still going.
        let (holding, held) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel::<()>();
        let writer = std::thread::spawn(move || {
            with_persistent_engine(|_| {
                holding.send(()).ok();
                released.recv().ok();
            })
            .expect("engine");
        });
        held.recv().expect("the writer took the lock");

        let dest = tmp.path().join("all.zip").to_string_lossy().into_owned();
        let running = {
            let dest = dest.clone();
            crate::runtime::ASYNC_RUNTIME.spawn(async move {
                VeloqEngine
                    .run_bulk_export(BulkExportFormat::Gpx, dest)
                    .await
            })
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !BULK_EXPORT_IN_FLIGHT.load(std::sync::atomic::Ordering::SeqCst) {
            assert!(
                std::time::Instant::now() < deadline,
                "no export was under way"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        let second = crate::runtime::block_on(
            engine.run_bulk_export(
                BulkExportFormat::GeoJson,
                tmp.path()
                    .join("all.geojson")
                    .to_string_lossy()
                    .into_owned(),
            ),
        );
        assert!(second.is_err(), "a second export ran beside the first");

        release.send(()).ok();
        writer.join().expect("writer thread");
        crate::runtime::block_on(running)
            .expect("the export task")
            .expect("the export");
        assert!(std::path::Path::new(&dest).exists());
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
        let result = crate::runtime::block_on(
            engine.run_bulk_export(BulkExportFormat::GeoJson, dest.clone()),
        )
        .expect("the export");

        assert_eq!(result.exported, 1);
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
        let result =
            crate::runtime::block_on(engine.run_bulk_export(BulkExportFormat::Gpx, dest.clone()))
                .expect("the export");

        assert_eq!(result.exported, 0);
        assert!(std::path::Path::new(&dest).exists());
    }

    /// A destination that cannot be created fails the call rather than
    /// stranding the slot at "running" forever.
    #[test]
    fn an_unwritable_destination_fails_and_frees_the_slot() {
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

        assert!(
            crate::runtime::block_on(engine.run_bulk_export(BulkExportFormat::Gpx, dest)).is_err(),
            "an export that cannot write its file must fail"
        );
        assert!(
            !engine.bulk_export_progress().running,
            "a failed export frees its slot"
        );
    }
}
