//! Detector cutover: one-time re-cut of a catalogue an older build produced.
//!
//! A database carries the method that cut its catalogue in `schema_info`. One
//! cut by a build before this detector is archived, re-cut cold, and diffed,
//! resumably, driven by a persisted token.
//!
//! Sequence: archive, commit token, cold detect, diff, promote.
//!
//! The archive is the ledger. Each outgoing section becomes one
//! `archived` row in `section_history` naming a milestone version in
//! `section_geometry`, which holds the activity and range its line was sliced
//! from and a copy of the line only while that range cannot rebuild it. The
//! diff reads those rows, so a past catalogue state is pinned, rolled back and
//! backed up like any other version, and nothing is trimmed at promotion.
//! There is no other detector to go back to, so the config stays as it is.

use crate::objects::FfiStartOutcome;
use crate::objects::observer::Announcement;
use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, record_job_run};
use crate::persistence::sections::{KIND_ARCHIVED, geometry, history};
use crate::persistence::{
    PersistentEngine, codec, engine_install, settings_keys, suspend_detection,
    with_persistent_engine, with_persistent_engine_for,
};
use log::info;
use rusqlite::{OptionalExtension, params};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tracematch::sections::SectionConfig;

/// The id of the current cutover. Absent in settings means never cut over.
/// Equal means done. Anything else means a future or reverted cutover.
const CUTOVER_ID: &str = "unified-1";

/// Settings key for the cutover token.
pub(super) const CUTOVER_KEY: &str = "__detector_cutover";

/// Settings key for the serialised diff payload (JSON).
pub(super) const CUTOVER_DIFF_KEY: &str = "__detector_cutover_diff";

/// The section config the switch replaced, kept until the token is promoted
/// so a resumed run can still name it in the diff.
pub(super) const CUTOVER_PREVIOUS_CONFIG_KEY: &str = "__detector_cutover_previous_config";

/// The token and the `section_history` ids this library's archive wrote, so a
/// resumed run reuses its snapshot and its diff reads only it. A restore can
/// place another library's archived rows under the same token, so the token
/// alone does not say which rows are this library's.
pub(super) const CUTOVER_ARCHIVE_KEY: &str = "__detector_cutover_archive";

/// Sentinel written on revert, so the cutover does not re-fire.
const CUTOVER_REVERTED: &str = "reverted";

/// Written before the detect and promoted to `CUTOVER_ID` only once the diff
/// is durable. A token found in this state means a previous run died partway:
/// the config already says Unified, so the method check cannot detect it, and
/// without this the install would sit on a half-finished migration forever.
const CUTOVER_INFLIGHT: &str = "unified-1-inflight";

static CUTOVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Set by [`cancel_cutover`], read at every step boundary of the run.
///
/// The flag belongs to the run it stops and is cleared when the next one
/// claims the slot, so a cancel means "not this session" and never "not
/// ever". Only the token says whether the migration is owed, and a cancel does
/// not touch it: the run this stops is retried from the top on the next
/// launch, which is the same thing a force-quit at the same point gets.
static CUTOVER_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Ask the running cutover to stop at its next step boundary.
///
/// The cut is a cold detect over the whole library on the launch path, and
/// until this the only lever was a force-quit, which the in-flight token undid
/// on the next launch anyway. Cancelling costs the run's work and nothing
/// else: every point it can stop at is a point the crash path already leaves
/// the library at, so the next launch resumes from the top.
pub fn cancel_cutover() {
    CUTOVER_CANCELLED.store(true, Ordering::SeqCst);
}

/// Whether the run in flight has been asked to stop.
pub fn cutover_cancelled() -> bool {
    CUTOVER_CANCELLED.load(Ordering::SeqCst)
}

fn has_unprocessed_activity(activity_ids: &[String], processed_ids: &[String]) -> bool {
    let processed: std::collections::HashSet<&String> = processed_ids.iter().collect();
    activity_ids.iter().any(|id| !processed.contains(id))
}

trait CutoverDetect {
    fn receive(
        &self,
        limit: std::time::Duration,
    ) -> (
        crate::persistence::WorkerPoll<super::DetectionOutput>,
        Option<super::CacheUpdate>,
    );
    fn request_cancel(&self);
}

impl CutoverDetect for super::SectionDetectionHandle {
    fn receive(
        &self,
        limit: std::time::Duration,
    ) -> (
        crate::persistence::WorkerPoll<super::DetectionOutput>,
        Option<super::CacheUpdate>,
    ) {
        self.recv_state_with_cache_within(Some(limit))
    }

    fn request_cancel(&self) {
        super::SectionDetectionHandle::request_cancel(self);
    }
}

/// A timed-out cutover detect that is still folding.
///
/// The fold reads the cancel after each cluster, so a worker the wait gave up
/// on stops at the next cluster boundary, and until then holds the whole track
/// pool resident.
trait OrphanedDetect {
    fn still_running(&self) -> bool;
}

impl OrphanedDetect for super::SectionDetectionHandle {
    fn still_running(&self) -> bool {
        matches!(self.poll_state(), crate::persistence::WorkerPoll::Running)
    }
}

/// A cutover detect the run can both wait on and, past its limit, abandon.
trait CutoverWorker: CutoverDetect + OrphanedDetect + Send {}

impl<T: CutoverDetect + OrphanedDetect + Send> CutoverWorker for T {}

/// The detect the last run gave up on, held until its worker settles.
static ORPHANED_DETECT: Mutex<Option<Box<dyn OrphanedDetect + Send>>> = Mutex::new(None);

fn adopt_orphaned_detect(orphan: Box<dyn OrphanedDetect + Send>) {
    *ORPHANED_DETECT.lock().unwrap_or_else(|e| e.into_inner()) = Some(orphan);
}

/// Whether an abandoned detect is still folding, forgetting it once it is not.
fn orphaned_detect_running() -> bool {
    let mut held = ORPHANED_DETECT.lock().unwrap_or_else(|e| e.into_inner());
    let running = held.as_ref().is_some_and(|orphan| orphan.still_running());
    if !running {
        *held = None;
    }
    running
}

/// Take the run slot, or refuse while a run holds it or while the detect the
/// last run gave up on is still folding. A retry beside that worker would load
/// the whole pool a second time.
fn claim_run_slot() -> bool {
    if CUTOVER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return false;
    }
    // Read under the claim, since a run adopts its orphan before it lets the
    // slot go.
    if orphaned_detect_running() {
        CUTOVER_RUNNING.store(false, Ordering::SeqCst);
        return false;
    }
    true
}

/// The wait's answer when the athlete's cancel stopped the worker.
const DETECT_CANCELLED: &str = "detect cancelled";

/// How often the wait takes the run's newest checkpoint to disk.
const CHECKPOINT_POLL: std::time::Duration = std::time::Duration::from_millis(250);

/// Wait up to `limit` for the detect, persisting its checkpoints on the way.
///
/// The cutover's handle is never the shared one, so no driver persists its
/// checkpoints. Taken only at the limit, they never reached disk for a process
/// the OS killed before it, and every such launch detected from zero.
fn wait_for_cutover_detect(
    handle: &(impl CutoverDetect + ?Sized),
    limit: std::time::Duration,
    mut persist: impl FnMut(super::CacheUpdate),
) -> Result<(super::DetectionOutput, Option<super::CacheUpdate>), String> {
    let started = std::time::Instant::now();
    // The worker sends its final update just before its answer, so a step can
    // read the one without the other. It belongs to the answer.
    let mut final_update = None;
    let mut cancel_sent = false;
    loop {
        let step = limit.saturating_sub(started.elapsed()).min(CHECKPOINT_POLL);
        let (main, cache_update) = handle.receive(step);
        match main {
            crate::persistence::WorkerPoll::Ready(output) => {
                return Ok((output, final_update.or(cache_update)));
            }
            crate::persistence::WorkerPoll::Died if cancel_sent => {
                return Err(DETECT_CANCELLED.to_string());
            }
            crate::persistence::WorkerPoll::Died => return Err("detect died".to_string()),
            crate::persistence::WorkerPoll::Running => {
                match cache_update {
                    Some(update) if !update.checkpoint => final_update = Some(update),
                    Some(checkpoint) => persist(checkpoint),
                    None => {}
                }
                if started.elapsed() >= limit {
                    handle.request_cancel();
                    return Err("detect never answered".to_string());
                }
                // Forwarded once, then the wait stays bounded by the limit
                // until the worker settles, so the caller finds it stopped.
                if !cancel_sent && cutover_cancelled() {
                    handle.request_cancel();
                    cancel_sent = true;
                }
            }
        }
    }
}

/// Whether section ids derive from the ground rather than the clock. Until
/// they do, two devices cut the same library into the same sections under
/// different ids, and the card must not claim otherwise.
pub const CONTENT_DERIVED_IDS: bool = true;

/// Digest of the configuration this build's corpus figures were measured at.
/// The parameters are per device and no server holds them, so two devices
/// only cut a library the same way while both sit on this one.
fn validated_config_digest() -> String {
    super::sections::section_config_digest(&tracematch::sections::SectionConfig::default())
}

/// The claims the change card may make for a catalogue cut by `method` under
/// `config`. A flag is false until its feature ships, so the card never says
/// more than the build can show.
pub(crate) fn change_card_support_for(
    method: Option<&str>,
    config: &SectionConfig,
) -> ChangeCardSupport {
    let unified = method == Some(super::sections::DETECTOR_METHOD);
    ChangeCardSupport {
        deterministic: unified,
        same_result_drip_or_batch: unified,
        ledger: true,
        revert: true,
        retired: true,
        pinned_survive: true,
        // Ids reproduce for the same activities in the same order, which
        // one device cannot check. The other half is the config, which the
        // user's own sliders move and nothing syncs.
        same_on_every_device: CONTENT_DERIVED_IDS
            && super::sections::section_config_digest(config) == validated_config_digest(),
    }
}

/// [`change_card_support_for`] over the rows a pooled connection reads: the
/// stored catalogue method and the persisted section config.
pub(crate) fn change_card_support_from(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<ChangeCardSupport> {
    let config = super::settings::section_config_from(conn)?;
    let method = super::sections::pooled::catalogue_detection_method(conn);
    Ok(change_card_support_for(method.as_deref(), &config))
}

/// The claims the change card is allowed to make on this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangeCardSupport {
    pub deterministic: bool,
    pub same_result_drip_or_batch: bool,
    pub ledger: bool,
    pub revert: bool,
    pub retired: bool,
    pub pinned_survive: bool,
    pub same_on_every_device: bool,
}

/// Where a run has got to, for the settings status line. Terminal phases are
/// set before the guard drops, so a reader never sees `running = false` beside
/// a phase that is still mid-flight.
pub const PHASE_IDLE: &str = "idle";
pub const PHASE_DRAINING: &str = "draining";
pub const PHASE_ARCHIVING: &str = "archiving";
pub const PHASE_DETECTING: &str = "detecting";
pub const PHASE_DIFFING: &str = "diffing";
pub const PHASE_COMPLETE: &str = "complete";
pub const PHASE_FAILED: &str = "failed";
/// Failed after the new catalogue was applied: the sections were re-cut and
/// only the summary of the change is still owed, which the next launch writes.
pub const PHASE_FAILED_AFTER_APPLY: &str = "failed_after_apply";

static CUTOVER_PHASE: Mutex<&'static str> = Mutex::new(PHASE_IDLE);

fn set_phase(phase: &'static str) {
    *CUTOVER_PHASE.lock().unwrap_or_else(|e| e.into_inner()) = phase;
}

/// The current phase, for the status surface.
pub fn cutover_phase() -> &'static str {
    *CUTOVER_PHASE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Moves the phase and times each one on the way past.
///
/// A cutover is a run the user waits through at launch, and a field report of a
/// slow one names no phase. Timing rides on the transition rather than on a
/// wrapper around each step so a phase added later is timed by construction,
/// and the drop closes the open phase when a run fails partway, which is the
/// run whose duration matters most.
struct PhaseClock {
    phase: &'static str,
    started: std::time::Instant,
    run_started: std::time::Instant,
    /// Whether the new catalogue has replaced the old one, so a failure from
    /// here on is not one that left the sections unchanged.
    applied: bool,
}

impl PhaseClock {
    fn new() -> Self {
        let now = std::time::Instant::now();
        Self {
            phase: PHASE_IDLE,
            started: now,
            run_started: now,
            applied: false,
        }
    }

    /// Close the phase in progress and open `next`.
    fn enter(&mut self, next: &'static str) {
        self.close();
        self.phase = next;
        self.started = std::time::Instant::now();
        set_phase(next);
    }

    /// Close the phase in progress and settle on a terminal phase, which has no
    /// duration of its own.
    fn finish(mut self, terminal: &'static str) {
        self.close();
        self.phase = PHASE_IDLE;
        set_phase(terminal);
    }

    fn close(&mut self) {
        if self.phase == PHASE_IDLE {
            return;
        }
        info!(
            "veloqrs: [cutover] Phase {} took {}ms",
            self.phase,
            crate::elapsed_ms(self.started)
        );
    }

    fn mark_applied(&mut self) {
        self.applied = true;
    }

    fn run_ms(&self) -> u64 {
        crate::elapsed_ms(self.run_started)
    }
}

impl Drop for PhaseClock {
    fn drop(&mut self) {
        self.close();
        // The only code that runs on every abnormal exit. `enter` erased the
        // marker `run_cutover_claimed` set up front, and `finish` settles the
        // phase to idle before dropping, so a clock still inside a phase here
        // is a run that died in it.
        if self.phase != PHASE_IDLE {
            set_phase(if self.applied {
                PHASE_FAILED_AFTER_APPLY
            } else {
                PHASE_FAILED
            });
        }
    }
}

/// What a run did. `NotOwed` is a success with nothing to do, which a bare
/// string return cannot express: the caller needs to tell it apart from a
/// completed migration and from a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CutoverOutcome {
    NotOwed,
    Completed(String),
    /// The athlete stopped it. The migration is still owed and the next launch
    /// runs it again, so this is neither a success nor a failure.
    Cancelled,
}

/// Start a cutover on a detached thread.
///
/// Returns the reason for a refusal or `Started` when the run owns its slot.
pub fn start_cutover() -> FfiStartOutcome {
    // Both reads go through the pool, so a sync page or a detection apply
    // holding the write lock does not hold the JS thread that asked. The
    // queue is counted only once the migration is known to be owed.
    let Ok(owed) = crate::objects::error::with_reader(|conn| {
        pooled::cutover_is_owed(conn) || crate::persistence::sections::anchoring_owed(conn)
    }) else {
        return FfiStartOutcome::NotReady;
    };
    if !owed {
        return FfiStartOutcome::NotOwed;
    }
    match crate::objects::error::with_reader(
        crate::net::elevation_backfill::pooled_elevation_backfill_remaining,
    ) {
        Ok(Ok(0)) => {}
        Ok(Ok(_)) => return FfiStartOutcome::Held,
        _ => return FfiStartOutcome::NotReady,
    }
    if !claim_run_slot() {
        return FfiStartOutcome::Busy;
    }
    // Which library this cutover belongs to, read here rather than on the
    // worker: a restore mid-run would otherwise get a catalogue cut from the
    // old library's tracks.
    let install = engine_install();
    crate::threads::spawn_named("veloq-cutover", move || {
        // The flag is already claimed, so the run adopts it rather than
        // taking it again.
        let outcome = run_cutover_claimed(install, &|_phase: &str| cutover_cancelled());
        if let Err(ref e) = outcome {
            log::warn!("veloqrs: [cutover] Run failed: {}", e);
        }
    });
    FfiStartOutcome::Started
}

// ───────────────────────────────────────────────────────────────────
// State queries
// ───────────────────────────────────────────────────────────────────

/// Whether the cutover has not yet completed.
///
/// Computed live. A cached answer goes stale the moment the catalogue changes,
/// and the catalogue routinely arrives after `load()`: a first sync detects,
/// and a quarantined reopen swaps the database underneath. Both would leave a
/// cached `false` on an install that is owed a migration. The read is one
/// EXISTS against a small table, on a path that runs at launch and on a status
/// poll, so the cache was never buying anything.
pub fn cutover_pending() -> bool {
    crate::objects::error::with_reader(pooled::cutover_is_owed).unwrap_or(false)
}

/// Whether a cutover run is in flight.
pub fn cutover_running() -> bool {
    CUTOVER_RUNNING.load(Ordering::SeqCst)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CutoverState {
    /// Token absent or unrecognised: never cut over.
    Never,
    /// A previous run committed the switch and died before finishing.
    InFlight,
    /// Token matches CUTOVER_ID: already done.
    Done,
    /// Token is the reverted sentinel: user rolled back.
    Reverted,
}

/// The cutover reads that need committed rows only, on a connection that holds
/// no engine lock.
pub(crate) mod pooled {
    use super::{
        CUTOVER_DIFF_KEY, CUTOVER_ID, CUTOVER_INFLIGHT, CUTOVER_KEY, CUTOVER_REVERTED, CutoverState,
    };
    use crate::persistence::settings::setting_from;
    use rusqlite::Connection;

    fn cutover_state(conn: &Connection) -> CutoverState {
        match setting_from(conn, CUTOVER_KEY) {
            Ok(Some(ref v)) if v == CUTOVER_ID => CutoverState::Done,
            Ok(Some(ref v)) if v == CUTOVER_REVERTED => CutoverState::Reverted,
            Ok(Some(ref v)) if v == CUTOVER_INFLIGHT => CutoverState::InFlight,
            _ => CutoverState::Never,
        }
    }

    fn has_archivable_catalogue(conn: &Connection) -> bool {
        conn.query_row(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM sections WHERE {})",
                crate::persistence::sections::DERIVED_SECTION_PREDICATE
            ),
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n == 1)
        .unwrap_or(false)
            || crate::persistence::sections::anchoring_owed(conn)
    }

    /// Whether the migration still has work to do.
    ///
    /// An in-flight token is always owed: its config already reads Unified, so
    /// the method check would wave it through as finished when in fact it died
    /// mid-run. A never-seen token is owed only while the stored catalogue was
    /// cut by another detector, so a catalogue this build cut is left alone.
    pub(crate) fn cutover_is_owed(conn: &Connection) -> bool {
        match cutover_state(conn) {
            CutoverState::InFlight => true,
            CutoverState::Never => {
                crate::persistence::sections::pooled::catalogue_detection_method(conn).as_deref()
                    != Some(crate::persistence::sections::DETECTOR_METHOD)
                    && has_archivable_catalogue(conn)
            }
            CutoverState::Done | CutoverState::Reverted => false,
        }
    }

    /// The stored diff payload as the reader sees it, and whether the row
    /// still carries geometry an older build wrote and so is owed a rewrite.
    pub(crate) struct StoredDiff {
        pub(crate) payload: String,
        pub(crate) trim_owed: bool,
    }

    /// The stored diff, trimmed in memory. None before the cutover has run.
    pub(crate) fn stored_cutover_diff(conn: &Connection) -> Option<StoredDiff> {
        let stored = setting_from(conn, CUTOVER_DIFF_KEY).ok().flatten()?;
        Some(match super::trimmed(&stored) {
            Some(payload) => StoredDiff {
                payload,
                trim_owed: true,
            },
            None => StoredDiff {
                payload: stored,
                trim_owed: false,
            },
        })
    }
}

/// The diff payload without the section rows an older build wrote, or None
/// when it carries none and the row is as it should be.
fn trimmed(stored: &str) -> Option<String> {
    let mut payload = serde_json::from_str::<serde_json::Value>(stored).ok()?;
    payload.as_object_mut()?.remove("sections")?;
    serde_json::to_string(&payload).ok()
}

/// The stored diff payload for the FFI read. Reads on a pooled connection, and
/// takes the engine write lock only when the row carries legacy geometry and a
/// rewrite is owed.
pub fn cutover_diff_payload() -> Option<String> {
    let stored = crate::objects::error::with_reader(pooled::stored_cutover_diff)
        .ok()
        .flatten()?;
    if stored.trim_owed {
        persist_trimmed_diff(&stored.payload);
    }
    Some(stored.payload)
}

fn persist_trimmed_diff(trimmed: &str) {
    let written = with_persistent_engine(|e| e.set_setting(CUTOVER_DIFF_KEY, trimmed));
    if !matches!(written, Some(Ok(()))) {
        // The caller still gets the trimmed copy; the row is retried on the
        // next read.
        log::warn!("veloqrs: [cutover] Failed to trim the stored diff");
    }
}

impl PersistentEngine {
    /// Called from `load()`. Reads the cutover token and sets the
    /// process-global pending flag. Nothing slow, nothing fallible beyond
    /// a missing settings table (which returns None).
    pub(super) fn check_cutover_state(&self) {
        if self.cutover_is_owed() {
            info!("veloqrs: [cutover] Cutover to Unified is owed");
        }
    }

    /// Whether the migration still has work to do, read from the connection
    /// the engine holds. [`pooled::cutover_is_owed`] is the same answer without
    /// the engine lock.
    pub fn cutover_is_owed(&self) -> bool {
        pooled::cutover_is_owed(&self.db)
    }
}

// ───────────────────────────────────────────────────────────────────
// Archive
// ───────────────────────────────────────────────────────────────────

/// One section the archive is about to snapshot, read before its line is
/// resolved.
struct ArchivableSection {
    id: String,
    name: Option<String>,
    sport_type: String,
    blob: Option<Vec<u8>>,
    json: Option<String>,
    distance_meters: f64,
    visit_count: Option<u32>,
    created_at: Option<String>,
    rep_activity_id: Option<String>,
    rep_start: Option<u32>,
    rep_end: Option<u32>,
    consensus: bool,
}

/// The first and last `section_history` id one archive wrote under `token`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ArchiveRange {
    token: String,
    first: Option<i64>,
    last: Option<i64>,
}

/// The range this library's archive wrote under `token`, if it wrote one.
fn archive_range_on(
    conn: &rusqlite::Connection,
    token: &str,
) -> rusqlite::Result<Option<ArchiveRange>> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            params![CUTOVER_ARCHIVE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|json| serde_json::from_str::<ArchiveRange>(&json).ok())
        .filter(|range| range.token == token))
}

fn store_archive_range_on(
    conn: &rusqlite::Connection,
    range: &ArchiveRange,
) -> rusqlite::Result<()> {
    let json = serde_json::to_string(&range)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        params![CUTOVER_ARCHIVE_KEY, json],
    )?;
    Ok(())
}

/// What an archived row says about the section besides its shape.
fn archived_details(
    token: &str,
    name: Option<&str>,
    sport_type: &str,
    distance_meters: f64,
    visit_count: Option<u32>,
    created_at: Option<&str>,
) -> String {
    serde_json::json!({
        "token": token,
        "name": name,
        "sport_type": sport_type,
        "distance_meters": distance_meters,
        "visit_count": visit_count,
        "created_at": created_at,
    })
    .to_string()
}

/// One archived row: section id, details and the version that draws the state.
type ArchivedRow = (String, Option<String>, Option<i64>);

/// The archived rows of `token` inside `range`.
fn archived_rows_in(
    conn: &rusqlite::Connection,
    range: &ArchiveRange,
) -> rusqlite::Result<Vec<ArchivedRow>> {
    let (Some(first), Some(last)) = (range.first, range.last) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT section_id, details, geometry_version FROM section_history
         WHERE id BETWEEN ? AND ? AND kind = ? AND json_extract(details, '$.token') = ?
         ORDER BY id",
    )?;
    stmt.query_map(params![first, last, KIND_ARCHIVED, range.token], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?
    .collect()
}

impl PersistentEngine {
    /// Step 1: keep every auto section about to be wiped as a ledger state.
    /// The row predicate is `write_catalogue`'s DELETE predicate: exactly the
    /// rows the coming detect destroys, no more.
    ///
    /// Each state is an `archived` history row and the milestone version it
    /// names, written in one transaction with the range they occupy.
    fn archive_current_catalogue(&self) -> rusqlite::Result<u32> {
        let tx = self.db.unchecked_transaction()?;

        // Write-once per token. A run that died after the switch and before
        // the promotion retries with the new catalogue already on disk, and
        // archiving again would bury the snapshot the diff needs.
        if let Some(range) = archive_range_on(&tx, CUTOVER_ID)? {
            let kept = archived_rows_in(&tx, &range)?.len() as u32;
            info!("veloqrs: [cutover] Reusing archive of {} sections", kept);
            return Ok(kept);
        }

        let mut stmt = tx.prepare(&format!(
            "SELECT id,
                    COALESCE(name, (SELECT i.name FROM section_intents i
                                    WHERE i.id = 'ni_bf_' || sections.id
                                      AND i.kind = 'named')),
                    sport_type, polyline_blob, polyline_json,
                    distance_meters, visit_count, created_at,
                    representative_activity_id, rep_start_index, rep_end_index,
                    geometry_source IS 'consensus'
             FROM sections
             WHERE {}",
            crate::persistence::sections::DERIVED_SECTION_PREDICATE
        ))?;
        let archivable: Vec<ArchivableSection> = stmt
            .query_map([], |row| {
                Ok(ArchivableSection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    blob: row.get(3)?,
                    json: row.get(4)?,
                    distance_meters: row.get(5)?,
                    visit_count: row.get(6)?,
                    created_at: row.get(7)?,
                    rep_activity_id: row.get(8)?,
                    rep_start: row.get(9)?,
                    rep_end: row.get(10)?,
                    consensus: row.get(11)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        let mut range = ArchiveRange {
            token: CUTOVER_ID.to_string(),
            first: None,
            last: None,
        };
        for section in &archivable {
            // An averaged line belongs to no activity, so its range is not
            // its provenance and the line is kept whole.
            let reference = geometry::reference(
                section.rep_activity_id.as_deref(),
                section.rep_start,
                section.rep_end,
            )
            .filter(|_| !section.consensus);
            let line = geometry::line(
                &tx,
                section.blob.as_deref(),
                section.json.as_deref(),
                reference,
            )
            .unwrap_or_default();
            let version = history::record_archived_geometry_on(&tx, &section.id, &line, reference)?;
            let details = archived_details(
                CUTOVER_ID,
                section.name.as_deref(),
                &section.sport_type,
                section.distance_meters,
                section.visit_count,
                section.created_at.as_deref(),
            );
            let row = history::append_history_on(
                &tx,
                &section.id,
                KIND_ARCHIVED,
                Some(&details),
                version,
                None,
            )?;
            range.first.get_or_insert(row);
            range.last = Some(row);
        }
        store_archive_range_on(&tx, &range)?;

        tx.commit()?;
        info!(
            "veloqrs: [cutover] Archived {} auto sections into the ledger under token '{}'",
            archivable.len(),
            CUTOVER_ID
        );
        Ok(archivable.len() as u32)
    }

    /// Step 2: persist the canonical config and write the token, atomically
    /// with the archive.
    fn commit_switch(&mut self) -> rusqlite::Result<()> {
        // The detector is validated at its defaults, which are UNIFIED_CONFIG
        // on the TS side. A slider an older build let the athlete move is
        // reset here and reported on the change card.
        let config = SectionConfig::default();
        let stored_default = self
            .get_setting(settings_keys::SECTION_CONFIG_JSON)?
            .and_then(|json| serde_json::from_str::<SectionConfig>(&json).ok())
            .is_some_and(|stored| stored == config);
        if self.get_setting(CUTOVER_KEY)?.as_deref() == Some(CUTOVER_INFLIGHT)
            && stored_default
            && self.section_config == config
        {
            self.restore_evidence_cache();
            return Ok(());
        }
        let to_json = |c: &SectionConfig| {
            serde_json::to_string(c).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
            })
        };
        let json = to_json(&config)?;

        let tx = self.db.unchecked_transaction()?;
        // Write-once: a resumed run already holds the defaults, and the
        // values worth reporting are the ones the first run replaced.
        if self.section_config != config {
            tx.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                params![CUTOVER_PREVIOUS_CONFIG_KEY, to_json(&self.section_config)?],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![settings_keys::SECTION_CONFIG_JSON, json],
        )?;
        // In-flight, not done: the detect and the diff have not happened yet.
        // Promoted by `finish_cutover` once the diff is durable.
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_INFLIGHT],
        )?;
        // Cleared inside the switch, so a crash before the detect cannot leave
        // a full processed set that would short-circuit the next detect into
        // re-emitting the Corridor catalogue under a Unified label.
        tx.execute("DELETE FROM processed_activities", [])?;
        tx.commit()?;

        self.section_config = config;
        self.processed_activity_ids.clear();
        // The processed set and the evidence cache are two shadows of the same
        // state, so they clear in lockstep and the detect below cold-rebatches
        // under the new detector.
        self.invalidate_evidence_cache();
        // The debounce absorbs detector noise over k detects, and a detector
        // generation change is not noise. Left armed, a section whose Unified
        // extents disagree with its Corridor ones is a material re-cut and
        // carries frozen, which keeps the Corridor averaged line and its NULL
        // reference alive under a Unified label. Ids still carry; the first
        // Unified batch is simply believed.
        self.section_identity_reseed_decisive();
        info!("veloqrs: [cutover] Committed switch to Unified, token in flight");
        Ok(())
    }

    /// Promote the in-flight token once the diff is stored. Until this runs,
    /// the cutover is owed and re-runs from the top on the next launch.
    ///
    /// The archived states stay in the ledger for good, and so does the range
    /// that names them.
    fn finish_cutover(&self, diff: &str) -> rusqlite::Result<()> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_DIFF_KEY, diff],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![CUTOVER_KEY, CUTOVER_ID],
        )?;
        // The diff carries the old values from here on.
        tx.execute(
            "DELETE FROM settings WHERE key = ?",
            params![CUTOVER_PREVIOUS_CONFIG_KEY],
        )?;
        tx.commit()?;
        info!("veloqrs: [cutover] Token promoted to '{}'", CUTOVER_ID);
        Ok(())
    }

    /// Build the diff payload comparing archive (old catalogue) to the
    /// current live catalogue.
    fn build_cutover_diff(&self) -> rusqlite::Result<String> {
        // Load the archived states as FrequentSection stand-ins (polyline + id
        // + name + sport + visits + distance). We only need the fields
        // `diff_catalogues` reads.
        let archived = self.load_archived_sections(CUTOVER_ID)?;
        let live: Vec<&tracematch::sections::FrequentSection> = self
            .sections
            .iter()
            // `is_user_defined` is the whole test. Ids are minted by the
            // identity registry, so no prefix identifies an auto section.
            .filter(|s| !s.is_user_defined)
            .collect();

        // Reuse diff_catalogues with archive = old, live = new. Only the
        // counts are stored: a section is a reference activity and the
        // indices of a pass over it, and the rows carry an encoded line for
        // every section on both sides. Keeping them put both catalogues'
        // geometry in a settings row for the life of the install. The rows
        // are the preview's, which is the function's other caller.
        let (counts, _rows) = super::sections::preview::diff_catalogues_public(&live, &archived);

        let payload = serde_json::json!({
            "token": CUTOVER_ID,
            "counts": counts,
            "settings_reset": self.settings_reset()?,
        });
        let json = serde_json::to_string(&payload).unwrap_or_default();

        info!(
            "veloqrs: [cutover] Diff built: {} current, {} new, {} changed, {} gone",
            counts.current, counts.new, counts.changed, counts.gone
        );
        Ok(json)
    }

    /// The config the switch replaced beside the one it wrote, or null when
    /// the library was already at the validated values.
    fn settings_reset(&self) -> rusqlite::Result<serde_json::Value> {
        let Some(json) = self.get_setting(CUTOVER_PREVIOUS_CONFIG_KEY)? else {
            return Ok(serde_json::Value::Null);
        };
        let previous: SectionConfig = match serde_json::from_str(&json) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("veloqrs: [cutover] Unreadable previous config: {}", e);
                return Ok(serde_json::Value::Null);
            }
        };
        Ok(serde_json::json!({
            "previous": previous,
            "current": self.section_config,
        }))
    }

    /// The states this run archived under `token`, each drawn from the
    /// version it names. A state whose range cannot rebuild it here draws
    /// nothing, which the diff reads as a changed shape.
    fn load_archived_sections(
        &self,
        token: &str,
    ) -> rusqlite::Result<Vec<tracematch::sections::FrequentSection>> {
        let Some(range) = archive_range_on(&self.db, token)? else {
            return Ok(Vec::new());
        };
        let mut archived = archived_rows_in(&self.db, &range)?;
        archived.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(archived
            .into_iter()
            .map(|(id, details, version)| {
                let details: serde_json::Value = details
                    .as_deref()
                    .and_then(|d| serde_json::from_str(d).ok())
                    .unwrap_or(serde_json::Value::Null);
                let polyline = version
                    .and_then(|v| history::pooled::section_geometry_version(&self.db, &id, v))
                    .map(|(points, _)| points)
                    .unwrap_or_default();
                let text = |key: &str| {
                    details
                        .get(key)
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                };
                tracematch::sections::FrequentSection {
                    id,
                    name: text("name"),
                    sport_type: text("sport_type").unwrap_or_default(),
                    polyline,
                    distance_meters: details
                        .get("distance_meters")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    visit_count: details
                        .get("visit_count")
                        .and_then(|v| v.as_u64())
                        .and_then(|v| u32::try_from(v).ok())
                        .unwrap_or(0),
                    created_at: text("created_at"),
                    representative_activity_id: String::new(),
                    representative_range: None,
                    activity_ids: Vec::new(),
                    activity_portions: Vec::new(),
                    activity_traces: std::collections::HashMap::new(),
                    confidence: 0.0,
                    observation_count: 0,
                    average_spread: 0.0,
                    point_density: Vec::new(),
                    scale: None,
                    is_user_defined: false,
                    stability: 0.0,
                    elevation_gain_m: None,
                    avg_grade_percent: None,
                    version: 1,
                    updated_at: None,
                    enrichment: Default::default(),
                    rank: None,
                    consensus_state: None,
                }
            })
            .collect())
    }

    /// Which claims the change card may make, each backed by the tables and
    /// code that deliver it. A flag is false until its feature ships, so the
    /// card never says more than the build can show.
    pub fn change_card_support(&self) -> ChangeCardSupport {
        change_card_support_for(
            self.catalogue_detection_method().as_deref(),
            &self.section_config,
        )
    }

    /// The stored diff payload, if any. None before the cutover has run.
    ///
    /// The key is written once at promotion and deleted only by the sign-out
    /// wipe, so an install that migrated before the section rows left the
    /// payload carries both catalogues' geometry for good. The read is the only
    /// place left to catch it, so it rewrites the row trimmed.
    pub fn cutover_diff(&self) -> Option<String> {
        let stored = pooled::stored_cutover_diff(&self.db)?;
        if stored.trim_owed
            && let Err(e) = self.set_setting(CUTOVER_DIFF_KEY, &stored.payload)
        {
            // The caller still gets the trimmed copy; the row is retried on
            // the next read.
            log::warn!("veloqrs: [cutover] Failed to trim the stored diff: {}", e);
        }
        Some(stored.payload)
    }
}

// ───────────────────────────────────────────────────────────────────
// The archive an older build wrote
// ───────────────────────────────────────────────────────────────────

/// One row of the archive tables an older build wrote.
struct LegacyArchiveRow {
    token: String,
    section_id: String,
    name: Option<String>,
    sport_type: String,
    blob: Option<Vec<u8>>,
    json: Option<String>,
    distance_meters: f64,
    visit_count: Option<u32>,
    created_at: Option<String>,
}

/// Carry the archive tables an older build wrote into the ledger, before the
/// migration that drops them. Returns how many states it wrote.
///
/// A row whose line is still stored keeps it, as the version that already
/// draws it when the ledger holds one, and otherwise as a new milestone named
/// by the live row's range when that range re-slices to it. A row a promotion
/// trimmed has no line left, so it names the shape the cutover's own detect
/// milestoned when it replaced the section, or no shape at all. Its name,
/// sport, distance, count and birth travel either way. The rows get their
/// range, so an in-flight cutover's retry reads them as its snapshot.
///
/// Idempotent, so a kill between this commit and the drop repeats nothing.
pub(super) fn carry_legacy_archive_into_ledger(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<u32> {
    carry_legacy_archive_between(conn, conn)
}

/// The same carry with the archive read from `source` and the ledger written
/// in `conn`, which is how a quarantine salvage moves a file's archive into
/// the fresh library. The ledger rows the carry keys on (`algorithm_changed`
/// versions, live section ranges) are read from `conn`, so they must already
/// be salvaged.
pub(super) fn carry_legacy_archive_between(
    source: &rusqlite::Connection,
    conn: &rusqlite::Connection,
) -> rusqlite::Result<u32> {
    let present: bool = source.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master
                       WHERE type = 'table' AND name = 'section_catalogue_archive')",
        [],
        |row| row.get(0),
    )?;
    if !present {
        return Ok(0);
    }
    let rows: Vec<LegacyArchiveRow> = {
        let mut stmt = source.prepare(
            "SELECT token, section_id, name, sport_type, polyline_blob, polyline_json,
                    distance_meters, visit_count, created_at
             FROM section_catalogue_archive ORDER BY token, section_id",
        )?;
        stmt.query_map([], |row| {
            Ok(LegacyArchiveRow {
                token: row.get(0)?,
                section_id: row.get(1)?,
                name: row.get(2)?,
                sport_type: row.get(3)?,
                blob: row.get(4)?,
                json: row.get(5)?,
                distance_meters: row.get(6)?,
                visit_count: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    if rows.is_empty() {
        return Ok(0);
    }

    let tx = conn.unchecked_transaction()?;
    let mut range = ArchiveRange {
        token: CUTOVER_ID.to_string(),
        first: None,
        last: None,
    };
    let mut written = 0u32;
    for row in rows {
        let carried: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM section_history
                           WHERE section_id = ? AND kind = ?
                             AND json_extract(details, '$.token') = ?)",
            params![row.section_id, KIND_ARCHIVED, row.token],
            |r| r.get(0),
        )?;
        if carried {
            continue;
        }
        // When the cutover's detect replaced the section, which is the moment
        // the archived shape stopped being the live one.
        let replaced: Option<(String, Option<i64>)> = tx
            .query_row(
                "SELECT at, geometry_version FROM section_history
                 WHERE section_id = ? AND kind = 'algorithm_changed' ORDER BY id LIMIT 1",
                params![row.section_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let line = codec::decode_polyline_row(row.blob.as_deref(), row.json.as_deref())
            .unwrap_or_default();
        let version = if line.is_empty() {
            let milestoned = replaced.as_ref().and_then(|(_, version)| *version);
            match milestoned {
                Some(version) => tx
                    .query_row(
                        "SELECT version FROM section_geometry WHERE section_id = ? AND version = ?",
                        params![row.section_id, version],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()?,
                None => None,
            }
        } else {
            let live: Option<(Option<String>, Option<u32>, Option<u32>)> = tx
                .query_row(
                    "SELECT representative_activity_id, rep_start_index, rep_end_index
                     FROM sections WHERE id = ? AND geometry_source = 'exact'",
                    params![row.section_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let reference = live.as_ref().and_then(|(id, start, end)| {
                let reference = geometry::reference(id.as_deref(), *start, *end)?;
                let sliced = geometry::rebuild(&tx, reference)?;
                (codec::encode_polyline(&sliced) == codec::encode_polyline(&line))
                    .then_some(reference)
            });
            history::record_archived_geometry_on(&tx, &row.section_id, &line, reference)?
        };
        let details = archived_details(
            &row.token,
            row.name.as_deref(),
            &row.sport_type,
            row.distance_meters,
            row.visit_count,
            row.created_at.as_deref(),
        );
        let id = history::append_history_on(
            &tx,
            &row.section_id,
            KIND_ARCHIVED,
            Some(&details),
            version,
            replaced.as_ref().map(|(at, _)| at.as_str()),
        )?;
        if row.token == CUTOVER_ID {
            range.first.get_or_insert(id);
            range.last = Some(id);
        }
        written += 1;
    }
    if range.first.is_some() {
        store_archive_range_on(&tx, &range)?;
    }
    tx.commit()?;
    Ok(written)
}

// ───────────────────────────────────────────────────────────────────
// The run
// ───────────────────────────────────────────────────────────────────

/// Run the full cutover: archive, switch, cold detect, diff.
/// Shaped on `run_elevation_backfill`: suspends detection, holds the
/// guard across the whole pass, fires one terminal re-cut.
pub fn run_cutover() -> Result<CutoverOutcome, String> {
    if !claim_run_slot() {
        return Err("cutover already running".into());
    }
    run_cutover_claimed(engine_install(), &|_phase: &str| cutover_cancelled())
}

/// [`run_cutover`] with its stop signal handed in.
///
/// The signal is asked at each step boundary and is given the phase the run is
/// about to leave, so a test can stop the run exactly where it means to rather
/// than racing a real cancel against a fixture that finishes in milliseconds.
/// Production hands in [`cutover_cancelled`].
pub fn run_cutover_with(
    should_stop: &(dyn Fn(&str) -> bool + Sync),
) -> Result<CutoverOutcome, String> {
    if !claim_run_slot() {
        return Err("cutover already running".into());
    }
    run_cutover_claimed(engine_install(), should_stop)
}

/// The run itself, with [`CUTOVER_RUNNING`] already claimed by the caller.
fn run_cutover_claimed(
    install: u64,
    should_stop: &(dyn Fn(&str) -> bool + Sync),
) -> Result<CutoverOutcome, String> {
    run_cutover_claimed_with(
        install,
        should_stop,
        crate::objects::detection::SLOT_WAIT_LIMIT,
        &|install| {
            with_persistent_engine_for(install, |e| e.detect_sections_background_unchecked())
                .map(|handle| Box::new(handle) as Box<dyn CutoverWorker>)
        },
    )
}

/// [`run_cutover_claimed`] with the detect's wait limit and its starter handed
/// in, so a test can drive a real run into a timeout with a worker that
/// outlasts a short limit.
fn run_cutover_claimed_with(
    install: u64,
    should_stop: &(dyn Fn(&str) -> bool + Sync),
    wait_limit: std::time::Duration,
    start_detect: &dyn Fn(u64) -> Option<Box<dyn CutoverWorker>>,
) -> Result<CutoverOutcome, String> {
    /// Stop here if the athlete has asked to. Every call site is a point the
    /// crash path already leaves the library at, so stopping needs no state of
    /// its own: the token is untouched and the next launch runs it again.
    macro_rules! stop_if_cancelled {
        ($guard:ident, $phase:expr, $clock:expr) => {
            if should_stop($phase) {
                info!(
                    "veloqrs: [cutover] Stopped at the athlete's request in {}",
                    $phase
                );
                $clock;
                $guard.ended = Some((RunOutcome::Stopped, None));
                return Ok(CutoverOutcome::Cancelled);
            }
        };
    }

    // Clears the flag and announces the settle on every exit path, so a failure
    // partway is heard as well as a completion. Declared first, so it drops
    // after the phase clock and the suspension and nothing holds the engine
    // lock by then: the observer blocks this thread until JavaScript returns.
    // `announce` is armed only once the run is owed, since a not-owed run
    // rebuilt nothing to report.
    struct RunGuard {
        announce: bool,
        install: u64,
        /// How the run ended, set where the outcome is in hand. An owed run
        /// that leaves it unset ended on an error.
        ended: Option<(RunOutcome, Option<String>)>,
    }
    impl Drop for RunGuard {
        fn drop(&mut self) {
            CUTOVER_RUNNING.store(false, Ordering::SeqCst);
            if self.announce {
                // Written before the settle is announced, so a reader woken by
                // it finds this run.
                let (outcome, diff) = self.ended.take().unwrap_or((RunOutcome::Failed, None));
                let summary = cutover_job_run(outcome, diff.as_deref());
                let _ =
                    with_persistent_engine_for(self.install, |e| record_job_run(&e.db, &summary));
                crate::objects::observer::notify(Announcement::CutoverSettled);
                crate::net::stream_backfill::autostart_stream_backfill();
            }
        }
    }
    let mut guard = RunGuard {
        announce: false,
        install,
        ended: None,
    };

    // The cancel belongs to the run it stopped. Cleared here, where the slot
    // is already claimed, so a flag left standing cannot refuse the next
    // launch's run before it has started.
    CUTOVER_CANCELLED.store(false, Ordering::SeqCst);

    // A failure anywhere below leaves the phase saying so: this covers a
    // failure before the clock enters its first phase, and `PhaseClock::drop`
    // covers every failure after it.
    set_phase(PHASE_FAILED);
    let mut clock = PhaseClock::new();

    // Check whether the cutover is actually owed.
    // A library whose flip is done or reverted still owes its own sections an
    // anchor, so the worker places them on this same lock take.
    let owed = with_persistent_engine_for(install, |e| {
        let owed = e.cutover_is_owed();
        if !owed && let Err(error) = e.anchor_user_owned_references() {
            log::warn!("veloqrs: [cutover] Anchoring failed: {}", error);
        }
        owed
    })
    .ok_or("no engine")?;
    if !owed {
        set_phase(PHASE_IDLE);
        return Ok(CutoverOutcome::NotOwed);
    }
    guard.announce = true;

    // Refuses every NEW start. A worker already in the slot is untouched by
    // it, which is what the drain below is for.
    let _suspend = suspend_detection();

    // Drain any run holding the slot before changing the catalogue and token.
    clock.enter(PHASE_DRAINING);
    stop_if_cancelled!(guard, PHASE_DRAINING, clock.finish(PHASE_IDLE));
    drain_detection_slot()?;
    stop_if_cancelled!(guard, PHASE_DRAINING, clock.finish(PHASE_IDLE));

    // Step 1: archive. Additive and idempotent per token, so a crash here
    // leaves the user on Corridor with an intact catalogue and the cutover
    // still owed.
    clock.enter(PHASE_ARCHIVING);
    let archived = with_persistent_engine_for(install, |e| {
        let archived = e
            .archive_current_catalogue()
            .map_err(|e| format!("archive failed: {}", e))?;
        // The athlete's own sections keep their rows through the re-cut, so
        // they are placed on a track before the switch rather than after.
        e.anchor_user_owned_references()
            .map_err(|e| format!("anchoring failed: {}", e))?;
        Ok::<u32, String>(archived)
    })
    .ok_or("no engine")??;
    info!("veloqrs: [cutover] Archived {} sections", archived);
    // The archive is additive and idempotent per token, so stopping here is
    // the state a crash here already leaves: still on the old detector, with
    // the catalogue intact and the cutover owed.
    stop_if_cancelled!(guard, PHASE_ARCHIVING, clock.finish(PHASE_IDLE));

    // Step 2: commit the switch. Config, in-flight token and the cleared
    // processed set land together, so a crash after this point resumes rather
    // than stranding the install on a half-migrated catalogue.
    with_persistent_engine_for(install, |e| e.commit_switch())
        .ok_or("no engine")?
        .map_err(|e| format!("switch failed: {}", e))?;

    // Step 3: cold detect through the unchecked path, since the guard we hold
    // would otherwise refuse our own run.
    clock.enter(PHASE_DETECTING);
    // Past the switch the token is in flight, which is exactly what makes the
    // next launch run this again from the top.
    stop_if_cancelled!(guard, PHASE_DETECTING, clock.finish(PHASE_IDLE));
    let handle = start_detect(install).ok_or("no engine")?;

    // Drive the detect to completion, bounded by the same ceiling the slot wait
    // twenty lines up already uses. A worker that hangs rather than dies never
    // closes its channel, and an unbounded read here held `CUTOVER_RUNNING` for
    // the life of the process, so every later launch was refused its cutover.
    let waited = wait_for_cutover_detect(&*handle, wait_limit, |checkpoint| {
        crate::objects::detection::persist_checkpoint(install, checkpoint)
    });
    // The detect may have regrouped and committed the groups on its own
    // connection, and it leaves the adopt to the caller it hands its result
    // to. Adopted here, whatever the wait answered, so a run that stops or
    // fails from here on does not leave the engine regrouping over the
    // catalogue the detect replaced.
    with_persistent_engine_for(install, |e| e.adopt_committed_groups());
    let ((sections, processed_ids), cache_update) = match waited {
        Ok(answer) => answer,
        Err(e) if e == DETECT_CANCELLED => {
            // The worker has settled, so there is nothing to adopt.
            stop_if_cancelled!(guard, PHASE_DETECTING, clock.finish(PHASE_IDLE));
            return Err(e);
        }
        Err(e) => {
            // Adopted before the guard frees the slot, so no retry can claim
            // it while this worker still folds.
            adopt_orphaned_detect(handle);
            return Err(e);
        }
    };
    // A cancel that arrives as the detect answers discards the result. That
    // is safe because nothing has been applied, so the next launch redoes it.
    stop_if_cancelled!(guard, PHASE_DETECTING, clock.finish(PHASE_IDLE));

    with_persistent_engine_for(install, |e| {
        // Ranking reads every needed track, so it runs after this lock is
        // released, on a connection of its own.
        e.apply_sections_save_with_cache_row_ranked(sections, cache_update, None, false)
            .map_err(|err| format!("apply failed: {}", err))?;
        e.apply_sections_finalize();
        clock.mark_applied();
        e.save_processed_activity_ids(&processed_ids)
            .map_err(|err| format!("save processed ids failed: {}", err))?;
        // Anything that arrived mid-cut is neither processed nor dirty
        // otherwise, so the next launch would never section it.
        if has_unprocessed_activity(&e.get_activity_ids(), &processed_ids) {
            e.mark_sections_dirty();
        }
        Ok::<(), String>(())
    })
    .ok_or("no engine")?
    .map_err(|e| format!("apply: {}", e))?;
    crate::persistence::sections::rank_off_lock(install);

    // Step 4: diff, then promote the token. The promotion is last, so any
    // failure above leaves the token in flight and the whole run is retried
    // from the top on the next launch.
    clock.enter(PHASE_DIFFING);
    let diff = with_persistent_engine_for(install, |e| e.build_cutover_diff())
        .ok_or("no engine")?
        .map_err(|e| format!("diff failed: {}", e))?;

    with_persistent_engine_for(install, |e| e.finish_cutover(&diff))
        .ok_or("no engine")?
        .map_err(|e| format!("token promotion failed: {}", e))?;

    let run_ms = clock.run_ms();
    clock.finish(PHASE_COMPLETE);
    info!("veloqrs: [cutover] Cutover complete in {}ms", run_ms);
    guard.ended = Some((RunOutcome::Complete, Some(diff.clone())));
    Ok(CutoverOutcome::Completed(diff))
}

/// The last-run summary of a rebuild: the diff's counts, read from the same
/// payload the change card shows. A rebuild is not a detection run, though it
/// applies through the same save, so it records only here.
fn cutover_job_run(outcome: RunOutcome, diff: Option<&str>) -> JobRun {
    let counts = diff
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .map(|payload| payload["counts"].clone())
        .unwrap_or(serde_json::Value::Null);
    let count = |key: &str| counts[key].as_u64().unwrap_or(0) as u32;
    JobRun {
        job: BackgroundJob::Cutover,
        finished_at: crate::persistence::attempts::now_ms(),
        outcome,
        handled: count("proposed"),
        added: count("new"),
        changed: count("changed"),
        retired: count("gone"),
        failed: 0,
    }
}

/// Drive any run already holding the detection slot to its end, applying its
/// result through the shared poll. Mirrors the backfill's drain: with the
/// suspension held, an emptied slot stays empty.
///
/// Bounded, because this is reached from the launch path and a worker that
/// hangs rather than panicking never reports `Died`. Giving up abandons this
/// cutover attempt, which the next launch makes again; holding the launch open
/// on it is the thing that has no way out.
fn drain_detection_slot() -> Result<(), String> {
    use crate::objects::detection::{SLOT_POLL, SlotWait, wait_on_slot};

    match wait_on_slot(SLOT_POLL, false) {
        SlotWait::Idle => Ok(()),
        SlotWait::TimedOut => Err("the detection slot did not empty in time".to_string()),
        SlotWait::Failed(e) => Err(format!("could not drain the detection slot: {}", e)),
        other => Err(format!("unexpected drain outcome: {:?}", other)),
    }
}

#[cfg(test)]
#[path = "tests/cutover_pool.rs"]
mod pool_tests;

#[cfg(test)]
#[path = "tests/cutover_retry.rs"]
mod retry_tests;

#[cfg(test)]
#[path = "tests/cutover_anchoring.rs"]
mod anchoring_tests;

#[cfg(test)]
#[path = "tests/cutover_ledger.rs"]
mod ledger_tests;

#[cfg(test)]
mod tests {
    use crate::persistence::{PersistentEngine, codec};
    use tempfile::TempDir;
    use tracematch::GpsPoint;

    fn track() -> Vec<GpsPoint> {
        (0..40)
            .map(|i| GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.000_1,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// An engine holding one stored stream and one archivable auto section
    /// whose line is a real slice of it.
    fn engine_with_archivable_section(dir: &TempDir) -> PersistentEngine {
        let path = dir.path().join("archive.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .add_activity("a1".into(), track(), "Ride".into())
            .expect("add_activity");
        let line = track()[0..12].to_vec();
        engine
            .db
            .execute(
                "INSERT INTO sections
                     (id, section_type, name, sport_type, polyline_json, polyline_blob,
                      distance_meters, representative_activity_id, rep_start_index,
                      rep_end_index, geometry_source, created_at, is_user_defined,
                      bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s_auto', 'auto', 'Auto', 'Ride', NULL, ?, 1200.0,
                         'a1', 0, 12, 'exact', '2026-01-01T00:00:00Z', 0,
                         46.0, 46.1, 7.0, 7.1)",
                rusqlite::params![codec::serialize_track_points(&line)],
            )
            .expect("insert the section");
        engine
    }

    /// Scenario: a section's stored version was sliced from a stream that
    /// carries elevation, and the line the archive reads back from the old
    /// catalogue is the same course with no elevation.
    /// Expected behaviour: the archive reuses the stored version and writes no
    /// second one, so the ledger offers no revert to an identical line.
    #[test]
    fn archiving_a_line_that_differs_only_in_elevation_adds_no_version() {
        let dir = TempDir::new().expect("dir");
        let path = dir.path().join("elevation.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let climbing: Vec<GpsPoint> = track()
            .into_iter()
            .enumerate()
            .map(|(i, p)| GpsPoint {
                elevation: Some(400.0 + i as f64),
                ..p
            })
            .collect();
        engine
            .add_activity("a1".into(), climbing.clone(), "Ride".into())
            .expect("add_activity");

        let sliced = climbing[0..12].to_vec();
        let first = crate::persistence::sections::history::record_archived_geometry_on(
            &engine.db,
            "s_pinned",
            &sliced,
            Some(("a1", 0, 12)),
        )
        .expect("first");
        let flat = track()[0..12].to_vec();
        let second = crate::persistence::sections::history::record_archived_geometry_on(
            &engine.db, "s_pinned", &flat, None,
        )
        .expect("second");

        assert_eq!(second, first);
        let versions: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_geometry WHERE section_id = 's_pinned'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(versions, 1);
    }

    fn previous_config(engine: &PersistentEngine) -> Option<String> {
        engine
            .get_setting(super::CUTOVER_PREVIOUS_CONFIG_KEY)
            .expect("read")
    }

    /// Scenario: the cutover is owed and the athlete keeps new detection
    /// settings, which the flip would then reset to the defaults.
    /// Expected behaviour: the write is refused as a held cutover and neither
    /// the live config nor the persisted blob changes.
    #[test]
    fn a_config_write_is_refused_while_the_cutover_is_owed() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        assert!(engine.cutover_is_owed());
        let before = engine.get_section_config();
        let blob_before = engine
            .get_setting(crate::persistence::settings_keys::SECTION_CONFIG_JSON)
            .expect("read");

        let strict = tracematch::SectionConfig {
            proximity_threshold: 300.0,
            ..Default::default()
        };
        assert_eq!(
            engine.set_section_config(strict.clone()),
            Err(crate::persistence::sections::DetectionRefusal::CutoverOwed)
        );
        assert_eq!(engine.get_section_config(), before);
        assert_eq!(
            engine
                .get_setting(crate::persistence::settings_keys::SECTION_CONFIG_JSON)
                .expect("read"),
            blob_before
        );

        engine.commit_switch().expect("switch");
        let diff = engine.build_cutover_diff().expect("diff");
        engine.finish_cutover(&diff).expect("promote");
        assert!(!engine.cutover_is_owed());
        assert_eq!(engine.set_section_config(strict.clone()), Ok(()));
        assert_eq!(engine.get_section_config(), strict);
    }

    fn junction_activity_ids(engine: &PersistentEngine, section: &str) -> Vec<String> {
        let mut stmt = engine
            .db
            .prepare("SELECT activity_id FROM section_activities WHERE section_id = ? ORDER BY 1")
            .expect("prepare");
        stmt.query_map([section], |row| row.get::<_, String>(0))
            .expect("query")
            .flatten()
            .collect()
    }

    /// Scenario: the cutover is owed and a store re-ingests an activity whose
    /// track is unchanged and which already has junction rows.
    /// Expected behaviour: the rows stay as the 0.3.x matcher wrote them, a
    /// second identical store changes nothing, a new activity and a changed
    /// track still attach, and once the cutover is done an unchanged store
    /// attaches again.
    #[test]
    fn an_unchanged_store_keeps_the_rows_the_archive_snapshots() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        assert!(engine.cutover_is_owed());
        engine.load_sections().expect("load the catalogue");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters)
                 VALUES ('s_auto', 'a1', 'same', 0, 5, 100.0)",
                [],
            )
            .expect("a row only the old matcher wrote");
        let before = junction_activity_ids(&engine, "s_auto");
        assert_eq!(before, vec!["a1".to_string()]);

        let changed = engine
            .add_activity("a1".into(), track(), "Ride".into())
            .expect("re-add");
        assert!(changed.is_empty());
        engine.attach_after_store("a1", !changed.is_empty());
        engine.attach_after_store("a1", false);
        assert_eq!(junction_activity_ids(&engine, "s_auto"), before);
        let end: i64 = engine
            .db
            .query_row(
                "SELECT end_index FROM section_activities WHERE activity_id = 'a1'",
                [],
                |r| r.get(0),
            )
            .expect("row");
        assert_eq!(end, 5, "the old row survives untouched");

        engine
            .add_activity("a2".into(), track(), "Ride".into())
            .expect("new activity");
        engine.attach_after_store("a2", false);
        assert!(
            junction_activity_ids(&engine, "s_auto").contains(&"a2".to_string()),
            "a new activity attaches before the cut"
        );

        let shifted: Vec<GpsPoint> = track().into_iter().take(30).collect();
        let changed = engine
            .add_activity("a1".into(), shifted, "Ride".into())
            .expect("changed track");
        assert_eq!(changed, vec!["a1".to_string()]);
        engine.attach_after_store("a1", true);
        let end: i64 = engine
            .db
            .query_row(
                "SELECT end_index FROM section_activities WHERE activity_id = 'a1'",
                [],
                |r| r.get(0),
            )
            .expect("row");
        assert_ne!(end, 5, "a changed track is re-attached");

        engine.commit_switch().expect("switch");
        let diff = engine.build_cutover_diff().expect("diff");
        engine.finish_cutover(&diff).expect("promote");
        assert!(!engine.cutover_is_owed());
        engine
            .db
            .execute(
                "UPDATE section_activities SET end_index = 5 WHERE activity_id = 'a2'",
                [],
            )
            .expect("mark");
        engine.attach_after_store("a2", false);
        let end: i64 = engine
            .db
            .query_row(
                "SELECT end_index FROM section_activities WHERE activity_id = 'a2'",
                [],
                |r| r.get(0),
            )
            .expect("row");
        assert_ne!(end, 5, "after the cut an unchanged store attaches");
    }

    /// Scenario: a run dies between the switch and the promotion, so the
    /// resumed run switches again from a config that already reads Unified.
    /// Expected behaviour: the diff still names the values the first switch
    /// replaced, and the promotion drops them once the diff carries them.
    #[test]
    fn a_resumed_switch_keeps_the_values_the_first_one_replaced() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        let strict = tracematch::SectionConfig {
            proximity_threshold: 100.0,
            min_activities: 3,
            ..Default::default()
        };
        engine.section_config = strict.clone();
        engine
            .set_setting(
                crate::persistence::settings_keys::SECTION_CONFIG_JSON,
                &serde_json::to_string(&strict).expect("json"),
            )
            .expect("persist");

        engine.commit_switch().expect("first switch");
        assert_eq!(
            engine.get_section_config(),
            tracematch::SectionConfig::default()
        );
        assert!(previous_config(&engine).is_some());

        engine.commit_switch().expect("resumed switch");
        let diff: serde_json::Value =
            serde_json::from_str(&engine.build_cutover_diff().expect("diff")).expect("json");
        assert_eq!(
            diff["settings_reset"]["previous"]["proximityThreshold"].as_f64(),
            Some(100.0),
            "the resumed switch lost the pre-reset values"
        );
        assert_eq!(
            diff["settings_reset"]["previous"]["minActivities"].as_u64(),
            Some(3)
        );
        assert_eq!(
            diff["settings_reset"]["current"]["minActivities"].as_u64(),
            Some(2)
        );

        let diff = engine.build_cutover_diff().expect("diff");
        engine.finish_cutover(&diff).expect("promote");
        assert!(
            previous_config(&engine).is_none(),
            "the promotion left the old values behind"
        );
    }

    /// A switch from the defaults keeps nothing, so the diff reports no reset.
    #[test]
    fn a_switch_from_the_defaults_reports_no_reset() {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = engine_with_archivable_section(&dir);
        engine.commit_switch().expect("switch");
        assert!(previous_config(&engine).is_none());
        let diff: serde_json::Value =
            serde_json::from_str(&engine.build_cutover_diff().expect("diff")).expect("json");
        assert!(diff["settings_reset"].is_null());
    }
}
