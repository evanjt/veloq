use super::error::{VeloqError, with_engine, with_reader};
use crate::init_logging;
use crate::persistence::{NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats};
use log::info;
use std::sync::Arc;

/// What the clear-cache wipe removed.
/// What the Developer Dashboard reads that no other screen does: the native
/// push worker's recent runs and the request budget.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDashboardData {
    /// What each recent native push run did, newest first.
    pub push_runs: Vec<crate::push::FfiPushRun>,
    /// The request budget, or `None` where the governor only paces.
    pub request_budget: Option<crate::governor::FfiRequestBudget>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct DerivedClearCounts {
    pub sections_removed: u32,
    pub activities_removed: u32,
    pub activities_kept: u32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRecordRestoreResult {
    pub placed: u32,
    pub unplaced: u32,
    pub missing_activity_ids: Vec<String>,
    /// History rows the latest restore left in its backup file, every pass
    /// so far included.
    pub not_restored: u32,
    /// Route names the latest restore gave up on to a merged route, every
    /// pass so far included.
    pub names_not_restored: u32,
}

/// A record to check: a record zip on disk, or record JSON such as an older
/// `.veloq` file converts to.
#[derive(Debug, Clone, uniffi::Enum)]
pub enum FfiRecordSource {
    Zip { path: String },
    Json { json: String },
}

/// What a check of a record learnt about it, once it found nothing the
/// restore would refuse, so the question before a restore can say what the
/// restore would replace.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRecordCheck {
    /// When the record was written, RFC 3339 in UTC, from its own content.
    /// `None` for a record written before records carried the time.
    pub written_at: Option<String>,
    /// Whether the record names the account it was written for. The check
    /// refuses one naming another account, so a named one is this account's.
    pub names_account: bool,
    /// Route and section names the record carries.
    pub names: u32,
    /// Settings rows the record carries.
    pub settings: u32,
    /// Every other decision: hand-cut sections, pins, exclusions, numbers.
    pub decisions: u32,
}

/// One wipe of each kind at a time.
///
/// The flag is cleared by the wipe itself rather than by the caller's future,
/// because the two part company: a caller gives up at its own ceiling and the
/// wipe carries on, and the next caller has to be refused until the wipe, not
/// the wait, is over.
static CLEAR_DERIVED_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static CLEAR_ALL_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static BACKUP_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BULK_EXPORT_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// One run that can be stopped: the id a screen names to stop it, and the
/// latch its worker reads.
type StoppableRun<L> = Option<(u64, std::sync::Arc<L>)>;

/// The running export, for the progress read and the stop to find. Held beside
/// the flag rather than in the handle, which the awaiting task owns.
static BULK_EXPORT_RUN: std::sync::Mutex<
    StoppableRun<crate::persistence::export::BulkExportProgress>,
> = std::sync::Mutex::new(None);

/// The running record backup. The clear snapshot shares its slot and is
/// never here: it is the rollback a wipe stands on, so it is not the
/// athlete's to stop.
static RECORD_BACKUP_RUN: std::sync::Mutex<StoppableRun<std::sync::atomic::AtomicBool>> =
    std::sync::Mutex::new(None);

/// Run ids for every kind `cancel_run` reaches, so an id never names a run of
/// another kind. Zero is never handed out.
static NEXT_STOPPABLE_RUN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// A fresh id for one run that `cancel_run` can stop.
pub(crate) fn next_stoppable_run() -> u64 {
    NEXT_STOPPABLE_RUN.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

/// A run held in its slot for as long as the work lasts, however it ends.
struct RunSlot<L: 'static> {
    slot: &'static std::sync::Mutex<StoppableRun<L>>,
    run: u64,
}

impl<L> RunSlot<L> {
    fn open(slot: &'static std::sync::Mutex<StoppableRun<L>>, latch: std::sync::Arc<L>) -> Self {
        let run = next_stoppable_run();
        *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some((run, latch));
        RunSlot { slot, run }
    }
}

impl<L> Drop for RunSlot<L> {
    fn drop(&mut self) {
        let mut held = self.slot.lock().unwrap_or_else(|e| e.into_inner());
        if held.as_ref().is_some_and(|(run, _)| *run == self.run) {
            *held = None;
        }
    }
}

/// The run in `slot`, if one is running.
fn running<L>(slot: &std::sync::Mutex<StoppableRun<L>>) -> StoppableRun<L> {
    slot.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The running record backup's id, for `cancel_run`, or nothing running. The
/// backup screen's read carries it, since a backup is single-flight.
pub(crate) fn record_backup_run() -> Option<u64> {
    running(&RECORD_BACKUP_RUN).map(|(run, _)| run)
}

/// Ask the export, record backup or detector cutover `run` to stop. Returns
/// whether that run was still going.
///
/// Cooperative: the worker checks between activities, or between stages for
/// the backup and the cutover, and an export removes what it had written. An
/// id that names a finished run reaches nothing, so a stop cannot land on the
/// next one.
pub(crate) fn cancel_stoppable_run(run: u64) -> bool {
    if let Some((_, progress)) = running(&BULK_EXPORT_RUN).filter(|(held, _)| *held == run) {
        progress.cancel();
        return true;
    }
    if let Some((_, latch)) = running(&RECORD_BACKUP_RUN).filter(|(held, _)| *held == run) {
        latch.store(true, std::sync::atomic::Ordering::SeqCst);
        return true;
    }
    crate::persistence::cutover::cancel_cutover_run(run)
}

/// The error a worker's message crosses as. A stop is its own variant, so a
/// screen can say cancelled rather than failed.
fn job_error(msg: String) -> VeloqError {
    if msg == crate::persistence::export::JOB_CANCELLED {
        VeloqError::Cancelled
    } else {
        VeloqError::Database { msg }
    }
}

/// A claim on a job slot, released when the work ends however it ends.
pub(crate) struct InFlight(&'static std::sync::atomic::AtomicBool);

impl InFlight {
    /// The slot, or the refusal the caller shows.
    pub(crate) fn claim(
        flag: &'static std::sync::atomic::AtomicBool,
        taken: &str,
    ) -> Result<Self, VeloqError> {
        use std::sync::atomic::Ordering;
        if flag.swap(true, Ordering::SeqCst) {
            return Err(VeloqError::Busy {
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

/// `cancel` is the record backup's stop latch. The clear snapshot takes none.
fn backup_handle(
    dest_path: &str,
    cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<crate::persistence::BackupHandle, VeloqError> {
    with_engine(|engine| match cancel {
        // Read inside the engine take, so it names the library this
        // handle was cut from.
        Some(cancel) => {
            engine.record_backup_background(dest_path, crate::persistence::engine_install(), cancel)
        }
        None => engine.clear_snapshot_background(dest_path),
    })
}

/// Refuse a record that names an athlete other than the one signed in, and
/// any record before anyone has signed in. Restore and its pre-offer check
/// both answer through this, so the offer is never made for a record the
/// restore would refuse.
fn refuse_another_signed_in_athlete(imported: Option<&str>) -> Result<(), VeloqError> {
    let signed_in = super::sync::signed_in_athlete_id().ok_or(VeloqError::NotFound {
        msg: "Sign in before importing a backup".to_string(),
    })?;
    if imported.is_some_and(|imported| imported != signed_in) {
        return Err(VeloqError::Database {
            msg: "Record belongs to another athlete".to_string(),
        });
    }
    Ok(())
}

/// Ask every running job to stop, without waiting for any of them.
///
/// Called before the engine goes away. Each is a latch the worker reads
/// between stages, so this returns immediately and the workers wind down on
/// their own.
fn cancel_every_job() {
    cancel_jobs_except_sync();
    crate::objects::sync::SYNC_SERVICE.request_cancel();
}

fn cancel_jobs_except_sync() {
    crate::http::cancel_all_downloads();
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
}

/// Retire every job ahead of a whole-database wipe, which starts nothing again.
fn retire_jobs_before_clear() {
    cancel_every_job();
    crate::persistence::invalidate_engine_install();
}

/// Retire every job ahead of a partial wipe, handing back the sync it cut
/// short so the wipe's end can start it again.
fn retire_jobs_before_partial_clear() -> Option<crate::objects::sync::Interrupted> {
    cancel_jobs_except_sync();
    let interrupted = crate::objects::sync::interrupt_sync();
    crate::persistence::invalidate_engine_install();
    interrupted
}

/// What a partial wipe owes once it has ended: the sync it cut short, and a
/// pass over a heatmap its retire cancelled or its removals dirtied. Run
/// outside the engine write lock, on the install the wipe left.
fn finish_partial_clear(interrupted: Option<crate::objects::sync::Interrupted>) {
    crate::objects::sync::resume_sync_after_clear(interrupted);
    crate::persistence::tiles::request_tile_pass_if_dirty(crate::persistence::engine_install());
}

/// How far an export has got. Read on a timer while one runs, which is
/// what a progress bar is: an event per activity would park the writing thread
/// on the JS thread once per file.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBulkExportProgress {
    /// Whether an export is running at all.
    pub running: bool,
    /// The running export's id, for `cancel_run`.
    pub run: Option<f64>,
    /// Stored tracks visited so far, written or skipped, and how many there
    /// are, so the count reaches the total on a run with skips.
    pub visited: u32,
    pub total: u32,
}

#[derive(uniffi::Object)]
pub struct VeloqEngine;

#[uniffi::export]
impl VeloqEngine {
    #[uniffi::constructor]
    pub fn create(db_path: String) -> Arc<Self> {
        init_logging();

        info!("[VeloqEngine] Initialising at {}", db_path);
        if let Some(true) = crate::persistence::persistent_engine_ffi::open_if_closed(db_path, true)
        {
            crate::persistence::sections::conditioning::condition_pending();
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
    /// were replaced. A release standalone engine binary on the S22 measured
    /// the comparable targeted loaders at 18.9 to 20.0 ms of the 100 ms a
    /// transition gets, so this call blocks the JavaScript thread rather than
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

    /// Drop the registered listener. `EngineClient.ts` calls it on its own
    /// thread from its two destroy paths, when the engine is wiped or replaced,
    /// and it returns without waiting for a delivery in flight.
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
        with_reader(crate::persistence::pooled_stats)
    }

    /// Give back what the engine holds in memory and can rebuild, when the OS
    /// asks the process for memory. Parked readers close and every connection
    /// hands back its page cache. At the hard level, the last warning before
    /// the process is killed, the LRUs and the satellite rasters go too, at the
    /// cost of a recompute or a refetch on the next read.
    ///
    /// Async because it waits for the engine lock, which a sync or a detection
    /// run can hold for seconds.
    async fn release_memory(&self, hard: bool) {
        let released = crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || crate::persistence::memory::release_memory(hard))
            .await;
        if let Err(e) = released {
            log::warn!("veloqrs: [VeloqEngine] the memory release thread died: {e}");
        }
    }

    /// The Developer Dashboard's own read: the recent native push runs and the
    /// request budget's counts, cooldown and next reset.
    ///
    /// Neither takes the engine lock: the runs come off the read pool and the
    /// budget from the governor and the settings rows, since it is a
    /// diagnostic opened while the foreground is live. An install that has
    /// had no push answers no runs rather than refusing.
    fn dashboard_data(&self) -> FfiDashboardData {
        FfiDashboardData {
            push_runs: crate::push::runs::recent(),
            request_budget: crate::governor::request_budget(),
        }
    }

    /// Get activity IDs that need time streams fetched (have NULL lap_time, no time_stream).
    /// Used for one-time backfill after upgrade.
    fn get_activities_needing_time_streams(&self) -> Result<Vec<String>, VeloqError> {
        with_reader(crate::persistence::fitness::performances::activities_needing_time_streams)
    }

    /// Wipe everything the engine can re-derive, resolving with what went.
    ///
    /// 734 ms on a 750-activity library, the worst of the three wipes, and it
    /// sits behind the clear-cache button. The write lock is still taken, what
    /// moves off the calling thread is the wait. The ceiling stays with the
    /// caller, and a second call is refused until the wipe, not the wait, ends.
    pub async fn run_clear_derived(&self) -> Result<DerivedClearCounts, VeloqError> {
        let slot = InFlight::claim(&CLEAR_DERIVED_IN_FLIGHT, "A clear is already running")?;
        let interrupted = retire_jobs_before_partial_clear();
        let handle = crate::persistence::clear_derived_background();
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle.wait();
                drop(slot);
                finish_partial_clear(interrupted);
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

    /// Wipe the whole database, resolving once it has ended.
    ///
    /// The caller re-opens the engine after this, so the promise is what keeps
    /// the re-open ordered after the wipe. No deadline belongs here: a wipe
    /// that outlasts a suspension still finishes, and the re-open has to follow
    /// it however long that took. The slot is released by the wipe's own
    /// thread, so a second call is refused until the wipe, not the wait, ends.
    ///
    /// The heatmap tiles under `heatmap_tiles_path` go with it, whether or not
    /// this engine has the heatmap on: the path is set only when the heatmap
    /// turns on, and the login screen wipes before that.
    async fn run_clear_all(&self, heatmap_tiles_path: String) -> Result<(), VeloqError> {
        let slot = InFlight::claim(&CLEAR_ALL_IN_FLIGHT, "A clear is already running")?;
        retire_jobs_before_clear();
        let handle = crate::persistence::clear_all_background(Some(heatmap_tiles_path));
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
        info!("[VeloqEngine] Destroying persistent engine");
        crate::persistence::close_for_restore();
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

    /// Copy the database to `dest_path` as the rollback a destructive clear
    /// stands on, off the JS thread.
    ///
    /// It takes the backup slot, one write at a time. The slot is the copy's,
    /// not the waiter's: a caller that gives up at its own ceiling leaves the
    /// copy running, and the next caller is refused until the copy ends rather
    /// than until somebody reads its outcome.
    async fn write_clear_snapshot(&self, dest_path: String) -> Result<(), VeloqError> {
        let slot = InFlight::claim(&BACKUP_IN_FLIGHT, "A backup is already running")?;
        let handle = backup_handle(&dest_path, None)?;
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

    /// Write the athlete record as a compressed backup off the JS thread.
    ///
    /// The backup screen's read names the run while it goes, for `cancel_run`.
    /// A stopped run answers `Cancelled` and leaves the destination as it was.
    async fn run_record_backup(&self, dest_path: String) -> Result<(), VeloqError> {
        let slot = InFlight::claim(&BACKUP_IN_FLIGHT, "A backup is already running")?;
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let run = RunSlot::open(&RECORD_BACKUP_RUN, std::sync::Arc::clone(&cancel));
        let handle = backup_handle(&dest_path, Some(cancel))?;
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle
                    .recv_blocking()
                    .unwrap_or_else(|| Err("Backup thread died without a result".to_string()));
                drop(run);
                drop(slot);
                outcome
            })
            .await
            .unwrap_or_else(|e| Err(format!("Backup thread died without a result: {e}")))
            .map_err(job_error)
    }

    /// Read a record ZIP and apply its decisions off the JS thread.
    async fn restore_record_zip(&self, path: String) -> Result<FfiRecordRestoreResult, VeloqError> {
        let payload = crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || crate::persistence::record_backup::read_record_zip(&path))
            .await
            .map_err(|e| VeloqError::Database { msg: e.to_string() })?
            .map_err(|msg| VeloqError::Database { msg })?;
        restore_record_payload(payload).await
    }

    /// Run the checks a restore of the record would run, the version, row
    /// content and both athlete checks, and write nothing. Off the JS thread,
    /// since it inflates an archive. Returns when the record was written,
    /// which a zip's file time does not keep through every restore, and what
    /// it would place.
    async fn check_record(&self, source: FfiRecordSource) -> Result<FfiRecordCheck, VeloqError> {
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let payload = match source {
                    FfiRecordSource::Zip { path } => {
                        crate::persistence::record_backup::read_record_zip(&path)
                    }
                    FfiRecordSource::Json { json } => {
                        crate::persistence::record_restore::parse_record_payload(&json).and_then(
                            |payload| {
                                crate::persistence::record_backup::check_record_version(
                                    payload.version,
                                )
                                .map(|()| payload)
                            },
                        )
                    }
                }
                .map_err(|msg| VeloqError::Database { msg })?;
                crate::persistence::record_restore::check_record_rows(&payload)
                    .map_err(|msg| VeloqError::Database { msg })?;
                let imported = payload.athlete_id.as_deref();
                refuse_another_signed_in_athlete(imported)?;
                with_reader(|conn| {
                    crate::persistence::record_restore::check_record_athlete_from_conn(
                        conn, imported,
                    )
                })?
                .map_err(|msg| VeloqError::Database { msg })?;
                let counts = crate::persistence::record_restore::record_counts(&payload);
                Ok(FfiRecordCheck {
                    names_account: imported.is_some_and(|id| !id.is_empty()),
                    written_at: payload.written_at,
                    names: counts.names,
                    settings: counts.settings,
                    decisions: counts.decisions,
                })
            })
            .await
            .map_err(|e| VeloqError::Database { msg: e.to_string() })?
    }

    /// Apply record JSON off the JS thread, including converted legacy records.
    async fn restore_record_json(
        &self,
        json: String,
    ) -> Result<FfiRecordRestoreResult, VeloqError> {
        let payload = crate::persistence::record_restore::parse_record_payload(&json)
            .map_err(|msg| VeloqError::Database { msg })?;
        restore_record_payload(payload).await
    }

    /// Drop what an import left at the athlete's word. Without `waiting` it is
    /// the paused import, leaving the library and the records already waiting
    /// as they are. With it, it is the records still waiting to be placed,
    /// keeping what was placed and any paused import.
    async fn discard_record_import(&self, waiting: bool) -> Result<(), VeloqError> {
        crate::persistence::with_persistent_engine_blocking(move |engine| {
            if waiting {
                engine.discard_unplaced_records()
            } else {
                engine.discard_paused_import()
            }
        })
        .await
        .ok_or(VeloqError::NotInitialized)?
        .map_err(|msg| VeloqError::Database { msg })
    }

    /// List decisions that still await their activity or matching ground.
    async fn get_unplaced_backup_records(
        &self,
    ) -> Result<Vec<crate::persistence::record_restore::UnplacedRecord>, VeloqError> {
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(|| {
                with_reader(crate::persistence::record_restore::unplaced_records_from_conn)
            })
            .await
            .map_err(|e| VeloqError::Database { msg: e.to_string() })??
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
    ) -> Result<crate::persistence::export::BulkExportResult, VeloqError> {
        let slot = InFlight::claim(&BULK_EXPORT_IN_FLIGHT, "An export is already running")?;
        let progress =
            std::sync::Arc::new(crate::persistence::export::BulkExportProgress::default());
        let run = RunSlot::open(&BULK_EXPORT_RUN, std::sync::Arc::clone(&progress));
        let (install, handle) = with_engine(|e| {
            (
                crate::persistence::engine_install(),
                e.bulk_export_background(format, &dest_path, progress),
            )
        })?;

        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                let outcome = handle
                    .recv_blocking()
                    .unwrap_or_else(|| Err("Export thread died without a result".to_string()));
                drop(run);
                drop(slot);
                // A library wiped while the worker ran is not the one the
                // caller asked about: its counts and file are not owed on.
                settle_bulk_export(
                    install,
                    crate::persistence::engine_install(),
                    &dest_path,
                    outcome,
                )
            })
            .await
            .unwrap_or_else(|e| Err(format!("Export thread died without a result: {e}")))
            .map_err(job_error)
    }

    /// How far the running export has got, or nothing running.
    ///
    /// One mutex and two atomic loads, which is what a progress bar may cost.
    fn bulk_export_progress(&self) -> FfiBulkExportProgress {
        match running(&BULK_EXPORT_RUN) {
            Some((run, progress)) => {
                let (visited, total) = progress.read();
                FfiBulkExportProgress {
                    running: true,
                    run: Some(run as f64),
                    visited,
                    total,
                }
            }
            None => FfiBulkExportProgress {
                running: false,
                run: None,
                visited: 0,
                total: 0,
            },
        }
    }
}

/// Apply a parsed record payload off the JS thread, for both the JSON and the
/// zip path, refusing a record or a paused import of another signed-in athlete.
async fn restore_record_payload(
    payload: crate::persistence::record_backup::RecordPayload,
) -> Result<FfiRecordRestoreResult, VeloqError> {
    refuse_another_signed_in_athlete(payload.athlete_id.as_deref())?;
    // A paused import this one carries is held to the same check.
    let paused = crate::runtime::ASYNC_RUNTIME
        .spawn_blocking(|| {
            with_reader(crate::persistence::record_restore::paused_import_athlete_from_conn)
        })
        .await
        .map_err(|e| VeloqError::Database { msg: e.to_string() })??
        .map_err(|msg| VeloqError::Database { msg })?;
    refuse_another_signed_in_athlete(paused.as_deref())?;
    let (result, not_restored, names_not_restored) =
        crate::persistence::with_persistent_engine_blocking(move |engine| {
            let result = engine.restore_record_payload(payload)?;
            Ok::<_, String>((
                result,
                engine.not_restored_history_count()?,
                engine.not_restored_name_count()?,
            ))
        })
        .await
        .ok_or(VeloqError::NotInitialized)?
        .map_err(|msg| VeloqError::Database { msg })?;
    crate::objects::observer::notify(crate::objects::observer::Announcement::ActivitiesStored);
    crate::objects::observer::notify(crate::objects::observer::Announcement::GroupsChanged);
    crate::objects::observer::notify(crate::objects::observer::Announcement::DetectionApplied);
    crate::objects::observer::notify(crate::objects::observer::Announcement::SyncSettled);
    Ok(FfiRecordRestoreResult {
        placed: result.placed,
        unplaced: result.unplaced,
        missing_activity_ids: result.missing_activity_ids,
        not_restored,
        names_not_restored,
    })
}

/// What an export answers once its worker has ended. A library wiped while it
/// ran is not the one the caller asked about, so its counts and its file are
/// not owed on.
fn settle_bulk_export<T>(
    started_in: u64,
    now: u64,
    dest_path: &str,
    outcome: Result<T, String>,
) -> Result<T, String> {
    if started_in == now {
        return outcome;
    }
    let _ = std::fs::remove_file(dest_path);
    Err("The library was wiped while the export ran".to_string())
}

#[cfg(test)]
#[path = "tests/engine_clear_detection.rs"]
mod clear_detection_tests;

#[cfg(test)]
#[path = "tests/engine_time_streams_pooled.rs"]
mod time_streams_pooled_tests;

#[cfg(test)]
#[path = "tests/record_restore_without_runtime.rs"]
mod record_restore_without_runtime;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::export::BulkExportFormat;
    use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
    use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
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
            engine.activities().get_count().unwrap(),
            1,
            "a second create must not reopen"
        );

        engine.destroy();
        assert!(!engine.is_initialized());
        assert!(matches!(
            engine.activities().get_count(),
            Err(VeloqError::NotInitialized)
        ));
        assert!(matches!(
            engine.get_stats(),
            Err(VeloqError::NotInitialized)
        ));
    }

    #[test]
    fn destroy_keeps_a_native_push_from_opening_the_file_being_replaced() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("restore-window.db");
        let path = tmp.path().join("restore-window.db");
        let engine = VeloqEngine;
        engine.destroy();

        assert!(
            crate::push::prepare_native_session(&path.to_string_lossy(), "api_key", "secret", "i1")
                .is_err(),
            "a push must stop while restore has the engine closed"
        );
        assert!(!engine.is_initialized());
        VeloqEngine::create(path.to_string_lossy().into_owned());
        assert!(engine.is_initialized());
    }

    #[test]
    fn test_destroy_unbinds_read_pool() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("destroy-read-pool.db");
        let engine = VeloqEngine;

        assert!(crate::persistence::read_pool::with_read_conn(|_| ()).is_some());
        engine.destroy();
        assert!(
            crate::persistence::read_pool::with_read_conn(|_| ()).is_none(),
            "destroy must refuse reads from the closed library"
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
        assert_eq!(engine.activities().get_count().unwrap(), 0);
        engine.destroy();
    }

    #[test]
    fn create_resumes_owed_detection_without_a_sync() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("restart-detection.db");
        crate::test_globals::clear_detection_handle();
        seed_activity("a1");
        let path = tmp.path().join("restart-detection.db");
        crate::persistence::clear_persistent_engine();

        let engine = VeloqEngine::create(path.to_string_lossy().into_owned());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while crate::objects::detection::DetectionManager::new().last_outcome() != "complete"
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            !with_persistent_engine(|e| e.detection_owed()).expect("engine"),
            "a launch with no new stores must start its durable detection debt"
        );
        assert_eq!(
            crate::objects::detection::DetectionManager::new().last_outcome(),
            "complete"
        );
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
    fn stats_read_while_a_writer_holds_the_engine() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("stats_under_writer.db");
        seed_activity("a1");
        let engine = VeloqEngine;
        let stats = read_while_writer_holds(|| engine.get_stats().unwrap());
        assert_eq!(stats.activity_count, 1);
        assert_eq!(stats.gps_track_count, 1);
    }

    #[test]
    fn activity_count_reads_while_a_writer_holds_the_engine() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("count_under_writer.db");
        seed_activity("a1");
        let count = read_while_writer_holds(|| VeloqEngine.activities().get_count().unwrap());
        assert_eq!(count, 1);
    }

    #[test]
    fn pooled_stats_equal_the_engines_after_each_kind_of_write() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("stats_parity.db");
        let engine = VeloqEngine;
        let parity = |when: &str| {
            let pooled = engine.get_stats().unwrap();
            let mut own = with_persistent_engine(|e| e.stats()).unwrap();
            // Process-wide figures that move between the two reads, not rows.
            own.sqlite_heap_bytes = pooled.sqlite_heap_bytes;
            own.satellite_cache_bytes = pooled.satellite_cache_bytes;
            assert_eq!(format!("{pooled:?}"), format!("{own:?}"), "after {when}");
            pooled
        };
        parity("init");
        seed_activity("a1");
        seed_activity("a2");
        assert_eq!(parity("an add").activity_count, 2);
        with_persistent_engine(|e| e.mark_sections_dirty()).unwrap();
        assert!(parity("a sections mark").sections_dirty);
        with_persistent_engine(|e| {
            e.db.execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES ('g1', 'a1', '[\"a1\",\"a2\"]', 'Ride', 2)",
                [],
            )
            .unwrap();
            e.adopt_committed_groups();
            e.set_groups_dirty(true);
        })
        .unwrap();
        let grouped = parity("a regroup");
        assert_eq!(grouped.group_count, 1);
        assert!(grouped.groups_dirty);
        with_persistent_engine(|e| e.clear().unwrap()).unwrap();
        let cleared = parity("a clear");
        assert_eq!(cleared.activity_count, 0);
        assert_eq!(cleared.group_count, 0);
    }

    /// Scenario: the OS asks for memory twice, first as the app leaves the
    /// screen and then as its last warning. Expected behaviour: the first gives
    /// back what costs nothing to rebuild, the parked readers, and keeps the
    /// caches; the last empties the engine's LRUs and the satellite rasters as
    /// well. The Developer Dashboard's figures follow, and the engine reads on.
    #[test]
    fn releasing_memory_keeps_the_caches_until_the_hard_level() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("release_memory.db");
        let tiles = tempfile::TempDir::new().unwrap();
        crate::basemap::set_path(tiles.path().to_string_lossy().into_owned());
        let engine = VeloqEngine;
        seed_activity("a1");
        seed_activity("a2");
        let signatures = || with_persistent_engine(|e| e.stats().signature_cache_size).unwrap();
        assert!(signatures() > 0, "an add caches the signature it built");
        crate::basemap::store()
            .unwrap()
            .put("satellite-eox", 5, 0, 0, "jpg", &[7; 64], false)
            .unwrap();
        let before = engine.get_stats().unwrap();
        assert_eq!(before.satellite_cache_bytes, 64.0);
        assert!(before.sqlite_heap_bytes > 0.0);
        assert!(crate::persistence::read_pool::idle_len() > 0);

        crate::runtime::block_on(engine.release_memory(false));
        assert_eq!(crate::persistence::read_pool::idle_len(), 0);
        assert_eq!(signatures(), before.signature_cache_size);
        assert!(
            crate::basemap::store()
                .unwrap()
                .get("satellite-eox", 5, 0, 0)
                .is_some(),
            "a refetch is not worth it below the hard level"
        );

        crate::runtime::block_on(engine.release_memory(true));
        assert_eq!(signatures(), 0);
        let after = engine.get_stats().unwrap();
        assert_eq!(after.satellite_cache_bytes, 0.0);
        assert_eq!(after.signature_cache_size, 0);
        assert_eq!(after.activity_count, 2, "the library reads on");

        crate::basemap::close();
    }

    #[test]
    fn a_flag_set_in_one_write_reads_as_the_later_write_left_it() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("stats_flag_later_write.db");
        let engine = VeloqEngine;
        with_persistent_engine(|e| {
            e.mark_sections_dirty();
            e.set_groups_dirty(true);
        })
        .unwrap();
        let set = engine.get_stats().unwrap();
        assert!(set.sections_dirty && set.groups_dirty);
        with_persistent_engine(|e| e.clear().unwrap()).unwrap();
        let cleared = engine.get_stats().unwrap();
        assert!(!cleared.sections_dirty && !cleared.groups_dirty);
    }

    #[test]
    fn record_json_restore_runs_off_thread_and_returns_placement_counts() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("record-json.db");
        let _credentials = crate::objects::sync::test_credentials();
        let json = serde_json::json!({
            "version": 1,
            "entries": [{"table": "settings", "values": {"key": "units", "value": "miles"}}]
        });
        let result = crate::runtime::block_on(VeloqEngine.restore_record_json(json.to_string()))
            .expect("restore record JSON");
        assert_eq!((result.placed, result.unplaced), (1, 0));
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored.as_deref(), Some("miles"));
    }

    #[test]
    fn record_restore_rejects_another_signed_in_athlete_before_writing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("record-owner.db");
        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
            .unwrap();
        let json = serde_json::json!({
            "version": 1,
            "athlete_id": "athlete-2",
            "entries": [{"table": "settings", "values": {"key": "units", "value": "miles"}}]
        });
        let result = crate::runtime::block_on(VeloqEngine.restore_record_json(json.to_string()));
        crate::objects::sync::clear_test_credentials();
        assert!(result.is_err());
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored, None);
    }

    /// Scenario: a phone restored from a device backup holds a decisions zip,
    /// and the launch decides whether to offer it before anyone taps Restore.
    ///
    /// Expected behaviour: the check refuses exactly what the restore would
    /// refuse, another signed-in athlete, a library held by another athlete,
    /// a newer format, a row whose content cannot be placed and nobody signed
    /// in, and it writes nothing either way.
    #[test]
    fn record_zip_check_refuses_what_the_restore_refuses_and_writes_nothing() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("record-zip-check.db");
        let zip = |athlete: &str, version: u32| {
            let path = tmp.path().join(format!("{athlete}-{version}.zip"));
            let payload = serde_json::from_value(serde_json::json!({
                "version": version,
                "athlete_id": athlete,
                "entries": [{"table": "settings", "values": {"key": "units", "value": "miles"}}]
            }))
            .unwrap();
            crate::persistence::record_backup::write_record_zip(&payload, path.to_str().unwrap())
                .unwrap();
            path.to_str().unwrap().to_string()
        };
        let check = |path: String| {
            crate::runtime::block_on(VeloqEngine.check_record(FfiRecordSource::Zip { path }))
        };

        crate::objects::sync::clear_test_credentials();
        assert!(
            check(zip("athlete-1", 1)).is_err(),
            "checked with nobody signed in"
        );

        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
            .unwrap();
        let own = check(zip("athlete-1", 1));
        let dated_path = tmp.path().join("dated.zip");
        let dated_payload = serde_json::from_value(serde_json::json!({
            "version": 1,
            "athlete_id": "athlete-1",
            "written_at": "2026-10-01T12:00:00.000Z",
            "entries": []
        }))
        .unwrap();
        crate::persistence::record_backup::write_record_zip(
            &dated_payload,
            dated_path.to_str().unwrap(),
        )
        .unwrap();
        let dated = check(dated_path.to_str().unwrap().to_string());
        let other = check(zip("athlete-2", 1));
        let newer = check(zip("athlete-1", 2));
        with_persistent_engine(|e| e.set_setting("__athlete_id", "athlete-3").unwrap());
        let held_by_another = check(zip("athlete-1", 1));
        with_persistent_engine(|e| e.set_setting("__athlete_id", "athlete-1").unwrap());
        let unreadable_path = tmp.path().join("unreadable.zip");
        let unreadable_payload = serde_json::from_value(serde_json::json!({
            "version": 1,
            "athlete_id": "athlete-1",
            "entries": [{"table": "section_intents",
                         "values": {"id": "x", "kind": "named", "polyline_json": "not json"}}]
        }))
        .unwrap();
        crate::persistence::record_backup::write_record_zip(
            &unreadable_payload,
            unreadable_path.to_str().unwrap(),
        )
        .unwrap();
        let unreadable = check(unreadable_path.to_str().unwrap().to_string());
        crate::objects::sync::clear_test_credentials();

        assert!(
            own.is_ok(),
            "refused the signed-in athlete's own zip: {own:?}"
        );
        assert_eq!(own.unwrap().written_at, None, "an undated zip named a time");
        assert_eq!(
            dated.unwrap().written_at.as_deref(),
            Some("2026-10-01T12:00:00.000Z"),
            "the check lost the time the zip was written"
        );
        assert!(other.is_err(), "accepted another signed-in athlete's zip");
        assert!(
            newer.is_err(),
            "accepted a format this build cannot restore"
        );
        assert!(
            held_by_another.is_err(),
            "accepted a zip for a library another athlete holds"
        );
        assert!(
            unreadable.is_err(),
            "accepted a zip holding a row no library could place"
        );
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored, None, "the check wrote the record");
    }

    /// Scenario: the athlete picks a backup to restore, and the question that
    /// asks before it replaces anything has to say what the backup holds.
    ///
    /// Expected behaviour: the check of a zip and of the same record as JSON
    /// both return when it was written, whether it names an account, and how
    /// many names, settings and other decisions it would place. A JSON record
    /// naming no account says so, and JSON that is not a record is refused.
    #[test]
    fn record_check_says_what_the_record_would_place() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("record-check-counts.db");
        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
            .unwrap();
        let record = serde_json::json!({
            "version": 1,
            "athlete_id": "athlete-1",
            "written_at": "2026-10-01T12:00:00.000Z",
            "entries": [
                {"table": "settings", "values": {"key": "units", "value": "miles"}},
                {"table": "settings", "values": {"key": "theme", "value": "dark"}},
                {"table": "route_names", "values": {"route_id": "r1", "custom_name": "Ridge loop"}},
                {"table": "legacy_section_name", "values": {"section_id": "s1", "name": "Quarry climb"}},
                {"table": "sections", "values": {"id": "c1", "name": "Harbour sprint",
                    "section_type": "custom", "sport_type": "Ride",
                    "source_activity_id": "a1", "start_index": 0, "end_index": 4}},
                {"table": "sections", "values": {"id": "c2", "name": null,
                    "section_type": "custom", "sport_type": "Ride",
                    "source_activity_id": "a1", "start_index": 5, "end_index": 9}},
                {"table": "section_pins", "values": {"section_id": "c1"}}
            ]
        });
        let zip_path = tmp.path().join("counted.zip");
        crate::persistence::record_backup::write_record_zip(
            &serde_json::from_value(record.clone()).unwrap(),
            zip_path.to_str().unwrap(),
        )
        .unwrap();
        let check =
            |source: FfiRecordSource| crate::runtime::block_on(VeloqEngine.check_record(source));
        let from_zip = check(FfiRecordSource::Zip {
            path: zip_path.to_str().unwrap().to_string(),
        });
        let from_json = check(FfiRecordSource::Json {
            json: record.to_string(),
        });
        let unnamed = check(FfiRecordSource::Json {
            json: serde_json::json!({"version": 1, "athlete_id": null, "entries": []}).to_string(),
        });
        let not_a_record = check(FfiRecordSource::Json {
            json: "{\"hello\": 1}".to_string(),
        });
        crate::objects::sync::clear_test_credentials();

        for (label, checked) in [("zip", from_zip), ("json", from_json)] {
            let checked = checked.unwrap_or_else(|e| panic!("refused the {label}: {e:?}"));
            assert_eq!(
                checked.written_at.as_deref(),
                Some("2026-10-01T12:00:00.000Z"),
                "the {label} check lost the time"
            );
            assert!(checked.names_account, "the {label} check lost the account");
            assert_eq!(
                checked.names, 3,
                "{label}: a route, a section and a hand-cut name"
            );
            assert_eq!(checked.settings, 2, "{label}: two settings");
            assert_eq!(
                checked.decisions, 2,
                "{label}: an unnamed hand-cut and a pin"
            );
        }
        let unnamed = unnamed.unwrap();
        assert!(
            !unnamed.names_account,
            "an anonymous record named an account"
        );
        assert_eq!(unnamed.written_at, None);
        assert_eq!(
            (unnamed.names, unnamed.settings, unnamed.decisions),
            (0, 0, 0)
        );
        assert!(not_a_record.is_err(), "accepted JSON that is not a record");
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored, None, "the check wrote the record");
    }

    /// Scenario: an import paused by a storage failure, resumed at launch by
    /// an import of no entries, which carries it.
    ///
    /// Expected behaviour: it resumes only for the athlete it names.
    #[test]
    fn paused_record_import_resumes_only_for_its_athlete() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("record-resume.db");
        let json = serde_json::json!({
            "version": 1,
            "athlete_id": "athlete-1",
            "entries": [{"table": "settings", "values": {"key": "units", "value": "miles"}}]
        });
        with_persistent_engine(|e| {
            e.db.execute_batch(
                "CREATE TEMP TRIGGER refuse_progress BEFORE INSERT ON settings
                 WHEN NEW.key = '__record_restore_pending'
                 BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END",
            )
            .unwrap();
        });
        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
            .unwrap();
        let failed = crate::runtime::block_on(VeloqEngine.restore_record_json(json.to_string()));
        assert!(failed.is_err());
        with_persistent_engine(|e| {
            e.db.execute_batch("DROP TRIGGER temp.refuse_progress")
                .unwrap()
        });

        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-2")
            .unwrap();
        let resume = || {
            crate::runtime::block_on(
                VeloqEngine.restore_record_json(r#"{"version":1,"entries":[]}"#.to_string()),
            )
        };
        let other = resume();
        let other_wrote = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        crate::objects::sync::set_credentials_from_native("api_key", "test-secret", "athlete-1")
            .unwrap();
        let own = resume();
        crate::objects::sync::clear_test_credentials();

        assert!(other.is_err(), "resumed under another signed-in athlete");
        assert_eq!(other_wrote, None);
        let own = own.expect("resume");
        assert_eq!((own.placed, own.unplaced), (1, 0));
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored.as_deref(), Some("miles"));
    }

    #[test]
    fn record_restore_requires_a_signed_in_athlete_before_writing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("record-sign-in.db");
        crate::objects::sync::clear_test_credentials();
        let json = serde_json::json!({
            "version": 1,
            "entries": [{"table": "settings", "values": {"key": "units", "value": "miles"}}]
        });
        let result = crate::runtime::block_on(VeloqEngine.restore_record_json(json.to_string()));
        assert!(result.is_err());
        let stored = with_persistent_engine(|e| e.get_setting("units").unwrap()).unwrap();
        assert_eq!(stored, None);
    }

    #[test]
    fn the_two_clears_remove_what_they_say() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        seed_activity("a2");

        // A synced activity is re-derivable, so the derived clear takes it and
        // keeps only what a section still references.
        let derived = crate::runtime::block_on(engine.run_clear_derived()).unwrap();
        assert_eq!(derived.activities_removed, 2);
        assert_eq!(derived.activities_kept, 0);
        assert_eq!(derived.sections_removed, 0);
        assert_eq!(engine.activities().get_count().unwrap(), 0);

        seed_activity("a3");
        let tiles = _tmp.path().join("tiles");
        crate::runtime::block_on(engine.run_clear_all(tiles.to_string_lossy().into_owned()))
            .unwrap();
        assert_eq!(engine.activities().get_count().unwrap(), 0);
        engine.mark_for_recomputation().unwrap();
    }

    #[test]
    fn name_translations_are_written_to_the_shared_words() {
        let _serial = crate::test_globals::serial_global_state();
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

    /// Scenario: a caller gave up on the whole-database wipe at its own
    /// ceiling and the wipe carried on, then ended with nobody waiting.
    ///
    /// Expected behaviour: the slot belongs to the wipe, so the next wipe is
    /// accepted as soon as it has ended and completes.
    #[test]
    fn a_clear_all_slot_is_free_once_the_wipe_has_ended() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("clear-all-slot-free.db");
        seed_activity("a1");
        let tiles = tmp.path().join("tiles").to_string_lossy().into_owned();

        crate::runtime::block_on(VeloqEngine.run_clear_all(tiles.clone())).unwrap();
        seed_activity("a2");
        crate::runtime::block_on(VeloqEngine.run_clear_all(tiles)).unwrap();
        assert_eq!(VeloqEngine.activities().get_count().unwrap(), 0);
    }

    /// Expected behaviour: a wipe still running refuses the second call and
    /// touches nothing.
    #[test]
    fn a_clear_all_is_refused_behind_a_wipe_still_running() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("clear-all-slot-held.db");
        seed_activity("a1");
        let held = InFlight::claim(&CLEAR_ALL_IN_FLIGHT, "held").expect("slot is free");

        let refused = crate::runtime::block_on(
            VeloqEngine.run_clear_all(tmp.path().join("tiles").to_string_lossy().into()),
        );
        assert!(matches!(refused, Err(VeloqError::Busy { .. })));
        assert_eq!(VeloqEngine.activities().get_count().unwrap(), 1);
        drop(held);
    }

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

        let detection = with_persistent_engine(|e| {
            e.detect_sections_background_applying(
                crate::persistence::sections::detection::ApplyOn::Worker,
            )
        })
        .expect("engine");
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
    fn destroy_settles_a_fetch_while_its_reply_is_held_and_new_library_stays_clean() {
        use std::io::Write;

        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use crate::http::{ActivityFetcher, DownloadPriority};
        use crate::net::transport::Transport;

        let _guard = serial_global_state();
        let _old = init_global_engine("old-fetch.db");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("fake transport");
        let base = format!("http://{}", listener.local_addr().expect("fake address"));
        let (request_started, started) = std::sync::mpsc::channel();
        let (release_reply, reply_released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("track request");
            request_started.send(()).ok();
            reply_released.recv().expect("release the reply");
            let body = r#"[{"type":"latlng","data":[46.0,46.1],"data2":[7.0,7.1]}]"#;
            let _ = write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        });
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport = Transport::with_governor(base, AuthMethod::ApiKey("test"), governor)
            .expect("fake transport");
        let run = crate::ffi::start_fetch_and_store_with_fetcher(
            vec!["old-athlete".into()],
            vec![],
            DownloadPriority::Bulk,
            ActivityFetcher::with_transport(transport),
        );
        started
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("the fetch reached the fake transport");

        VeloqEngine.destroy();
        let _new = init_global_engine("new-fetch.db");
        let (settled, result) = std::sync::mpsc::channel();
        let watcher = std::thread::spawn(move || {
            loop {
                if let Some(value) = crate::ffi::take_fetch_and_store_result(run) {
                    settled.send(value).ok();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        });
        // The reply stays held until the run has settled, so a destroy that
        // waited for it would never settle and this wait would hit the hang
        // guard. The guard is far above any scheduling delay: it is not the
        // bound on how fast the run settles.
        let completed = result
            .recv_timeout(std::time::Duration::from_secs(60))
            .expect("destroy must not wait for the old reply");
        release_reply.send(()).expect("release the reply");
        watcher.join().expect("result watcher");
        server.join().expect("fake transport");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while crate::ffi::get_fetch_run_progress(run).active {
            assert!(
                std::time::Instant::now() < deadline,
                "fetch run never left the queue"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        assert!(
            completed.synced_ids.is_empty(),
            "the old track was not stored"
        );
        assert!(
            with_persistent_engine(|e| e.get_gps_track("old-athlete").is_none())
                .expect("new library"),
            "the old track reached the new library"
        );
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
        let abandoned = crate::runtime::ASYNC_RUNTIME
            .spawn(async move { VeloqEngine.write_clear_snapshot(first).await });
        abandoned.abort();

        let second = tmp.path().join("second.db").to_string_lossy().into_owned();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            match crate::runtime::block_on(engine.write_clear_snapshot(second.clone())) {
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

    /// A held slot is a job still running, and the screen shows it as one. As
    /// `Database` it read as a failed database, and only the English message
    /// told the two apart.
    #[test]
    fn a_held_slot_refuses_as_busy_not_as_a_database_failure() {
        static SLOT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        let held = InFlight::claim(&SLOT, "An export is already running").expect("free slot");

        match InFlight::claim(&SLOT, "An export is already running") {
            Err(VeloqError::Busy { msg }) => assert_eq!(msg, "An export is already running"),
            Err(other) => panic!("refused as {other:?}"),
            Ok(_) => panic!("a held slot was claimed twice"),
        }

        drop(held);
        assert!(InFlight::claim(&SLOT, "An export is already running").is_ok());
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

        // The copy claims its slot and then waits here for the engine, so the
        // second call meets a copy that is certainly still going. Left free,
        // a small library is copied between two polls of the slot and the
        // copy is never seen running.
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

        let dest = tmp.path().join("backup.db").to_string_lossy().into_owned();
        let running = {
            let dest = dest.clone();
            crate::runtime::ASYNC_RUNTIME
                .spawn(async move { VeloqEngine.write_clear_snapshot(dest).await })
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !BACKUP_IN_FLIGHT.load(std::sync::atomic::Ordering::SeqCst) {
            assert!(
                std::time::Instant::now() < deadline,
                "no copy was under way"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(
            matches!(
                crate::runtime::block_on(engine.write_clear_snapshot(dest.clone())),
                Err(VeloqError::Busy { .. })
            ),
            "a second copy started while the first was still running"
        );

        // Once it has landed the next call is a fresh copy rather than a
        // refusal that never lifts.
        release.send(()).ok();
        writer.join().expect("writer thread");
        crate::runtime::block_on(running)
            .expect("the backup task")
            .expect("the copy");
        assert!(std::path::Path::new(&dest).exists());
        crate::runtime::block_on(engine.write_clear_snapshot(dest.clone()))
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

    /// Hold the engine write lock on a thread of its own until the returned
    /// sender is sent to, so a job started meanwhile is certainly still going.
    fn hold_engine_lock() -> (std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>) {
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
        (release, writer)
    }

    /// Scenario: the athlete stops an export the moment it starts.
    /// Expected behaviour: it answers cancelled, leaves no file, frees its
    /// slot, and its id stops nothing once it has ended.
    #[test]
    fn a_running_export_can_be_cancelled_and_leaves_no_file() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        let (release, writer) = hold_engine_lock();

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
        let run = loop {
            if let Some(run) = engine.bulk_export_progress().run {
                break run;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "no export was under way"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        };
        assert!(
            !crate::ffi::cancel_run(run + 1.0),
            "another id stopped this run"
        );
        assert!(
            crate::ffi::cancel_run(run),
            "the running export was not found"
        );
        release.send(()).ok();
        writer.join().expect("writer thread");

        let outcome = crate::runtime::block_on(running).expect("the export task");
        assert!(matches!(outcome, Err(VeloqError::Cancelled)), "{outcome:?}");
        assert!(
            !std::path::Path::new(&dest).exists(),
            "a partial file was left"
        );
        assert!(!engine.bulk_export_progress().running, "the slot was kept");
        assert!(!crate::ffi::cancel_run(run), "a finished run was stopped");

        crate::runtime::block_on(engine.run_bulk_export(BulkExportFormat::Gpx, dest.clone()))
            .expect("the next export runs whole");
        assert!(std::path::Path::new(&dest).exists());
    }

    /// Scenario: the athlete stops a record backup while it waits to put its
    /// zip in place.
    /// Expected behaviour: it answers cancelled, writes nothing, and the next
    /// backup is not refused.
    #[test]
    fn a_running_record_backup_can_be_cancelled_and_writes_nothing() {
        let _guard = serial_global_state();
        let tmp = init_global_engine("engine.db");
        let engine = VeloqEngine;
        seed_activity("a1");
        assert_eq!(record_backup_run(), None, "nothing running yet");
        let (release, writer) = hold_engine_lock();

        let dest = tmp
            .path()
            .join("veloq-decisions.zip")
            .to_string_lossy()
            .into_owned();
        let running = {
            let dest = dest.clone();
            crate::runtime::ASYNC_RUNTIME
                .spawn(async move { VeloqEngine.run_record_backup(dest).await })
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let run = loop {
            if let Some(run) = record_backup_run() {
                break run as f64;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "no backup was under way"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        };
        let screen =
            crate::objects::error::with_reader(crate::persistence::screens::backup_screen_data)
                .expect("reader")
                .expect("backup screen");
        assert_eq!(
            screen.record_backup_run,
            Some(run),
            "the backup screen does not name the run"
        );
        assert!(
            crate::ffi::cancel_run(run),
            "the running backup was not found"
        );
        release.send(()).ok();
        writer.join().expect("writer thread");

        let outcome = crate::runtime::block_on(running).expect("the backup task");
        assert!(matches!(outcome, Err(VeloqError::Cancelled)), "{outcome:?}");
        assert!(!std::path::Path::new(&dest).exists(), "a zip was left");
        assert_eq!(record_backup_run(), None, "the run was kept");

        crate::runtime::block_on(engine.run_record_backup(dest.clone()))
            .expect("the next backup runs whole");
        assert!(std::path::Path::new(&dest).exists());
    }

    /// An export that outlives a library wipe answers an error and leaves no
    /// file, so the next athlete is never offered the previous one's counts.
    #[test]
    fn an_export_across_a_wipe_fails_and_leaves_no_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("all.zip");
        let dest_path = dest.to_string_lossy().into_owned();
        std::fs::write(&dest, b"previous athlete").expect("write");

        assert!(settle_bulk_export(1, 2, &dest_path, Ok(7_u32)).is_err());
        assert!(!dest.exists());

        std::fs::write(&dest, b"current athlete").expect("write");
        assert_eq!(settle_bulk_export(2, 2, &dest_path, Ok(7_u32)), Ok(7));
        assert!(dest.exists());
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
