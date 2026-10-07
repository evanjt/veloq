//! One-shot fetch of the elevation every stored track is missing.
//!
//! The coordinates are already on the device, so the pass asks for
//! `fixed_altitude,altitude` alone, about a fifth of the bytes the whole track
//! costs, and splices the series onto the points already stored. Nothing about
//! a track's geometry moves, so the catalogue derived from it is not
//! invalidated. The stored `point_count` against the length of the series is
//! the guard: equal is the same stream, unequal means intervals.icu
//! re-processed that activity, and only then is the whole track fetched and
//! replaced, which is what evicts it from the processed set.
//!
//! A partly elevated library is worse than a uniformly flat one. A lift
//! candidate survives when its own track has no elevation, but a track without
//! elevation cannot rescue one, so a genuine climb is vetoed mid-conversion and
//! the spurious section takes a durable ledger id. The library therefore has to
//! cross from flat to elevated with detection held off, and re-cut once at the
//! end.
//!
//! The work queue is derived, never stored: it is every `gps_tracks` row whose
//! `elevation_state` is still `UNKNOWN`, ie. every track upstream has not been
//! asked about. A crash, a kill or a logout costs the activities in flight and
//! nothing else, because the next run re-derives the same queue from the column
//! the completed work already advanced.
//!
//! Three rules make the pass terminate. Upstream that answers with an altitude
//! series it cannot fill records `UNAVAILABLE`, so it leaves the queue
//! permanently. A network failure or an empty response leaves the row
//! untouched, so it can be asked again. A 401 ends the pass outright rather
//! than spending the whole library on rejected requests. An elevation ask that
//! comes back with nothing at all cannot tell the first case from the second,
//! since the request carried no coordinates, so that activity alone is asked
//! for whole and the coordinates settle it.
//!
//! A track the connection refused is re-asked inside the same pass, in
//! [`BACKFILL_RETRY_ROUNDS`] rounds that wait longer each time, before it is
//! left to the next run. A blink of a connection costs seconds rather than a
//! whole launch. The rounds are skipped when the pass stopped because the
//! connection is gone: the stop threshold has already decided nothing is
//! coming back. An empty response is upstream replying, so it waits for the
//! next run as it always did.
//!
//! The final re-cut runs only when a pass ends with the queue empty, so
//! detection is never re-derived over a half-converted library. A pass that
//! ends partial or failed leaves the flat-era catalogue standing and the next
//! run finishes the job.
//!
//! On an install still owed the detector cutover that cut is the cutover
//! itself, not a bare re-cut. `cutover::start_cutover` answers `Held` while
//! this queue is non-empty, so the drained pass is the only thing left holding
//! the migration. See [`terminal_cut`].
//!
//! Every track the pass writes records which upstream series its elevation
//! is, corrected or device, in `elevation_source`. A track fetched before that
//! column existed reads unknown, and once a pass has run its queue it asks for
//! each of those once, with the same elevation-only read. Points that carry
//! the answered series keep every byte and gain the record. Points that carry
//! something else go back to this queue, so the splice that replaces them
//! records the series it writes.
//!
//! The athlete can pause the download. The pause lives for the process and
//! nowhere else: the pass in flight ends at its next batch boundary, no start
//! in this process is accepted, and the next launch begins unpaused with no
//! code to clear it, so a forgotten pause can never strand the migration.

use crate::governor::Lane;
use crate::net::endpoints::{TRACK_STREAM_TYPES, fetch_altitude, fetch_streams};
use crate::net::transport::{NetError, Transport};
use crate::net::types::ParsedStreams;
use crate::objects::FfiStartOutcome;
use crate::objects::detection::{SlotWait, wait_on_slot};
use crate::objects::observer::Announcement;
use crate::persistence::attempts::now_ms;
use crate::persistence::cutover::CutoverOutcome;
use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, record_job_run};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::{
    ELEVATION_STATE_UNAVAILABLE, ElevationSeries, PersistentEngine, elevation_source_of,
    engine_install, suspend_detection, with_persistent_engine, with_persistent_engine_for,
};
use rusqlite::{Result as SqlResult, params};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::time::Duration;
use tracematch::GpsPoint;

/// Activities fetched per pass through the store step. Small enough that a kill
/// loses little, large enough that the index rebuild and the metadata restore
/// amortise over a batch rather than a single track.
const BATCH: usize = 20;

/// Requests in flight at once. Under the governor's 8 req/s so the shared pace
/// is the limiter, not this number.
const FETCH_CONCURRENCY: usize = 6;

/// Consecutive connectivity failures that end the pass.
///
/// A failed fetch leaves its row untouched, so without a stop the pass asks
/// once per queued track and only then reports partial. The backfill lane has
/// a 30 s per-attempt ceiling, no whole-request budget and three retries, so
/// a connection that accepts and then goes quiet costs up to four of those
/// per track. One thousand tracks at six in flight is hours of a detached
/// thread achieving nothing, and it burns the governor's pace with it.
///
/// One batch, because the results inside a batch arrive unordered: reaching
/// this count means a whole batch came back with nothing to work with, which
/// no partial outage can produce.
pub const MAX_CONSECUTIVE_FAILURES: usize = BATCH;

/// Asks that settle nothing before a track is retired out of the queue.
///
/// An ask settles nothing when upstream answers about that one activity and
/// the answer carries no altitude to store: a 4xx, a body that will not parse,
/// or a whole-track ask that comes back empty. A connection that is gone is
/// not one of these, it is counted separately and re-asked.
///
/// Three, because a pass runs about once per launch and the same answer three
/// launches running is upstream's position rather than a bad afternoon. Left
/// uncounted the row is re-offered by every pass for the life of the install,
/// which holds section detection and vetoes the detector cutover with it.
pub const ELEVATION_ATTEMPT_LIMIT: u32 = 3;

/// How often the final-detect driver polls the worker it started.
const DRIVER_POLL: Duration = Duration::from_millis(250);

/// Rounds of re-asking a pass gives the tracks the connection refused.
///
/// Bounded, and small: one ask already carries the lane's own three retries,
/// so this is the ladder above that one, for an outage that outlives a single
/// request rather than one that outlives the pass.
pub const BACKFILL_RETRY_ROUNDS: usize = 2;

/// What each retry round waits before it asks again, longest last.
pub fn backfill_retry_delays() -> [Duration; BACKFILL_RETRY_ROUNDS] {
    [Duration::from_millis(500), Duration::from_secs(2)]
}

/// How long a resume attempt waits after the one before it, longest last.
///
/// The last entry is the resting rate: a library nothing can elevate is asked
/// about twice an hour, not once a minute. This is the ladder between passes,
/// where [`backfill_retry_delays`] is the one inside a single pass.
pub const RESUME_WAITS: [Duration; 5] = [
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
    Duration::from_secs(900),
    Duration::from_secs(1800),
];

/// What the attempt after `attempts` earlier ones waits, capped at the last rung.
pub fn resume_wait(attempts: usize) -> Duration {
    RESUME_WAITS[attempts.min(RESUME_WAITS.len() - 1)]
}

/// Whether a ladder is climbing in this process. One at a time: a second start
/// joins the ladder that is already running rather than laying a parallel one.
static RESUME_ARMED: AtomicBool = AtomicBool::new(false);

/// Holds the single-ladder slot. Release is structural, like `RunGuard`'s, so a
/// panic anywhere in the climb cannot leave the resume armed for the life of
/// the process. The crate unwinds and the panic hook logs rather than aborting,
/// so a release written as the last statement of the thread body is skipped.
struct ResumeGuard;

impl Drop for ResumeGuard {
    fn drop(&mut self) {
        RESUME_ARMED.store(false, Ordering::SeqCst);
    }
}

impl ResumeGuard {
    /// Claim the slot, or `None` when a ladder is already climbing.
    fn claim() -> Option<Self> {
        RESUME_ARMED
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| ResumeGuard)
    }
}

/// The ladder itself, with everything it waits on handed in.
///
/// Split out so the schedule can be exercised without spending an evening on
/// it, the same way `drain_queue_with` splits the fetch out of the walk. A
/// sleep that ends early still counts as a rung climbed, so an online edge
/// shortens the wait it lands in without resetting the ladder, and a flapping
/// connection cannot hold it at its first rung.
///
/// **This is the one background loop in the crate with no external cancel, and
/// that is deliberate.** Every other one is either bounded, like both slot
/// drivers through `wait_on_slot`, or cooperatively stopped. The queue reading
/// empty finishes the job; a pause or disabled detector ends this climb until
/// Resume or Route Matching being turned back on arms another. A
/// cancel would need a terminal state distinguishable from those, and the
/// climb it would stop costs one sleeping thread waking at most every half
/// hour, so there is nothing for a caller to gain by stopping it.
///
/// `sleep` returning false ends the climb, which is how a test stops it and
/// nothing else. `elevation_resume_ladder.rs` pins all of this, the absence
/// included.
pub fn resume_ladder(
    mut sleep: impl FnMut(Duration) -> bool,
    mut remaining: impl FnMut() -> Option<u64>,
    mut offline: impl FnMut() -> bool,
    mut paused_or_switched_off: impl FnMut() -> bool,
    mut engine_gone: impl FnMut() -> bool,
    mut attempt: impl FnMut(),
) {
    let mut attempts = 0usize;
    loop {
        if !sleep(resume_wait(attempts)) {
            return;
        }
        attempts += 1;
        // Zero is the one answer that ends the ladder for good. A queue that
        // cannot be read is not an empty one, so it climbs and asks again.
        if remaining() == Some(0) {
            return;
        }
        // A destroyed engine reads as an unreadable queue and so climbed for the
        // life of the process, waking twice an hour against a handle that was
        // gone. Asked separately because that is the only way to tell it from a
        // read that failed for a moment, and a moment must end nothing. A
        // restore re-arms the ladder itself and a clear empties the queue, so
        // neither path needs this climb to survive the engine it works for.
        if engine_gone() {
            return;
        }
        // A paused or switched-off install needs no further attempts. Resume
        // or switching Route Matching back on lays a new ladder.
        if paused_or_switched_off() {
            return;
        }
        // A rung spent offline costs no request and still moves up the ladder,
        // so a device that is away for an evening is not asked every minute
        // when it comes back.
        if offline() {
            continue;
        }
        attempt();
    }
}

/// What a production rung waits on: its own clock, or the connection coming
/// back, whichever is first. Always climbs, since in production the ladder
/// ends on the queue, pause or switch and never on the sleep.
pub fn resume_sleep(wait: Duration) -> bool {
    crate::net::connectivity::sleep_or_online_edge(wait);
    true
}

/// Put a climb on a thread, unless one is already running. Returns the thread
/// so a test can wait on it; production drops the handle and lets it run.
fn spawn_resume_ladder(
    climb: impl FnOnce() + Send + 'static,
) -> Option<std::thread::JoinHandle<()>> {
    let slot = ResumeGuard::claim()?;
    Some(crate::threads::spawn_named("veloq-elev", move || {
        let _slot = slot;
        climb();
    }))
}

/// Put a ladder behind the pass, unless one is already climbing.
/// Whether the engine this ladder works for is still installed.
///
/// A read of the queue answers `None` for a destroyed engine and for a read
/// that failed, and the ladder must end on the first and never on the second.
/// This is the cheap, unambiguous half: no lock is taken for long and there is
/// no query behind it.
fn engine_gone() -> bool {
    crate::persistence::PERSISTENT_ENGINE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_none()
}

fn detection_switched_off() -> bool {
    matches!(
        crate::objects::error::with_reader(|conn| {
            crate::persistence::settings::setting_from(
                conn,
                crate::persistence::settings::settings_keys::DETECTION_ENABLED,
            )
        }),
        Ok(Ok(Some(value))) if value == "0"
    )
}

fn arm_resume_ladder() {
    spawn_resume_ladder(|| {
        resume_ladder(
            resume_sleep,
            || match with_persistent_engine(|engine| engine.elevation_backfill_remaining()) {
                Some(Ok(n)) => Some(n),
                _ => None,
            },
            crate::net::connectivity::is_offline,
            || elevation_backfill_paused() || detection_switched_off(),
            engine_gone,
            || {
                start_pass();
            },
        );
    });
}

// ============================================================================
// Phases
// ============================================================================

/// No backfill has run in this process.
pub const BACKFILL_PHASE_IDLE: &str = "idle";
/// Downloading tracks.
pub const BACKFILL_PHASE_FETCHING: &str = "fetching";
/// The pass finished and nothing is outstanding.
pub const BACKFILL_PHASE_COMPLETE: &str = "complete";
/// The pass finished but some activities still lack elevation, so a later run
/// has work. Distinct from `complete` because the queue is not empty.
pub const BACKFILL_PHASE_PARTIAL: &str = "partial";
/// The pass could not proceed at all: no credential, a rejected credential, or
/// an unreadable queue.
pub const BACKFILL_PHASE_FAILED: &str = "failed";
/// The athlete paused the download. Nothing runs until the app is reopened.
pub const BACKFILL_PHASE_PAUSED: &str = "paused";

// ============================================================================
// Pause
// ============================================================================

/// Whether the athlete has paused the download in this process.
static PAUSED: AtomicBool = AtomicBool::new(false);

/// Stop the download for the rest of this process.
///
/// The pass in flight ends at its next batch boundary and reports
/// [`BACKFILL_PHASE_PAUSED`] itself; with no pass in flight the phase is set
/// here so the page reads paused at once. Either way the phase is what says it,
/// so there is nothing for this to answer.
pub fn pause_elevation_backfill() {
    PAUSED.store(true, Ordering::SeqCst);
    if !BACKFILL.running.load(Ordering::SeqCst) {
        set_phase(BACKFILL_PHASE_PAUSED);
    }
    log::info!("[Elevation] backfill paused until the next launch");
}

/// Whether the download is paused in this process.
pub fn elevation_backfill_paused() -> bool {
    PAUSED.load(Ordering::SeqCst)
}

/// Lift the pause and put the download back to work.
///
/// The pause was process-local with only a new process to clear it, so an
/// athlete who paused had no way back: detection stayed held, the detector
/// cutover never ran, and a force-quit resumed into the same place. Returns
/// whether there was a pause to lift, so a second press answers false rather
/// than laying a second ladder.
pub fn resume_elevation_backfill() -> bool {
    if !PAUSED.swap(false, Ordering::SeqCst) {
        return false;
    }
    // The phase is what the page reads, so a resume that left it on `paused`
    // would read as a pause that did not lift. A pass in flight reports its own
    // phase, so only a stopped one is set here.
    if !BACKFILL.running.load(Ordering::SeqCst) {
        set_phase(BACKFILL_PHASE_IDLE);
    }
    log::info!("[Elevation] backfill resumed");
    start_elevation_backfill();
    true
}

/// Lift the pause, which in production only a new process does.
#[cfg(test)]
pub(crate) fn reset_pause() {
    PAUSED.store(false, Ordering::SeqCst);
}

/// [`reset_pause`] for the integration tests, which share the process.
#[doc(hidden)]
pub fn reset_elevation_backfill_pause() {
    PAUSED.store(false, Ordering::SeqCst);
}

// ============================================================================
// Observable state
// ============================================================================

struct BackfillState {
    running: AtomicBool,
    completed: AtomicU32,
    total: AtomicU32,
    failed: AtomicU32,
    detects: AtomicU32,
    phase: Mutex<&'static str>,
}

static BACKFILL: BackfillState = BackfillState {
    running: AtomicBool::new(false),
    completed: AtomicU32::new(0),
    total: AtomicU32::new(0),
    failed: AtomicU32::new(0),
    detects: AtomicU32::new(0),
    phase: Mutex::new(BACKFILL_PHASE_IDLE),
};

pub(crate) fn set_phase(phase: &'static str) {
    *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
    // The guard above is a temporary of the statement it is in, so the
    // announcement is made with the phase lock already released.
    crate::objects::observer::notify(Announcement::BackfillPhase(phase.to_string()));
}

/// What a poller sees while the backfill runs and after it settles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackfillSnapshot {
    pub phase: &'static str,
    /// Activities this run has finished with, successfully or not.
    pub completed: u32,
    /// Activities the run started with.
    pub total: u32,
    /// Activities whose fetch failed, so their state is unchanged and a later
    /// run retries them.
    pub failed: u32,
}

impl BackfillSnapshot {
    /// Whole-percent progress. An empty queue is finished, not zero.
    pub fn percent(&self) -> u32 {
        if self.total == 0 {
            return 100;
        }
        (self.completed.min(self.total) * 100) / self.total
    }
}

/// The current backfill state, safe to read from any thread at any time.
pub fn backfill_progress() -> BackfillSnapshot {
    BackfillSnapshot {
        phase: *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()),
        completed: BACKFILL.completed.load(Ordering::Relaxed),
        total: BACKFILL.total.load(Ordering::Relaxed),
        failed: BACKFILL.failed.load(Ordering::Relaxed),
    }
}

/// Detection runs this process's backfills have started. The one-detect rule is
/// otherwise invisible from outside, so it is reported rather than inferred.
pub fn detect_runs_started() -> u32 {
    BACKFILL.detects.load(Ordering::Relaxed)
}

/// Whether a pass holds the single-run slot, for the fixture that waits on it.
#[cfg(test)]
pub(crate) fn pass_running() -> bool {
    BACKFILL.running.load(Ordering::SeqCst)
}

/// Holds the single-run slot. Release is structural, so a panic or an early
/// return cannot leave the backfill permanently unstartable.
struct RunGuard;

impl Drop for RunGuard {
    fn drop(&mut self) {
        BACKFILL.running.store(false, Ordering::SeqCst);
    }
}

impl RunGuard {
    /// Claim the slot, or `None` when a run already holds it.
    fn claim() -> Option<Self> {
        BACKFILL
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| RunGuard)
    }
}

// ============================================================================
// Outcome
// ============================================================================

/// What one pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BackfillOutcome {
    /// Tracks the derived queue held when the pass began.
    pub queued: u32,
    /// Tracks re-stored with elevation.
    pub elevated: u32,
    /// Tracks whose upstream carries no usable altitude, now recorded
    /// `UNAVAILABLE` and gone from the queue for good.
    pub unavailable: u32,
    /// Tracks whose fetch failed. Their state is unchanged, so the next run
    /// retries them.
    pub failed: u32,
    /// Tracks retired this pass: asked [`ELEVATION_ATTEMPT_LIMIT`] times,
    /// never answered, and now out of the queue for good.
    pub retired: u32,
    /// Detection runs this pass started. One when it elevated anything, zero
    /// otherwise.
    pub detects_started: u32,
}

/// How a call to [`run_elevation_backfill`] ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackfillRun {
    /// Another run holds the slot. Nothing was fetched and nothing was changed.
    Refused,
    /// The pass ran to the end of its queue.
    Finished(BackfillOutcome),
    /// The pass could not proceed.
    Failed(String),
}

// ============================================================================
// The queue
// ============================================================================

/// A local key upstream cannot name yet is not owed: the ride waits for its
/// upload rather than spending attempts on a 404. A key that is not local is
/// its own upstream id, as every row an older build stored is.
///
/// A demo key is never owed. Demo mode seeds its tracks on the device with no
/// altitude and no credential to ask with, so counting them would hold
/// detection and the cutover on a queue nothing can ever drain.
macro_rules! upstream_named_sql {
    () => {
        "g.activity_id NOT LIKE 'demo-%'
                AND (g.activity_id NOT LIKE 'local-%'
                  OR a.intervals_id IS NOT NULL
                  OR EXISTS (SELECT 1 FROM activity_bodies b
                              WHERE b.activity_id = g.activity_id
                                AND b.intervals_id IS NOT NULL))"
    };
}

/// The backfill queue, newest first. The order is what makes a scrolling
/// athlete's newest activities convert first, and it is worth a sort.
const ELEVATION_QUEUE_SQL: &str = concat!(
    "SELECT g.activity_id, a.sport_type
               FROM gps_tracks g
               JOIN activities a ON a.id = g.activity_id
              WHERE g.elevation_state = ?1
                AND ",
    upstream_named_sql!(),
    "
              ORDER BY a.start_date IS NULL, a.start_date DESC, g.activity_id"
);

/// How long that queue is, without building it. Both launch triggers ask, and
/// neither cares about the order, so counting must not pay for it. The join
/// stays: a stored track whose activity row has gone is not in the queue, so a
/// bare count over `gps_tracks` would answer a different question.
const ELEVATION_REMAINING_SQL: &str = concat!(
    "SELECT COUNT(*)
               FROM gps_tracks g
               JOIN activities a ON a.id = g.activity_id
              WHERE g.elevation_state = ?1
                AND ",
    upstream_named_sql!()
);

pub(crate) fn pooled_elevation_backfill_remaining(conn: &rusqlite::Connection) -> SqlResult<u64> {
    conn.query_row(
        ELEVATION_REMAINING_SQL,
        params![i64::from(crate::persistence::ELEVATION_STATE_UNKNOWN)],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as u64)
}

/// The tracks whose elevation was fetched before the engine recorded which
/// series it is, newest first. A track asked [`ELEVATION_ATTEMPT_LIMIT`] times
/// with no answer leaves it and stays unknown, so the walk can end.
const ELEVATION_SOURCE_QUEUE_SQL: &str = concat!(
    "SELECT g.activity_id
               FROM gps_tracks g
               JOIN activities a ON a.id = g.activity_id
              WHERE g.elevation_state = ?1
                AND g.elevation_source = ?2
                AND g.elevation_attempts < ?3
                AND ",
    upstream_named_sql!(),
    "
              ORDER BY a.start_date IS NULL, a.start_date DESC, g.activity_id"
);

impl PersistentEngine {
    /// Every fetched track whose series is still unknown and still worth
    /// asking about. Not part of the backfill queue: the points are already
    /// elevated, so nothing here holds detection or the cutover.
    pub fn tracks_owed_elevation_source(&self) -> SqlResult<Vec<String>> {
        let mut stmt = self.db.prepare(ELEVATION_SOURCE_QUEUE_SQL)?;
        let rows = stmt.query_map(
            params![
                i64::from(crate::persistence::ELEVATION_STATE_FETCHED),
                i64::from(crate::persistence::ELEVATION_SOURCE_UNKNOWN),
                i64::from(ELEVATION_ATTEMPT_LIMIT)
            ],
            |row| row.get::<_, String>(0),
        )?;
        rows.collect()
    }
}

impl PersistentEngine {
    /// The backfill queue: every stored track upstream has not been asked
    /// about, with the sport its re-ingest has to preserve.
    ///
    /// Derived from `elevation_state` on every call rather than held anywhere,
    /// so completed work leaves the queue the moment its provenance lands and a
    /// half-finished run needs no bookkeeping to resume.
    ///
    /// `UNAVAILABLE` is out of the queue, not in it. Upstream has already
    /// answered for those tracks and the answer will not change, so keeping
    /// them would mean no pass over such a library could ever end. They still
    /// count against `elevation_backfill_outstanding`, which answers the
    /// different question of whether the library reads uniformly.
    ///
    /// Newest first: a user scrolling their feed after an update sees the
    /// activities they care about most convert first.
    pub fn tracks_missing_elevation(&self) -> SqlResult<Vec<(String, String)>> {
        let mut stmt = self.db.prepare(ELEVATION_QUEUE_SQL)?;
        let rows = stmt.query_map(
            params![i64::from(crate::persistence::ELEVATION_STATE_UNKNOWN)],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        rows.collect()
    }
}

/// Where the next pass begins in the derived queue.
///
/// The queue is re-derived in the same order every pass, so a block of tracks
/// the connection keeps refusing stops every pass in the same place and
/// nothing behind it is ever asked. A pass that gave up therefore starts the
/// next one past the block it gave up on. Process-local on purpose: the ladder
/// asks again at most every half hour and a launch that re-reads from the
/// newest track costs one pass, where a stored offset costs a column and a
/// migration.
static NEXT_START: AtomicUsize = AtomicUsize::new(0);

/// Where the pass after this one starts, given where this one started and
/// whether it gave up.
///
/// Only a give-up moves it. Every other ending leaves the rows untouched for a
/// reason that is not about these tracks, an outage or a pause, and the next
/// pass should ask in the order the athlete sees convert first.
fn next_pass_start(start: usize, gave_up: bool, queue_len: usize) -> usize {
    if !gave_up || queue_len == 0 {
        return 0;
    }
    // Past the whole block that ended the walk, not one track past its first:
    // a give-up means this many in a row answered with nothing to work with.
    (start + MAX_CONSECUTIVE_FAILURES) % queue_len
}

/// The queue as this pass walks it: the derived order, rotated to `start`.
///
/// Every track is still walked exactly once, so a rotation costs nothing but
/// the order, and the order only moves after a give-up.
fn rotated(queue: &[(String, String)], start: usize) -> Vec<(String, String)> {
    if queue.is_empty() {
        return Vec::new();
    }
    let start = start % queue.len();
    let mut walked = queue[start..].to_vec();
    walked.extend_from_slice(&queue[..start]);
    walked
}

impl PersistentEngine {
    /// How many tracks the backfill still has to ask about. Zero means a pass
    /// has nothing left to do, which is not the same as the library reading
    /// uniformly elevated.
    ///
    /// The query error is propagated rather than counted as zero. Both launch
    /// triggers treat a zero as the definitive "nothing left", one of them by
    /// stamping the app version, and a locked database at launch is ordinary.
    pub fn elevation_backfill_remaining(&self) -> SqlResult<u64> {
        pooled_elevation_backfill_remaining(&self.db)
    }

    /// One track's elevation provenance, or `None` when no track is stored.
    /// The counts answer "is the library uniform"; this answers "did this
    /// activity's own re-fetch land", which is what a per-activity assertion
    /// and a debug screen need.
    pub fn elevation_state_of_track(&self, id: &str) -> Option<u8> {
        self.db
            .query_row(
                "SELECT elevation_state FROM gps_tracks WHERE activity_id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .ok()
            .and_then(|v| u8::try_from(v).ok())
    }
}

// ============================================================================
// The run
// ============================================================================

/// What the pass asks upstream for.
///
/// Elevation alone is the ordinary ask: the coordinates of every row in the
/// queue are already stored, so re-downloading them costs about five times the
/// bytes and risks replacing geometry the catalogue was derived from. The
/// whole track is asked for only when the stored sample count no longer
/// matches upstream.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Ask {
    Elevation,
    Track,
}

/// One track's fetch, reduced to what the store step needs.
enum Fetched {
    /// An altitude series to splice onto the points already stored, and which
    /// series it is.
    Altitudes(Vec<f64>, ElevationSeries),
    /// A whole track, re-fetched because the stored one no longer matches, and
    /// the series its elevation came from.
    Elevated(Vec<GpsPoint>, ElevationSeries),
    /// The response arrived, carried an altitude series, and none of it was
    /// usable. Upstream has answered and the answer will not change.
    NoAltitude,
    /// The response carried no altitude series at all. A stored track exists,
    /// so upstream once had this activity; nothing now is a transient answer,
    /// and the row stays as it is for the next run to retry.
    Empty,
    /// The request failed. The row stays as it is.
    Failed(NetError),
}

/// Reduce an elevation-only response to the store step's cases.
///
/// A response with no altitude series at all cannot be read here: with the
/// coordinates left out of the request there is nothing to tell "upstream has
/// no altitude for this ride" from "upstream answered with nothing at all",
/// and those end differently, one permanently and one on the next run. It
/// comes back as [`Fetched::Empty`], which sends that activity to the whole
/// track ask, where the coordinates settle it.
fn reduce_altitudes(parsed: Option<ParsedStreams>) -> Fetched {
    let Some(parsed) = parsed else {
        return Fetched::Empty;
    };
    if !parsed.altitude.iter().any(|e| e.is_finite()) {
        return Fetched::NoAltitude;
    }
    Fetched::Altitudes(
        parsed.altitude,
        ElevationSeries::upstream(parsed.altitude_is_fixed),
    )
}

/// Reduce a whole-track response to the store step's cases. Coordinates and
/// altitude already share one index space, so a sample's elevation is the one
/// at its own index or none at all.
fn reduce(parsed: ParsedStreams) -> Fetched {
    if parsed.latlng.is_empty() {
        return Fetched::Empty;
    }
    let usable = parsed.altitude.iter().any(|e| e.is_finite());
    if !usable || parsed.latlng.len() < 2 {
        return Fetched::NoAltitude;
    }
    let points = parsed
        .latlng
        .iter()
        .enumerate()
        .map(|(i, p)| {
            match parsed
                .altitude
                .get(i)
                .copied()
                .filter(|e: &f64| e.is_finite())
            {
                Some(ele) => GpsPoint::with_elevation(p[0], p[1], ele),
                None => GpsPoint::new(p[0], p[1]),
            }
        })
        .collect();
    Fetched::Elevated(points, ElevationSeries::upstream(parsed.altitude_is_fixed))
}

/// Fetch one batch, bounded to [`FETCH_CONCURRENCY`] requests in flight.
///
/// The URL names each activity by the id upstream knows it by, which `upstream`
/// maps from the local key. A key it does not hold is its own upstream id. The
/// results stay keyed by the local key.
async fn fetch_batch(
    transport: &Transport,
    ids: &[String],
    ask: Ask,
    upstream: &std::collections::HashMap<String, String>,
) -> Vec<(String, Fetched)> {
    use futures::stream::{self, StreamExt};

    stream::iter(ids.to_vec())
        .map(|id| async move {
            let named = upstream.get(&id).unwrap_or(&id).as_str();
            let outcome = match ask {
                Ask::Elevation => match fetch_altitude(transport, named, Lane::Backfill).await {
                    Ok(altitudes) => reduce_altitudes(altitudes),
                    Err(e) => Fetched::Failed(e),
                },
                Ask::Track => {
                    match fetch_streams(transport, named, TRACK_STREAM_TYPES, Lane::Backfill).await
                    {
                        Ok(parsed) => reduce(parsed),
                        Err(e) => Fetched::Failed(e),
                    }
                }
            };
            (id, outcome)
        })
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await
}

/// Fetch the elevation every flat stored track is missing, splice it onto the
/// points already held, then re-cut the catalogue once.
///
/// Blocking, so a caller can drive it and see the outcome. Detection is
/// suspended from before the first fetch until after the terminal phase is
/// set, structurally: the guard's drop is the release, so a failure part way
/// through resumes detection just as a clean finish does. The final re-cut
/// starts while the guard is still held (through the unchecked engine path),
/// so nothing else can claim the detection slot between the last store and
/// the re-cut, and it runs only when the queue drained to empty, so no
/// catalogue is ever cut over a half-converted library.
pub fn run_elevation_backfill(transport: &Transport, athlete_id: &str) -> BackfillRun {
    let Some(slot) = RunGuard::claim() else {
        log::info!("[Elevation] backfill refused: a run is already in flight");
        return BackfillRun::Refused;
    };
    run_in_slot(slot, engine_install(), transport, athlete_id)
}

/// The pass proper, on a slot the caller already holds. The guard lives to
/// the end of the run so the slot is released after the terminal phase, and
/// after the suspension, which was taken later and so drops first.
///
/// A pass that ran its queue without being stopped then settles the series of
/// the tracks fetched before the engine recorded it, after the suspension has
/// dropped: that walk moves no point, so it holds nothing.
fn run_in_slot(
    _slot: RunGuard,
    install: u64,
    transport: &Transport,
    athlete_id: &str,
) -> BackfillRun {
    let (run, stopped) = run_queue(install, transport, athlete_id);
    if matches!(run, BackfillRun::Finished(_)) && !stopped {
        resolve_sources(install, transport, athlete_id);
    }
    record_run(install, &run);
    run
}

/// The pass's one exit: the last-run summary is written here, from the phase
/// the pass settled on, so no early return can skip it.
fn record_run(install: u64, run: &BackfillRun) {
    let phase = backfill_progress().phase;
    let summary = match run {
        BackfillRun::Refused => return,
        BackfillRun::Failed(_) => JobRun {
            job: BackgroundJob::ElevationBackfill,
            finished_at: now_ms(),
            outcome: RunOutcome::Failed,
            handled: 0,
            added: 0,
            changed: 0,
            retired: 0,
            failed: 0,
        },
        BackfillRun::Finished(outcome) => JobRun {
            job: BackgroundJob::ElevationBackfill,
            finished_at: now_ms(),
            outcome: run_outcome(phase, outcome.failed),
            handled: outcome.queued,
            added: 0,
            changed: outcome.elevated,
            retired: outcome.unavailable + outcome.retired,
            failed: outcome.failed,
        },
    };
    let _ = with_persistent_engine_for(install, |engine| record_job_run(&engine.db, &summary));
}

/// How a finished pass reads in the last-run summary. A pass that walked its
/// whole queue but left tracks for the next one is partial, not complete.
fn run_outcome(phase: &str, failed: u32) -> RunOutcome {
    match phase {
        BACKFILL_PHASE_PAUSED => RunOutcome::Paused,
        BACKFILL_PHASE_FAILED => RunOutcome::Failed,
        BACKFILL_PHASE_COMPLETE if failed == 0 => RunOutcome::Complete,
        _ => RunOutcome::Partial,
    }
}

/// The elevation queue, under the detection suspension. Returns how the pass
/// ended and whether it was stopped before its queue was.
fn run_queue(install: u64, transport: &Transport, athlete_id: &str) -> (BackfillRun, bool) {
    let queue =
        match with_persistent_engine_for(install, |engine| engine.tracks_missing_elevation()) {
            Some(Ok(queue)) => queue,
            Some(Err(e)) => {
                set_phase(BACKFILL_PHASE_FAILED);
                return (
                    BackfillRun::Failed(format!("queue unreadable: {}", e)),
                    true,
                );
            }
            None => {
                set_phase(BACKFILL_PHASE_FAILED);
                return (BackfillRun::Failed("no engine".to_string()), true);
            }
        };

    // A pass that gave up leaves its start past the block it gave up on, so
    // the next one asks about the library behind it rather than stopping in
    // the same place for ever.
    let start = if queue.is_empty() {
        0
    } else {
        NEXT_START.load(Ordering::Relaxed) % queue.len()
    };
    let queue = rotated(&queue, start);

    BACKFILL.total.store(queue.len() as u32, Ordering::Relaxed);
    BACKFILL.completed.store(0, Ordering::Relaxed);
    BACKFILL.failed.store(0, Ordering::Relaxed);
    set_phase(BACKFILL_PHASE_FETCHING);
    log::warn!("[Elevation] backfill starting over {} tracks", queue.len());

    let _suspend = suspend_detection();

    let walk = drain_queue(install, transport, athlete_id, &queue, true);
    let (mut outcome, stopped, owed) = re_ask(install, transport, athlete_id, walk);
    // Whatever is still owed was asked and refused, so it is this pass's
    // failure count. Stored rather than added: the gauge counted every refusal
    // as it happened, and a track that landed on a later round is not one.
    outcome.failed += owed.len() as u32;
    BACKFILL.failed.store(outcome.failed, Ordering::Relaxed);

    match stopped {
        Some(Stopped::SignedOut | Stopped::Superseded) => {
            set_phase(BACKFILL_PHASE_PARTIAL);
            return (BackfillRun::Finished(outcome), true);
        }
        Some(Stopped::Unauthorized) => {
            set_phase(BACKFILL_PHASE_FAILED);
            log::warn!("[Elevation] backfill stopped: unauthorized");
            // The pass is the only thing talking upstream during a
            // conversion, so a credential rejected here is reported the way
            // sync reports one. Nothing else would ask until the next sync,
            // and until then the revoked session stands.
            crate::runtime::block_on(crate::objects::park_auth_expired(transport, athlete_id));
            return (BackfillRun::Failed("unauthorized".to_string()), true);
        }
        // Not a failed pass: the rows are untouched and the queue is
        // unchanged, so this ends partial and the next launch retries. A
        // rejected credential is different, nothing will change until the
        // user signs in again.
        Some(Stopped::NothingToWorkWith) => log::warn!(
            "[Elevation] backfill gave up after {} failures in a row, {} of {} tracks still to ask",
            MAX_CONSECUTIVE_FAILURES,
            queue.len() as u32 - outcome.elevated - outcome.unavailable,
            queue.len()
        ),
        // Also not a failed pass. The rows are untouched, the queue is
        // unchanged, and the ladder that owns the retry decides when to ask
        // again now that the network is worth asking on.
        Some(Stopped::Offline) => log::info!(
            "[Elevation] backfill stopped: offline, {} of {} tracks still to ask",
            queue.len() as u32 - outcome.elevated - outcome.unavailable,
            queue.len()
        ),
        // The rows are untouched here too. Nothing asks again until the next
        // launch, by design, and the phase says so.
        Some(Stopped::Paused) => log::info!(
            "[Elevation] backfill stopped: paused, {} of {} tracks still to ask",
            queue.len() as u32 - outcome.elevated - outcome.unavailable,
            queue.len()
        ),
        Some(Stopped::SwitchedOff) => log::info!(
            "[Elevation] backfill stopped: Route Matching off, {} of {} tracks still to ask",
            queue.len() as u32 - outcome.elevated - outcome.unavailable,
            queue.len()
        ),
        None => {}
    }

    NEXT_START.store(
        next_pass_start(
            start,
            matches!(stopped, Some(Stopped::NothingToWorkWith)),
            queue.len(),
        ),
        Ordering::Relaxed,
    );

    // An unreadable count is not a drained one: a pass that cannot see its own
    // queue ends partial, so the next launch asks again rather than the run
    // claiming a library it never checked.
    let remaining =
        with_persistent_engine_for(install, |engine| engine.elevation_backfill_remaining().ok())
            .unwrap_or(None);
    let drained = remaining == Some(0);

    // The terminal phase lands before the guard releases, so there is no
    // window in which the phase still reads "fetching" while detection has
    // already resumed.
    set_phase(if matches!(stopped, Some(Stopped::Paused)) {
        BACKFILL_PHASE_PAUSED
    } else if drained {
        BACKFILL_PHASE_COMPLETE
    } else {
        BACKFILL_PHASE_PARTIAL
    });

    // The terminal cut fires on the pass that drains the queue, whatever the
    // queue turned out to hold. It used to also require the library to carry
    // some elevation, which excluded a library upstream has altitude for
    // nothing: the queue drains honestly, elevates nothing, and the cut never
    // fired, leaving the cutover owed and detection refused.
    // `terminal_cut` re-checks whether a cutover is owed and falls through to a
    // plain re-cut when it is not, so the drained queue is the whole condition.
    // The guard is still held here, so nothing else can claim the slot first.
    if drained && outcome.queued > 0 && terminal_cut(install) {
        outcome.detects_started = 1;
        BACKFILL.detects.fetch_add(1, Ordering::Relaxed);
    }
    log::info!(
        "[Elevation] backfill finished: {} elevated, {} unavailable, {} retired, {} failed, {} still to ask",
        outcome.elevated,
        outcome.unavailable,
        outcome.retired,
        outcome.failed,
        remaining.map_or_else(|| "an unreadable number of".to_string(), |n| n.to_string())
    );

    (BackfillRun::Finished(outcome), stopped.is_some())
}

/// Why a pass ended before its queue did.
enum Stopped {
    SignedOut,
    /// Another library was installed under the walk, so what it fetches would
    /// be discarded and what it holds would keep detection suspended.
    Superseded,
    /// The credential was rejected, so every remaining request would be too.
    Unauthorized,
    /// Nothing to work with: [`MAX_CONSECUTIVE_FAILURES`] in a row.
    NothingToWorkWith,
    /// TypeScript says the network is gone, so the rest of the queue would
    /// only be spent discovering that one request at a time.
    Offline,
    /// The athlete paused the download.
    Paused,
    /// Route Matching was switched off during the download.
    SwitchedOff,
}

/// Whether this failure says the connection is gone rather than answering for
/// one activity.
///
/// A transport error, an exhausted budget and a 5xx all mean the next request
/// will fare no better. A 404 or a body that would not parse is upstream
/// replying about one track, and counting those would wedge the queue: the
/// order is re-derived the same way every run, so a permanently 404-ing
/// prefix would stop every future pass at the same place.
fn is_connectivity(e: &NetError) -> bool {
    match e {
        NetError::Transport(_) | NetError::RateLimited => true,
        NetError::Http { status, .. } => *status >= 500,
        _ => false,
    }
}

/// Ask again for the tracks the connection refused, in bounded rounds that
/// wait longer each time.
///
/// Skipped when the first walk stopped: a rejected credential rejects the
/// retry too, and the consecutive-failure threshold has already established
/// that the connection is gone rather than blinking. Returns the accumulated
/// outcome, why the pass ended if it did, and what is still owed.
fn re_ask(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    first: Walk,
) -> (BackfillOutcome, Option<Stopped>, Vec<(String, String)>) {
    re_ask_with(
        first,
        |delay| {
            std::thread::sleep(delay);
            true
        },
        |queue| drain_queue(install, transport, athlete_id, queue, false),
    )
}

/// The ladder itself, with the waiting and the asking handed in.
///
/// Split from [`re_ask`] the way [`drain_queue_with`] is split from
/// [`drain_queue`], and for the same reason `resume_ladder` takes its sleep:
/// the schedule is an array, and a test that has to spend it to read it costs
/// the suite the whole ladder and asserts on wall clock, which two earlier
/// passes over this file already failed on.
///
/// `wait` returning false ends the re-asking at that round, which is both how
/// a test skips the ladder and the only cancel this pass has.
fn re_ask_with(
    first: Walk,
    mut wait: impl FnMut(Duration) -> bool,
    mut ask: impl FnMut(&[(String, String)]) -> Walk,
) -> (BackfillOutcome, Option<Stopped>, Vec<(String, String)>) {
    let Walk {
        mut outcome,
        stopped,
        mut refused,
        unasked,
    } = first;

    if stopped.is_some() {
        return (outcome, stopped, refused);
    }

    let mut stopped = None;
    for delay in backfill_retry_delays() {
        if refused.is_empty() {
            break;
        }
        log::info!(
            "[Elevation] re-asking {} refused tracks in {:?}",
            refused.len(),
            delay
        );
        if !wait(delay) {
            break;
        }

        let round = ask(&refused);
        outcome.elevated += round.outcome.elevated;
        outcome.unavailable += round.outcome.unavailable;
        outcome.failed += round.outcome.failed;
        outcome.retired += round.outcome.retired;
        // A round that stopped part way never asked the rest, and they were
        // refused once already, so they stay owed rather than disappearing.
        refused = round.refused;
        refused.extend(round.unasked);
        if round.stopped.is_some() {
            stopped = round.stopped;
            break;
        }
    }

    refused.extend(unasked);
    (outcome, stopped, refused)
}

/// One walk of a list of tracks, and what it left owing.
struct Walk {
    outcome: BackfillOutcome,
    /// Why the walk ended before its list did, if it did.
    stopped: Option<Stopped>,
    /// Asked, and the connection refused. Worth asking again.
    refused: Vec<(String, String)>,
    /// Never asked, because the walk stopped first.
    unasked: Vec<(String, String)>,
}

/// Walk a list of tracks in batches, fetching and storing what it can.
///
/// `count_progress` is false for a retry round: those tracks are already in
/// the completed count from the first walk, and counting them again pushes the
/// progress line past its own total.
fn drain_queue(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    queue: &[(String, String)],
    count_progress: bool,
) -> Walk {
    // Resolved once for the walk, so the dispatch loop never waits on the
    // engine lock.
    let keys: Vec<String> = queue.iter().map(|(id, _)| id.clone()).collect();
    let upstream = with_persistent_engine_for(install, |engine| engine.intervals_ids(&keys))
        .unwrap_or_default();
    drain_queue_with_auth(
        install,
        queue,
        count_progress,
        || crate::objects::sync::still_signed_in(athlete_id),
        |ids, ask| crate::runtime::block_on(fetch_batch(transport, ids, ask, &upstream)),
    )
}

/// The walk itself, with the fetch handed in.
///
/// Split from [`drain_queue`] so the stop conditions can be exercised without
/// a transport: everything that ends a walk early is decided here.
#[cfg(test)]
fn drain_queue_with(
    install: u64,
    queue: &[(String, String)],
    count_progress: bool,
    fetch: impl FnMut(&[String], Ask) -> Vec<(String, Fetched)>,
) -> Walk {
    drain_queue_with_auth(install, queue, count_progress, || true, fetch)
}

fn drain_queue_with_auth(
    install: u64,
    queue: &[(String, String)],
    count_progress: bool,
    mut still_signed_in: impl FnMut() -> bool,
    mut fetch: impl FnMut(&[String], Ask) -> Vec<(String, Fetched)>,
) -> Walk {
    let mut outcome = BackfillOutcome {
        queued: queue.len() as u32,
        ..BackfillOutcome::default()
    };
    let mut refused: Vec<(String, String)> = Vec::new();

    let mut consecutive_failures = 0usize;

    for (chunk, batch) in queue.chunks(BATCH).enumerate() {
        if engine_install() != install {
            return Walk {
                outcome,
                stopped: Some(Stopped::Superseded),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }
        if !still_signed_in() {
            return Walk {
                outcome,
                stopped: Some(Stopped::SignedOut),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }
        // Read before every batch, not only before the walk: a pass that
        // loses the network half way through would otherwise spend the rest
        // of its queue discovering that one request at a time. Advisory, so
        // an unset or stale state falls through and the walk carries on.
        if crate::net::connectivity::is_offline() {
            return Walk {
                outcome,
                stopped: Some(Stopped::Offline),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }
        if elevation_backfill_paused() {
            return Walk {
                outcome,
                stopped: Some(Stopped::Paused),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }
        if detection_switched_off() {
            return Walk {
                outcome,
                stopped: Some(Stopped::SwitchedOff),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }

        let ids: Vec<String> = batch.iter().map(|(id, _)| id.clone()).collect();
        let fetched = fetch(&ids, Ask::Elevation);

        // A rejected credential rejects every remaining request too. Spending
        // the rest of the library on 401s helps nobody, so the pass stops and
        // the untouched rows wait for the next one.
        if fetched
            .iter()
            .any(|(_, f)| matches!(f, Fetched::Failed(NetError::Unauthorized)))
        {
            return Walk {
                outcome,
                stopped: Some(Stopped::Unauthorized),
                refused,
                unasked: queue[chunk * BATCH..].to_vec(),
            };
        }

        let sports: std::collections::HashMap<&str, &str> = batch
            .iter()
            .map(|(id, sport)| (id.as_str(), sport.as_str()))
            .collect();

        let mut plan = Plan::default();
        for (id, result) in fetched {
            if plan.sort(id, result, Ask::Elevation, &sports, &mut outcome) {
                consecutive_failures = 0;
            } else {
                consecutive_failures += 1;
            }
        }

        // A sample count that no longer matches the stored track means
        // intervals.icu re-processed the activity, so its coordinates really
        // did move and the catalogue has to be re-derived from what it holds
        // now. That, and an unreadable answer, are the only reasons a whole
        // track is ever downloaded again.
        let (spliced, mut moved) = splice_batch(install, &plan.splice);
        outcome.elevated += spliced;
        moved.append(&mut plan.whole);
        if !moved.is_empty() {
            log::info!(
                "[Elevation] {} tracks need the whole series, asking again",
                moved.len()
            );
            let whole = fetch(&moved, Ask::Track);
            // The same credential rejection as the first ask: none of these
            // tracks was answered about, so none is counted against its limit.
            if whole
                .iter()
                .any(|(_, f)| matches!(f, Fetched::Failed(NetError::Unauthorized)))
            {
                refused.append(&mut plan.refused);
                outcome.elevated +=
                    store_batch(install, &plan.store, &plan.states, &plan.sources) as u32;
                let owed: std::collections::HashSet<&str> =
                    moved.iter().map(String::as_str).collect();
                plan.attempted.retain(|id| !owed.contains(id.as_str()));
                outcome.retired += retire_batch(install, &plan.attempted);
                let mut unasked: Vec<(String, String)> = batch
                    .iter()
                    .filter(|(id, _)| owed.contains(id.as_str()))
                    .cloned()
                    .collect();
                unasked.extend_from_slice(&queue[chunk * BATCH + batch.len()..]);
                return Walk {
                    outcome,
                    stopped: Some(Stopped::Unauthorized),
                    refused,
                    unasked,
                };
            }
            for (id, result) in whole {
                plan.sort(id, result, Ask::Track, &sports, &mut outcome);
            }
        }
        refused.append(&mut plan.refused);

        outcome.elevated += store_batch(install, &plan.store, &plan.states, &plan.sources) as u32;
        outcome.retired += retire_batch(install, &plan.attempted);
        if count_progress {
            BACKFILL
                .completed
                .fetch_add(batch.len() as u32, Ordering::Relaxed);
        }

        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            return Walk {
                outcome,
                stopped: Some(Stopped::NothingToWorkWith),
                refused,
                unasked: queue[chunk * BATCH + batch.len()..].to_vec(),
            };
        }
    }

    Walk {
        outcome,
        stopped: None,
        refused,
        unasked: Vec::new(),
    }
}

/// What one batch decided to do, before the engine is touched.
#[derive(Default)]
struct Plan {
    /// Altitude series to splice onto tracks already stored.
    splice: Vec<(String, Vec<f64>, ElevationSeries)>,
    /// Whole tracks to re-ingest, from the whole-track ask.
    store: Vec<(String, Vec<GpsPoint>, String)>,
    /// The series each of `store` carries, recorded once its points land.
    sources: Vec<(String, u8)>,
    /// Activities the elevation ask could not settle, which the whole track
    /// can.
    whole: Vec<String>,
    /// Provenance for activities whose points are not being written.
    states: Vec<(String, u8)>,
    /// Asked, and the connection refused. Worth asking again.
    refused: Vec<(String, String)>,
    /// Asked, and the answer settled nothing. Counted against the track, so a
    /// track upstream never answers for eventually leaves the queue.
    attempted: Vec<String>,
}

impl Plan {
    /// Sort one activity's answer into what the store step will do with it.
    /// Returns whether the answer proves the connection is working, which is
    /// what resets the consecutive-failure count.
    fn sort(
        &mut self,
        id: String,
        result: Fetched,
        ask: Ask,
        sports: &std::collections::HashMap<&str, &str>,
        outcome: &mut BackfillOutcome,
    ) -> bool {
        let sport = |id: &str| sports.get(id).copied().unwrap_or("Ride").to_string();
        match result {
            Fetched::Altitudes(altitudes, series) => {
                self.splice.push((id, altitudes, series));
                true
            }
            Fetched::Elevated(points, series) => {
                let sport = sport(&id);
                self.sources
                    .push((id.clone(), elevation_source_of(&points, series)));
                self.store.push((id, points, sport));
                true
            }
            Fetched::NoAltitude => {
                self.states.push((id, ELEVATION_STATE_UNAVAILABLE));
                outcome.unavailable += 1;
                true
            }
            Fetched::Empty if ask == Ask::Elevation => {
                // Nothing came back for an ask that left the coordinates out.
                // The whole track tells an activity upstream has no altitude
                // for from one it has nothing for at all.
                self.whole.push(id);
                true
            }
            Fetched::Empty => {
                log::info!("[Elevation] {} answered empty, left for the next run", id);
                outcome.failed += 1;
                BACKFILL.failed.fetch_add(1, Ordering::Relaxed);
                self.attempted.push(id);
                // Upstream replied, so the connection is fine.
                true
            }
            Fetched::Failed(e) => {
                BACKFILL.failed.fetch_add(1, Ordering::Relaxed);
                if is_connectivity(&e) {
                    log::warn!("[Elevation] {} refused, worth asking again: {}", id, e);
                    let sport = sport(&id);
                    self.refused.push((id, sport));
                    false
                } else {
                    log::info!("[Elevation] {} left for the next run: {}", id, e);
                    outcome.failed += 1;
                    self.attempted.push(id);
                    true
                }
            }
        }
    }
}

/// Splice each fetched altitude series onto the track already stored.
///
/// Returns how many landed and the ids whose stored sample count no longer
/// matches upstream, which are the only ones that need the whole track. The
/// splice sets provenance in the same statement, so nothing here goes through
/// `record_elevation_state`.
fn splice_batch(
    install: u64,
    splice: &[(String, Vec<f64>, ElevationSeries)],
) -> (u32, Vec<String>) {
    if splice.is_empty() {
        return (0, Vec::new());
    }
    with_persistent_engine_for(install, |engine| {
        let mut spliced = 0;
        let mut moved = Vec::new();
        for (id, altitudes, series) in splice {
            match engine.splice_track_elevation(id, altitudes, *series) {
                Ok(true) => spliced += 1,
                Ok(false) => moved.push(id.clone()),
                Err(e) => log::warn!("[Elevation] splice of {} failed: {}", id, e),
            }
        }
        (spliced, moved)
    })
    .unwrap_or((0, Vec::new()))
}

/// Re-ingest the elevated tracks and stamp provenance for the whole batch:
/// `states` for every track, `sources` for the tracks re-ingested.
/// Returns how many tracks landed with elevation.
fn store_batch(
    install: u64,
    to_store: &[(String, Vec<GpsPoint>, String)],
    states: &[(String, u8)],
    sources: &[(String, u8)],
) -> usize {
    let (stored, mutated) = with_persistent_engine_for(install, |engine| {
        // The re-ingest upserts the activity row in place, so its date, name
        // and distance survive, and the section_activities links keyed on the
        // id are never cascade-deleted.
        let mut stored = 0;
        let mut mutated = Vec::new();
        let mut all_states = states.to_vec();
        if !to_store.is_empty() {
            match engine.add_activities_batch(to_store.to_vec()) {
                Ok(ids) => {
                    stored = to_store.len();
                    mutated = ids;
                    // Provenance follows the points the engine kept, so a track
                    // left flat by an unusable series reads as unavailable.
                    all_states.extend(to_store.iter().map(|(id, points, _)| {
                        (id.clone(), crate::ffi::elevation_state_of(points))
                    }));
                    // The re-ingest reset the series to unknown.
                    if let Err(e) = engine.record_elevation_source(sources) {
                        log::warn!("[Elevation] series not recorded: {}", e);
                    }
                }
                Err(e) => log::warn!("[Elevation] batch store failed: {}", e),
            }
        }

        if let Err(e) = engine.record_elevation_state(&all_states) {
            log::warn!("[Elevation] provenance not recorded: {}", e);
        }
        (stored, mutated)
    })
    .unwrap_or((0, Vec::new()));

    // Outside the closure, so the reader this wakes is not woken into the
    // engine lock this thread still holds. A splice replaces a stored track,
    // so every preview line drawn from one is stale until its reader is told.
    if !mutated.is_empty() {
        crate::objects::observer::notify(Announcement::GpsTracksMutated(mutated));
    }
    stored
}

/// Count this batch's unsettled asks against their tracks, and report how many
/// that retired.
///
/// A retirement is not a failure and is not counted as one: the pass asked,
/// upstream would not answer, and the row is now out of the queue rather than
/// owed for ever. It still counts against `elevation_backfill_outstanding`,
/// which answers the different question of whether the library reads
/// uniformly.
fn retire_batch(install: u64, attempted: &[String]) -> u32 {
    if attempted.is_empty() {
        return 0;
    }
    let retired = with_persistent_engine_for(install, |engine| {
        engine.record_elevation_attempts(attempted, ELEVATION_ATTEMPT_LIMIT)
    });
    match retired {
        Some(Ok(n)) => {
            if n > 0 {
                log::info!(
                    "[Elevation] {} tracks retired after {} asks upstream would not answer",
                    n,
                    ELEVATION_ATTEMPT_LIMIT
                );
            }
            n as u32
        }
        Some(Err(e)) => {
            log::warn!("[Elevation] asks not counted: {}", e);
            0
        }
        None => 0,
    }
}

// ============================================================================
// The series a fetched track carries
// ============================================================================

/// What one walk of [`PersistentEngine::tracks_owed_elevation_source`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SourceWalk {
    /// Tracks whose points carry the series upstream answered with, now
    /// recorded as that series.
    pub recorded: u32,
    /// Tracks whose points carry something else, handed back to the elevation
    /// queue.
    pub handed_back: u32,
    /// Tracks upstream answered about with nothing to compare, counted against
    /// them.
    pub unanswered: u32,
    /// Whether the walk ended before its list did.
    pub stopped: bool,
}

/// Settle the series of every fetched track the engine does not know it for.
///
/// One elevation-only read per track, the cheap ask the backfill makes. A
/// track handed back is owed elevation again, so the ladder that drains that
/// queue is armed for it.
fn resolve_sources(install: u64, transport: &Transport, athlete_id: &str) -> SourceWalk {
    let (queue, upstream) = match with_persistent_engine_for(install, |engine| {
        let queue = engine.tracks_owed_elevation_source()?;
        let upstream = engine.intervals_ids(&queue);
        Ok::<_, rusqlite::Error>((queue, upstream))
    }) {
        Some(Ok(found)) => found,
        Some(Err(e)) => {
            log::warn!("[Elevation] series queue unreadable: {}", e);
            return SourceWalk::default();
        }
        None => return SourceWalk::default(),
    };
    if queue.is_empty() {
        return SourceWalk::default();
    }
    log::info!("[Elevation] settling the series of {} tracks", queue.len());
    let walk = resolve_sources_with(
        install,
        &queue,
        || crate::objects::sync::still_signed_in(athlete_id),
        |ids| crate::runtime::block_on(fetch_batch(transport, ids, Ask::Elevation, &upstream)),
    );
    log::info!(
        "[Elevation] series settled: {} recorded, {} handed back, {} unanswered{}",
        walk.recorded,
        walk.handed_back,
        walk.unanswered,
        if walk.stopped { ", stopped early" } else { "" }
    );
    if walk.handed_back > 0 {
        arm_resume_ladder();
    }
    walk
}

/// The walk, with the fetch handed in. Stops where the backfill's walk stops:
/// another library installed, a sign-out, the network gone, a pause, a
/// rejected credential, or a whole batch of the connection refusing.
fn resolve_sources_with(
    install: u64,
    queue: &[String],
    mut still_signed_in: impl FnMut() -> bool,
    mut fetch: impl FnMut(&[String]) -> Vec<(String, Fetched)>,
) -> SourceWalk {
    let mut walk = SourceWalk::default();
    let mut consecutive_failures = 0usize;
    for batch in queue.chunks(BATCH) {
        if engine_install() != install
            || !still_signed_in()
            || crate::net::connectivity::is_offline()
            || elevation_backfill_paused()
        {
            walk.stopped = true;
            return walk;
        }
        let fetched = fetch(batch);
        if fetched
            .iter()
            .any(|(_, f)| matches!(f, Fetched::Failed(NetError::Unauthorized)))
        {
            walk.stopped = true;
            return walk;
        }

        let mut answered = Vec::new();
        let mut attempted = Vec::new();
        for (id, result) in fetched {
            match result {
                Fetched::Altitudes(altitudes, series) => {
                    consecutive_failures = 0;
                    answered.push((id, altitudes, series));
                }
                Fetched::Failed(e) if is_connectivity(&e) => {
                    consecutive_failures += 1;
                }
                // Upstream replied with nothing to compare the points with.
                _ => {
                    consecutive_failures = 0;
                    attempted.push(id);
                }
            }
        }

        with_persistent_engine_for(install, |engine| {
            for (id, altitudes, series) in &answered {
                match engine.settle_elevation_source(id, altitudes, *series) {
                    Ok(crate::persistence::SourceSettled::Recorded) => walk.recorded += 1,
                    Ok(crate::persistence::SourceSettled::HandedBack) => walk.handed_back += 1,
                    Ok(crate::persistence::SourceSettled::Missing) => {}
                    Err(e) => log::warn!("[Elevation] series of {} not settled: {}", id, e),
                }
            }
            if !attempted.is_empty() {
                match engine.record_elevation_attempts(&attempted, ELEVATION_ATTEMPT_LIMIT) {
                    Ok(_) => walk.unanswered += attempted.len() as u32,
                    Err(e) => log::warn!("[Elevation] series asks not counted: {}", e),
                }
            }
        });

        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            walk.stopped = true;
            return walk;
        }
    }
    walk
}

/// Put a walk of the unknown series on a thread when nothing holds the slot.
///
/// For a launch whose elevation queue is empty: a pass that runs settles the
/// series itself once its queue is done, and the slot it holds refuses this.
fn start_source_pass() {
    let owed = crate::objects::error::with_reader(|conn| {
        conn.query_row(
            &format!("SELECT EXISTS ({})", ELEVATION_SOURCE_QUEUE_SQL),
            params![
                i64::from(crate::persistence::ELEVATION_STATE_FETCHED),
                i64::from(crate::persistence::ELEVATION_SOURCE_UNKNOWN),
                i64::from(ELEVATION_ATTEMPT_LIMIT)
            ],
            |row| row.get::<_, bool>(0),
        )
    });
    if !matches!(owed, Ok(Ok(true))) {
        return;
    }
    if elevation_backfill_paused() || crate::net::connectivity::is_offline() {
        return;
    }
    let Some(slot) = RunGuard::claim() else {
        return;
    };
    let Some(Ok((transport, athlete_id))) = crate::objects::current_session() else {
        return;
    };
    let install = engine_install();
    crate::threads::spawn_named("veloq-elev", move || {
        let _slot = slot;
        resolve_sources(install, &transport, &athlete_id);
    });
}

/// The one cut a drained pass owes, handed to whoever owns it.
///
/// An upgrading install is owed the detector cutover, and
/// `cutover::start_cutover`, which the launch trigger calls, answers `Held`
/// while this queue is non-empty, so the pass that empties the queue is the
/// only thing left that can hand it over. It has to hand over rather than
/// re-cut: the cutover archives the flat-era catalogue, switches the config
/// and then runs the same cold detect, so a bare re-cut here is both a
/// duplicate pass and the thing that retires the migration before it has
/// run. It stamps `DETECTOR_METHOD` on the catalogue, and
/// `cutover_is_owed` reads false from that stamp forever after.
///
/// Run inline rather than spawned, so the suspension guard this is called
/// under covers the migration too. Spawning would release it between the two
/// and let an ordinary conditioning detect land a catalogue for the archive to
/// snapshot instead of the flat-era one.
fn terminal_cut(install: u64) -> bool {
    let owed =
        with_persistent_engine_for(install, |engine| engine.cutover_is_owed()).unwrap_or(false);
    if !owed {
        return start_final_detect(install);
    }
    match crate::persistence::cutover::run_cutover() {
        Ok(CutoverOutcome::Completed(_)) => true,
        // Owed a moment ago and not owed now, or a run already in flight:
        // either way something else is doing the cold detect this pass would
        // have started, so starting a second one duplicates it.
        Ok(CutoverOutcome::NotOwed) => false,
        // The athlete stopped it. The migration is still owed and the next
        // launch runs it again, so this pass starts nothing of its own: a
        // final detect here would rebuild the catalogue the cancel was asking
        // the app to stop rebuilding.
        Ok(CutoverOutcome::Cancelled) => false,
        Err(e) => {
            log::warn!("[Elevation] cutover handover failed: {}", e);
            false
        }
    }
}

/// Start the single re-cut and drive it to a durable catalogue. Called with
/// the suspension guard still held, which is why it uses the unchecked engine
/// path: the guard blocks every other arm, so a slot this drains stays free.
///
/// Clearing the processed set is what makes it cold: it drops the evidence
/// cache, and with it the per-track lift candidates memoised on activity id
/// alone while the library was flat.
fn start_final_detect(install: u64) -> bool {
    // A run that predates the backfill may still hold the detection slot.
    // Wait on the shared poll until its worker has applied and freed it. The
    // cold re-cut below then supersedes whatever it wrote. The suspension
    // refuses every new start, so once the slot empties it stays empty.
    match wait_on_slot(DRIVER_POLL, false) {
        SlotWait::Idle => {}
        other => {
            // Bounded, because a worker that hangs rather than panicking never
            // reports `Died`. The re-cut is skipped and the ladder asks again.
            log::warn!(
                "[Elevation] re-cut skipped: could not drain the slot: {:?}",
                other
            );
            return false;
        }
    }

    // Held across check, spawn and install. Releasing it to spawn lets a loser
    // start a second worker that rewrites `route_groups` on its own connection
    // beside the winner, with both track pools resident.
    let mut guard = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        // Something took the slot between the drain and here. The winning run
        // covers the same pool.
        return false;
    }

    let handle = with_persistent_engine_for(install, |engine| {
        engine.clear_processed_activity_ids();
        engine.detect_sections_background_unchecked_applying(
            crate::persistence::sections::detection::ApplyOn::Worker,
        )
    });

    let Some(handle) = handle else {
        return false;
    };

    let slot = handle.checkpoint_slot();
    crate::objects::detection::record_started_run(&slot);
    *guard = Some(handle);
    drop(guard);
    slot.mark_installed(install);

    crate::threads::spawn_named("veloq-elev", || {
        // Bounded like the drain above: this thread outlives the call, so a
        // run that hangs would otherwise leave it polling for the life of the
        // process.
        match wait_on_slot(DRIVER_POLL, true) {
            SlotWait::Applied => {
                log::info!("[Elevation] re-cut applied");
            }
            SlotWait::Idle | SlotWait::Died => {}
            other => log::warn!("[Elevation] re-cut not followed to its end: {:?}", other),
        }
    });
    true
}

/// Start a backfill on a detached thread using the process credential.
///
/// The verdict names the refusal, so a caller can tell an empty queue, which
/// is the job finished, from a device that is merely offline. It is safe to
/// fire at every launch.
pub fn start_elevation_backfill() -> FfiStartOutcome {
    let outcome = start_pass();
    // A pass refused for want of a credential, or one that ends partial when
    // the connection goes away, needs the ladder. A switched-off library waits
    // for the setting write to arm a new one.
    if !detection_switched_off() {
        arm_resume_ladder();
    }
    outcome
}

/// What the engine starts on its own once it has a library and a credential.
///
/// Called where either arrives: the library opening, which a restore does
/// too, and the credential being handed over. The queue in `gps_tracks` is the
/// only record of what is owed, so a library that has been replaced is asked
/// about afresh with nothing to clear. The pass refuses while Route Matching
/// is off, and with no credential nothing is armed, since the credential's
/// arrival asks again. A queue that is empty hands over to the detector
/// cutover, which answers held while any of it remains; the pass that drains
/// the queue hands over itself. The stored climb rows owed to a library that
/// predates them start first, on a thread of their own. The series of tracks
/// fetched before the engine recorded it is settled last, by the pass when one
/// runs and on a thread of its own when none does.
pub fn start_owed_work() -> FfiStartOutcome {
    // The climb rows read only what is stored, so they are owed whatever the
    // credential and Route Matching say.
    crate::persistence::climb_bests::start_backfill();
    let outcome = match with_persistent_engine(|engine| engine.detection_enabled()) {
        None => return FfiStartOutcome::NotReady,
        Some(false) => FfiStartOutcome::NotConfigured,
        Some(true) if crate::objects::current_session().is_none() => FfiStartOutcome::NotConfigured,
        Some(true) => start_elevation_backfill(),
    };
    if matches!(
        outcome,
        FfiStartOutcome::NotOwed | FfiStartOutcome::NotConfigured
    ) {
        crate::persistence::cutover::start_cutover();
    }
    // Which series a fetched track carries matters to the climb ranking
    // whether or not Route Matching is on, so this is not gated on it.
    start_source_pass();
    outcome
}

/// One attempt to put a pass on a thread, and why it was refused when it was.
fn start_pass() -> FfiStartOutcome {
    // A queue that cannot be read is not an empty one, but it is also not a
    // queue a run could work, so this declines and the next launch asks again.
    // The two are separate answers: an empty queue is the job finished and
    // stops the caller asking, an unreadable one is worth asking about again.
    // The count reads through the pool, so a launch sync holding the write
    // lock for a page does not hold the JS thread that asked.
    let remaining = crate::objects::error::with_reader(pooled_elevation_backfill_remaining);
    match remaining {
        Ok(Ok(n)) if n > 0 => {}
        Ok(Ok(_)) => return FfiStartOutcome::NotOwed,
        _ => {
            log::warn!("[Elevation] backfill deferred: queue unreadable");
            return FfiStartOutcome::NotReady;
        }
    }
    if detection_switched_off() {
        log::info!("[Elevation] backfill deferred: Route Matching off");
        return FfiStartOutcome::NotConfigured;
    }
    // The slot is claimed here, not on the thread, so a `Started` below means a
    // pass holds it: a second start in the same instant is refused rather
    // than spawning alongside, and anything waiting on the slot sees it
    // taken. A decline further down drops the guard and frees it again.
    let Some(slot) = RunGuard::claim() else {
        log::warn!("[Elevation] backfill deferred: a pass already holds the slot");
        return FfiStartOutcome::Busy;
    };
    if elevation_backfill_paused() {
        log::warn!("[Elevation] backfill deferred: paused");
        // A pause that arrived while this start held the slot saw a run in
        // flight and left the phase to it, so it is set here.
        set_phase(BACKFILL_PHASE_PAUSED);
        return FfiStartOutcome::Held;
    }
    // The state TypeScript pushes is advisory, so this only declines on a
    // fresh offline. Unset or stale falls through and the pass runs, which is
    // exactly what happened before there was a state to read.
    if crate::net::connectivity::is_offline() {
        log::warn!("[Elevation] backfill deferred: offline");
        return FfiStartOutcome::Offline;
    }
    let Some(Ok((transport, athlete_id))) = crate::objects::current_session() else {
        log::warn!("[Elevation] backfill deferred: no credential yet");
        return FfiStartOutcome::NotConfigured;
    };

    // Which library this pass belongs to, read here rather than on the
    // worker: a restore installing another database mid-splice would otherwise
    // take elevation computed from the old library's tracks.
    let install = engine_install();
    crate::threads::spawn_named("veloq-elev", move || {
        run_in_slot(slot, install, &transport, &athlete_id);
    });
    FfiStartOutcome::Started
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::sections::conditioning::detection_suspended;
    use crate::persistence::sections::detection_workers_started;
    use crate::test_globals::{
        clear_detection_handle, drain_backfill, drain_detection, init_global_engine, race,
        seeded_global_engine, serial_global_state,
    };
    use tempfile::TempDir;

    /// Scenario: the backfill's final re-cut is normally the only arm running,
    /// but nothing in the function itself enforces that. Several starting
    /// together must spawn exactly as many workers as claimed the slot: each
    /// worker opens its own connection and rewrites `route_groups` with the
    /// whole pool resident, so one that nobody holds a handle to is loose in
    /// the database with no way to stop or apply it.
    ///
    /// The re-cut drains the slot before it cuts, so the losers here go on to
    /// take their turn rather than refuse. That is the design. What must never
    /// happen is a spawn whose handle is thrown away.
    /// A restore lands while a pass is splicing. The batch finishes and writes
    /// elevation computed from the old library's tracks into the restored
    /// database, which is the item's failing case with this worker in it.
    #[test]
    fn a_splice_from_the_library_before_a_restore_writes_nothing() {
        let _serial = serial_global_state();
        let _first = init_global_engine("elevation_splice_first.db");
        let started_against = engine_install();

        let _second = init_global_engine("elevation_splice_second.db");
        assert_ne!(engine_install(), started_against);

        let (spliced, moved) = splice_batch(
            started_against,
            &[(
                "a1".to_string(),
                vec![100.0, 101.0],
                ElevationSeries::Corrected,
            )],
        );

        assert_eq!(spliced, 0, "the splice is lost, not applied");
        assert!(moved.is_empty(), "nothing is reported as moved either");
    }

    /// The stamp must not refuse the pass it belongs to.
    #[test]
    fn a_splice_into_the_library_it_started_against_still_runs() {
        let _serial = serial_global_state();
        let _dir = seeded_global_engine();

        let (spliced, moved) = splice_batch(
            engine_install(),
            &[(
                "a0".to_string(),
                vec![100.0, 101.0],
                ElevationSeries::Corrected,
            )],
        );

        assert_eq!(
            spliced + moved.len() as u32,
            1,
            "the batch reached the engine and answered for its one track"
        );
    }

    /// A retirement is a write too, and it counts asks against tracks that
    /// belong to the library the pass started against.
    #[test]
    fn a_retirement_from_the_library_before_a_restore_writes_nothing() {
        let _serial = serial_global_state();
        let _first = init_global_engine("elevation_retire_first.db");
        let started_against = engine_install();

        let _second = init_global_engine("elevation_retire_second.db");

        assert_eq!(retire_batch(started_against, &["a1".to_string()]), 0);
    }

    #[test]
    fn a_final_detect_never_spawns_a_worker_it_drops() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(|| start_final_detect(engine_install()));

        assert!(won > 0, "at least one final re-cut has to start");
        assert_eq!(
            detection_workers_started() - before,
            won as u64,
            "every worker spawned must belong to a run that claimed the slot"
        );

        drain_detection();
    }

    /// Expected behaviour: a re-cut that finds the slot still held drains it
    /// first, so the cold cut it needs is the one that lands.
    #[test]
    fn a_final_detect_drains_a_run_it_finds_in_the_slot() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();

        let earlier = with_persistent_engine(|engine| {
            engine.detect_sections_background_applying(
                crate::persistence::sections::detection::ApplyOn::Worker,
            )
        })
        .expect("the earlier run starts");
        let slot = earlier.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(earlier);
        slot.mark_installed(engine_install());

        let before = detection_workers_started();
        assert!(
            start_final_detect(engine_install()),
            "the re-cut starts after the drain"
        );
        assert_eq!(
            detection_workers_started() - before,
            1,
            "the re-cut spawns its own worker and nothing else"
        );

        drain_detection();
    }

    #[test]
    fn a_final_recut_clears_the_previous_runs_outcome() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let manager = crate::objects::DetectionManager::new();
        assert!(manager.start().expect("first run").started());
        drain_detection();
        assert_eq!(manager.last_outcome(), "complete");

        with_persistent_engine(|engine| {
            for i in 0..30 {
                let points = (0..32)
                    .map(|j| {
                        GpsPoint::new(46.0 + f64::from(j) * 0.0001, 7.0 + f64::from(i) * 0.001)
                    })
                    .collect();
                engine
                    .add_activity(format!("next_{i}"), points, "Ride".into())
                    .expect("activity");
            }
        })
        .expect("engine");
        assert!(start_final_detect(engine_install()));
        assert_eq!(
            manager.last_outcome(),
            "idle",
            "the previous verdict cannot describe the re-cut"
        );
        drain_detection();
    }

    #[test]
    fn an_unclaimed_recut_keeps_another_starts_detect_claim() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = engine_install();

        let handle = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let slot = handle.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        slot.mark_installed(install);
        assert!(!slot.detect_claimed(), "the re-cut does not claim the key");
        assert!(crate::objects::detection::claim_detect_for(install).is_ok());
        slot.mark_worker_finished();

        assert!(
            crate::objects::detection::claim_detect_for(install).is_err(),
            "the re-cut did not own the other start's detect key"
        );
        crate::objects::detection::settle_detect_for(
            install,
            crate::persistence::attempts::Release::Done,
        );
    }

    #[test]
    fn a_busy_refusal_during_an_unclaimed_recut_keeps_the_failure_ladder() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let install = engine_install();
        assert!(crate::objects::detection::claim_detect_for(install).is_ok());
        crate::objects::detection::settle_detect_for(
            install,
            crate::persistence::attempts::Release::failed(
                FfiStartOutcome::Failed,
                Some("earlier failure"),
            ),
        );
        let earlier = crate::persistence::attempts::now_ms() - 86_400_000;
        with_persistent_engine_for(install, |engine| {
            engine.db.execute(
                "UPDATE job_attempts SET last_attempt_at = ? WHERE key = ?",
                rusqlite::params![earlier, crate::objects::detection::detect_key().as_str(),],
            )
        })
        .expect("engine")
        .expect("age failure");

        let handle = crate::persistence::SectionDetectionHandle::finished_after_worker_apply();
        let slot = handle.checkpoint_slot();
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        slot.mark_installed(install);
        assert!(!slot.detect_claimed(), "the re-cut does not claim the key");
        assert!(!crate::persistence::sections::conditioning::try_start_conditioning());
        let (attempts, failed_at) = with_persistent_engine_for(install, |engine| {
            engine.db.query_row(
                "SELECT attempts, last_attempt_at FROM job_attempts WHERE key = ?",
                [crate::objects::detection::detect_key().as_str()],
                |row| Ok((row.get::<_, u32>(0)?, row.get::<_, i64>(1)?)),
            )
        })
        .expect("engine")
        .expect("attempt row");
        assert_eq!(attempts, 1, "the busy refusal retains the failure count");
        assert_eq!(
            failed_at, earlier,
            "the busy refusal does not restart backoff"
        );
        assert!(
            crate::objects::detection::claim_detect_for(install).is_ok(),
            "the earlier backoff already elapsed"
        );

        slot.mark_worker_finished();
        crate::objects::detection::settle_detect_for(
            install,
            crate::persistence::attempts::Release::Done,
        );
    }

    #[test]
    fn an_empty_queue_reads_as_finished_not_as_zero() {
        let snapshot = BackfillSnapshot {
            phase: BACKFILL_PHASE_COMPLETE,
            completed: 0,
            total: 0,
            failed: 0,
        };
        assert_eq!(snapshot.percent(), 100);
    }

    #[test]
    fn percent_tracks_the_queue() {
        let at = |completed, total| {
            BackfillSnapshot {
                phase: BACKFILL_PHASE_FETCHING,
                completed,
                total,
                failed: 0,
            }
            .percent()
        };
        assert_eq!(at(0, 200), 0);
        assert_eq!(at(50, 200), 25);
        assert_eq!(at(200, 200), 100);
        assert_eq!(at(300, 200), 100, "a miscount cannot report over 100");
    }

    #[test]
    fn a_response_with_no_finite_altitude_is_unavailable() {
        let parsed = ParsedStreams {
            latlng: vec![[46.0, 7.0], [46.1, 7.1]],
            altitude: vec![f64::NAN, f64::NAN],
            ..ParsedStreams::default()
        };
        assert!(matches!(reduce(parsed), Fetched::NoAltitude));
    }

    #[test]
    fn a_response_with_no_altitude_series_is_unavailable() {
        let parsed = ParsedStreams {
            latlng: vec![[46.0, 7.0], [46.1, 7.1]],
            ..ParsedStreams::default()
        };
        assert!(matches!(reduce(parsed), Fetched::NoAltitude));
    }

    /// A gap keeps its own index rather than shifting the samples after it.
    #[test]
    fn a_gap_in_altitude_costs_only_its_own_sample() {
        let parsed = ParsedStreams {
            latlng: vec![[46.0, 7.0], [46.1, 7.1], [46.2, 7.2]],
            altitude: vec![500.0, f64::NAN, 520.0],
            ..ParsedStreams::default()
        };
        let Fetched::Elevated(points, _) = reduce(parsed) else {
            panic!("a finite sample makes the track elevated");
        };
        assert_eq!(points.len(), 3);
        assert_eq!(points[0].elevation, Some(500.0));
        assert_eq!(points[1].elevation, None);
        assert_eq!(points[2].elevation, Some(520.0));
        assert_eq!(points[2].latitude, 46.2);
    }

    #[test]
    fn a_track_too_short_to_store_is_unavailable_rather_than_retried() {
        let parsed = ParsedStreams {
            latlng: vec![[46.0, 7.0]],
            altitude: vec![500.0],
            ..ParsedStreams::default()
        };
        assert!(matches!(reduce(parsed), Fetched::NoAltitude));
    }

    /// Scenario: the remaining count is read as the one definitive answer.
    /// `elevationBackfillTrigger` stamps the app version on a zero and never
    /// asks again for that release, and `start_cutover` reads a zero as
    /// permission to cut a library over.
    ///
    /// Expected behaviour: an engine that is not there cannot answer, so the
    /// export raises rather than reporting a finished library.
    #[test]
    fn an_engineless_remaining_call_raises_rather_than_reading_zero() {
        let _serial = serial_global_state();
        // The pool goes with the engine, or a pool an earlier test bound
        // answers the count and the export never reaches the missing engine.
        crate::persistence::clear_persistent_engine();

        assert!(matches!(
            crate::ffi::get_elevation_backfill_remaining(),
            Err(crate::VeloqError::NotInitialized)
        ));
    }

    /// Scenario: a launch sync holds the write lock for a page while the
    /// launch trigger asks for a pass.
    ///
    /// Expected behaviour: the count a start opens with reads through the
    /// pool, so an empty queue answers `NotOwed` without waiting for the
    /// writer.
    #[test]
    fn a_start_counts_its_queue_without_waiting_for_a_writer() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("elevation_start_under_writer.db");

        let outcome = crate::test_globals::read_while_writer_holds(start_pass);
        assert_eq!(outcome, FfiStartOutcome::NotOwed);
    }

    /// With no engine and no pool there is no queue to read, which is not an
    /// empty one: the start declines as not ready rather than as finished.
    #[test]
    fn an_engineless_start_is_not_ready() {
        let _serial = serial_global_state();
        crate::persistence::clear_persistent_engine();
        assert_eq!(start_pass(), FfiStartOutcome::NotReady);
    }

    /// A busy or locked database is exactly what launch looks like, since a
    /// sync may hold the write lock, so the query failing has to be
    /// distinguishable from a drained queue.
    #[test]
    fn a_failing_queue_query_is_an_error_rather_than_zero() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("broken.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");
        engine
            .db
            .execute("DROP TABLE activities", [])
            .expect("the join's table goes away");

        assert!(engine.elevation_backfill_remaining().is_err());
    }

    /// The same failure seen through the export, which is what the delegate's
    /// catch turns into the null both triggers already handle.
    #[test]
    fn a_failing_queue_query_raises_through_the_export() {
        let _serial = serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("broken.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");
        engine
            .db
            .execute("DROP TABLE activities", [])
            .expect("the join's table goes away");
        *crate::persistence::PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(engine);
        crate::persistence::read_pool::bind(path.to_str().unwrap());

        let answer = crate::ffi::get_elevation_backfill_remaining();

        crate::persistence::read_pool::close();
        *crate::persistence::PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        assert!(matches!(answer, Err(crate::VeloqError::Database { .. })));
    }

    /// The count is asked twice per launch, by both triggers, so it must not
    /// pay for the queue's order. A plan that sorts is a plan that materialised
    /// every row to do it.
    #[test]
    fn counting_the_queue_neither_sorts_nor_scans_activities_twice() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("plan.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");

        let plan = query_plan(&engine, ELEVATION_REMAINING_SQL);

        assert!(
            !plan.contains("TEMP B-TREE"),
            "counting must not sort, the plan was: {plan}"
        );
    }

    /// The queue's own read still sorts, and should: the order is what makes a
    /// scrolling athlete's newest activities convert first.
    #[test]
    fn reading_the_queue_still_takes_its_order() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("plan.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");

        let plan = query_plan(&engine, ELEVATION_QUEUE_SQL);

        assert!(plan.contains("TEMP B-TREE"), "the plan was: {plan}");
    }

    /// The count and the queue answer the same question, so they have to agree.
    /// The join cannot make them disagree: `gps_tracks.activity_id` is a
    /// foreign key onto `activities`, enforced, so a stored track with no
    /// activity row does not exist to be dropped. That is why the count keeps
    /// the join rather than reading `gps_tracks` alone: it costs a primary-key
    /// lookup per row and holds the contract that a missing `activities` table
    /// is an error rather than a zero.
    #[test]
    fn the_count_agrees_with_the_queue() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("agree.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");
        seed_track(
            &engine,
            "one",
            true,
            crate::persistence::ELEVATION_STATE_UNKNOWN,
        );
        seed_track(
            &engine,
            "two",
            true,
            crate::persistence::ELEVATION_STATE_UNKNOWN,
        );

        let queue = engine.tracks_missing_elevation().expect("queue reads");

        assert_eq!(queue.len(), 2);
        assert_eq!(engine.elevation_backfill_remaining().ok(), Some(2));
    }

    #[test]
    fn a_track_cannot_outlive_its_activity_row() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("orphan.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");

        let orphan = engine.db.execute(
            "INSERT INTO gps_tracks (activity_id, track_data, point_count, elevation_state)
             VALUES ('orphan', X'00', 0, 0)",
            [],
        );

        assert!(orphan.is_err(), "the foreign key is enforced");
    }

    /// Only `UNKNOWN` is in the queue. A state upstream has already answered
    /// for must not be counted, or no pass over such a library could end.
    #[test]
    fn the_count_holds_only_the_tracks_still_to_ask_about() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("states.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");
        seed_track(
            &engine,
            "unknown",
            true,
            crate::persistence::ELEVATION_STATE_UNKNOWN,
        );
        seed_track(
            &engine,
            "unavailable",
            true,
            crate::persistence::ELEVATION_STATE_UNAVAILABLE,
        );

        assert_eq!(engine.elevation_backfill_remaining().ok(), Some(1));
        assert_eq!(
            engine
                .tracks_missing_elevation()
                .expect("queue reads")
                .len(),
            1
        );
    }

    /// `EXPLAIN QUERY PLAN` for a statement, joined into one line.
    fn query_plan(engine: &PersistentEngine, sql: &str) -> String {
        let mut stmt = engine
            .db
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .expect("the statement prepares");
        let rows = stmt
            .query_map(
                params![i64::from(crate::persistence::ELEVATION_STATE_UNKNOWN)],
                |row| row.get::<_, String>(3),
            )
            .expect("the plan reads")
            .collect::<SqlResult<Vec<String>>>()
            .expect("every plan row reads");
        rows.join(" | ")
    }

    /// One stored track, with or without the activity row the queue joins to.
    fn seed_track(engine: &PersistentEngine, id: &str, with_activity: bool, state: u8) {
        if with_activity {
            engine
                .db
                .execute(
                    "INSERT INTO activities
                        (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES (?1, 'Ride', 0, 0, 0, 0, 1)",
                    params![id],
                )
                .expect("activity row inserts");
        }
        engine
            .db
            .execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count, elevation_state)
                 VALUES (?1, X'00', 0, ?2)",
                params![id, i64::from(state)],
            )
            .expect("track row inserts");
    }

    /// A drained queue still has to read as drained, or the backfill would
    /// retry for ever and the cutover would never fire.
    #[test]
    fn a_drained_queue_still_reads_as_zero() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("empty.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");

        assert_eq!(engine.elevation_backfill_remaining().ok(), Some(0));
    }

    /// Scenario: a ride recorded on the device is stored under a local key
    /// that upstream cannot name until the upload gives it an id.
    ///
    /// Expected behaviour: before the upload it is not in the queue or the
    /// count and spends no attempts. After the upload it is asked for under
    /// the upstream id, never under the local key.
    mod local_keys {
        use super::*;
        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use crate::persistence::with_persistent_engine;
        use httpmock::prelude::*;
        use std::sync::Arc;
        use tracematch::GpsPoint;

        fn transport(server: &MockServer) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov).unwrap()
        }

        fn engine_with_recorded_ride() -> TempDir {
            let tmp = init_global_engine("elevation_local_keys.db");
            crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
                .expect("test credential");
            with_persistent_engine(|engine| {
                for (id, seed) in [("i1", 0.0), ("local-ab12", 0.05)] {
                    let track = (0..8)
                        .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
                        .collect();
                    engine
                        .add_activity(id.to_string(), track, "Ride".into())
                        .expect("add activity");
                }
            })
            .expect("engine");
            tmp
        }

        fn queued() -> Vec<String> {
            let mut ids: Vec<String> = with_persistent_engine(|e| e.tracks_missing_elevation())
                .expect("engine")
                .expect("queue")
                .into_iter()
                .map(|(id, _)| id)
                .collect();
            ids.sort();
            ids
        }

        fn remaining() -> u64 {
            with_persistent_engine(|e| e.elevation_backfill_remaining())
                .expect("engine")
                .expect("count")
        }

        fn attempts(id: &str) -> i64 {
            with_persistent_engine(|e| {
                e.db.query_row(
                    "SELECT elevation_attempts FROM gps_tracks WHERE activity_id = ?1",
                    params![id],
                    |row| row.get(0),
                )
            })
            .expect("engine")
            .expect("attempts")
        }

        #[test]
        fn a_ride_no_upload_has_named_is_not_queued_asked_or_counted() {
            let _serial = serial_global_state();
            let _tmp = engine_with_recorded_ride();
            let server = MockServer::start();
            let by_local_key = server.mock(|when, then| {
                when.method(GET).path("/activity/local-ab12/streams.json");
                then.status(404);
            });
            let synced = server.mock(|when, then| {
                when.method(GET).path("/activity/i1/streams.json");
                then.status(404);
            });

            assert_eq!(queued(), vec!["i1".to_string()]);
            assert_eq!(remaining(), 1);

            for _ in 0..ELEVATION_ATTEMPT_LIMIT + 1 {
                run_elevation_backfill(&transport(&server), "1");
            }

            by_local_key.assert_hits(0);
            assert!(synced.hits() > 0, "the synced track is still asked");
            assert_eq!(attempts("local-ab12"), 0);
        }

        #[test]
        fn an_uploaded_ride_is_asked_for_under_its_upstream_id() {
            let _serial = serial_global_state();
            let _tmp = engine_with_recorded_ride();
            with_persistent_engine(|e| e.record_upload("local-ab12", "i123"))
                .expect("engine")
                .expect("upload recorded");
            let server = MockServer::start();
            let by_local_key = server.mock(|when, then| {
                when.method(GET).path("/activity/local-ab12/streams.json");
                then.status(404);
            });
            let upstream = server.mock(|when, then| {
                when.method(GET).path("/activity/i123/streams.json");
                then.status(200).body("[]");
            });
            server.mock(|when, then| {
                when.method(GET).path("/activity/i1/streams.json");
                then.status(200).body("[]");
            });

            assert_eq!(queued(), vec!["i1".to_string(), "local-ab12".to_string()]);
            run_elevation_backfill(&transport(&server), "1");

            by_local_key.assert_hits(0);
            assert!(upstream.hits() > 0, "asked under the upstream id");
        }
    }

    /// Scenario: a pass elevates two tracks and finds one with no usable
    /// altitude upstream.
    ///
    /// Expected behaviour: the last run is recorded once, complete, with all
    /// three handled, two changed and one retired, and a refused start
    /// records nothing.
    mod last_run {
        use super::*;
        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use crate::persistence::with_persistent_engine;
        use httpmock::prelude::*;
        use std::sync::Arc;
        use tracematch::GpsPoint;

        fn transport(server: &MockServer) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov).unwrap()
        }

        fn engine_with(ids: &[&str]) -> TempDir {
            let tmp = init_global_engine("elevation_last_run.db");
            crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
                .expect("test credential");
            with_persistent_engine(|engine| {
                for (n, id) in ids.iter().enumerate() {
                    let seed = n as f64 * 0.05;
                    let track = (0..8)
                        .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
                        .collect();
                    engine
                        .add_activity(id.to_string(), track, "Ride".into())
                        .expect("add activity");
                }
            })
            .expect("engine");
            tmp
        }

        fn runs() -> Vec<crate::FfiJobRun> {
            with_persistent_engine(|e| crate::persistence::job_runs::job_runs(&e.db))
                .expect("engine")
                .expect("runs read")
        }

        fn serves(server: &MockServer, id: &str, altitude: serde_json::Value) {
            let path = format!("/activity/{id}/streams.json");
            server.mock(|when, then| {
                when.method(GET).path(path);
                then.status(200)
                    .json_body(serde_json::json!([{"type": "altitude", "data": altitude}]));
            });
        }

        #[test]
        fn a_pass_records_its_last_run() {
            let _serial = serial_global_state();
            let _tmp = engine_with(&["i1", "i2", "i3"]);
            let server = MockServer::start();
            let rising: Vec<f64> = (0..8).map(|i| 400.0 + i as f64 * 3.0).collect();
            serves(&server, "i1", serde_json::json!(rising));
            serves(&server, "i2", serde_json::json!(rising));
            serves(
                &server,
                "i3",
                serde_json::json!(vec![serde_json::Value::Null; 8]),
            );

            let held = RunGuard::claim().expect("the slot starts free");
            assert_eq!(
                run_elevation_backfill(&transport(&server), "1"),
                BackfillRun::Refused
            );
            drop(held);
            assert!(runs().is_empty(), "a refused start ran nothing");

            run_elevation_backfill(&transport(&server), "1");

            let runs = runs();
            let run = runs
                .iter()
                .find(|run| run.job == "elevationBackfill")
                .expect("the pass recorded its run");
            assert_eq!(run.outcome, "complete");
            assert_eq!(
                (run.handled, run.added, run.changed, run.retired, run.failed),
                (3, 0, 2, 1, 0)
            );
            assert!(run.finished_at > 0.0);
        }
    }

    /// Scenario: demo mode seeds its tracks on the device, coordinates only,
    /// under `demo-` keys no upstream has ever held, and demo mode carries no
    /// credential to ask with.
    ///
    /// Expected behaviour: those tracks are not owed. Counted, they would hold
    /// detection on "waiting" and hold the cutover for ever, since nothing
    /// could ever answer for them.
    mod demo_keys {
        use super::*;
        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use crate::persistence::with_persistent_engine;
        use httpmock::prelude::*;
        use std::sync::Arc;
        use tracematch::GpsPoint;

        fn engine_with(ids: &[&str]) -> TempDir {
            let tmp = init_global_engine("elevation_demo_keys.db");
            with_persistent_engine(|engine| {
                for (n, id) in ids.iter().enumerate() {
                    let seed = n as f64 * 0.05;
                    let track = (0..8)
                        .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
                        .collect();
                    engine
                        .add_activity(id.to_string(), track, "Ride".into())
                        .expect("add activity");
                }
            })
            .expect("engine");
            tmp
        }

        fn queued() -> Vec<String> {
            let mut ids: Vec<String> = with_persistent_engine(|e| e.tracks_missing_elevation())
                .expect("engine")
                .expect("queue")
                .into_iter()
                .map(|(id, _)| id)
                .collect();
            ids.sort();
            ids
        }

        fn remaining() -> u64 {
            with_persistent_engine(|e| e.elevation_backfill_remaining())
                .expect("engine")
                .expect("count")
        }

        #[test]
        fn a_demo_library_owes_no_elevation_and_holds_nothing() {
            let _serial = serial_global_state();
            let _tmp = engine_with(&["demo-test-0", "demo-2026-08-08-301"]);

            assert!(queued().is_empty(), "no demo track is queued");
            assert_eq!(remaining(), 0, "no demo track is counted as owed");
            assert_eq!(
                start_pass(),
                FfiStartOutcome::NotOwed,
                "a demo library is finished, not waiting on a credential"
            );
        }

        #[test]
        fn a_demo_track_is_never_asked_for_beside_a_synced_one() {
            let _serial = serial_global_state();
            let _tmp = engine_with(&["i1", "demo-test-0"]);
            crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
                .expect("test credential");
            let server = MockServer::start();
            let demo = server.mock(|when, then| {
                when.method(GET).path("/activity/demo-test-0/streams.json");
                then.status(404);
            });
            let synced = server.mock(|when, then| {
                when.method(GET).path("/activity/i1/streams.json");
                then.status(404);
            });

            assert_eq!(queued(), vec!["i1".to_string()]);
            assert_eq!(remaining(), 1);

            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            let transport =
                Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov)
                    .unwrap();
            run_elevation_backfill(&transport, "1");

            demo.assert_hits(0);
            assert!(synced.hits() > 0, "the synced track is still asked");
        }
    }

    /// Scenario: the network lifecycle is Rust's, so a pass has to react to
    /// the connectivity TypeScript pushes rather than spending its
    /// whole queue discovering the network is gone one request at a time.
    ///
    /// Expected behaviour: the state is advisory. Never pushed means try, a
    /// pushed offline stops the walk where it stands, and a flip back to
    /// online lets the next walk run.
    mod offline {
        use super::*;
        use crate::net::connectivity;
        use std::time::Instant;

        fn queue(n: usize) -> Vec<(String, String)> {
            (0..n)
                .map(|i| (format!("a{}", i), "Ride".to_string()))
                .collect()
        }

        /// One flat point per id, which stores as unavailable rather than
        /// elevated. Whether it lands is not what these tests measure; what
        /// they measure is how many ids the walk asked about.
        fn answer(ids: &[String]) -> Vec<(String, Fetched)> {
            ids.iter()
                .map(|id| (id.clone(), Fetched::NoAltitude))
                .collect()
        }

        #[test]
        fn a_never_pushed_state_walks_the_whole_queue() {
            let _serial = serial_global_state();
            connectivity::reset();

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(3 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, 3 * BATCH, "an unset state must not refuse work");
            assert!(walk.stopped.is_none());
            assert!(walk.unasked.is_empty());
        }

        #[test]
        fn a_pass_that_starts_offline_asks_nothing() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online(false);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(2 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, 0, "nothing should be dispatched while offline");
            assert!(matches!(walk.stopped, Some(Stopped::Offline)));
            assert_eq!(
                walk.unasked.len(),
                2 * BATCH,
                "the whole queue is still owed"
            );

            connectivity::reset();
        }

        /// Scenario: the credential is revoked between a batch's elevation
        /// ask and its whole-track ask.
        ///
        /// Expected behaviour: the walk stops unauthorized, the batch's tracks
        /// are still owed, and no track is counted against its attempt limit.
        #[test]
        fn a_401_on_the_whole_track_ask_stops_the_walk_without_counting_it() {
            let _serial = serial_global_state();
            connectivity::reset();

            let full = queue(BATCH);
            let walk = drain_queue_with(engine_install(), &full, true, |ids, ask| {
                ids.iter()
                    .map(|id| match ask {
                        Ask::Elevation => (id.clone(), Fetched::Empty),
                        _ => (id.clone(), Fetched::Failed(NetError::Unauthorized)),
                    })
                    .collect()
            });

            assert!(matches!(walk.stopped, Some(Stopped::Unauthorized)));
            assert_eq!(walk.unasked.len(), BATCH, "the batch is still owed");
            assert_eq!(walk.outcome.retired, 0);
        }

        /// Scenario: a restore installs another library while a walk is part
        /// way through its queue.
        ///
        /// Expected behaviour: the walk ends at the next batch boundary without
        /// fetching for the old library, and its stop is not a terminal cut.
        #[test]
        fn a_restore_mid_walk_ends_it_before_the_next_batch() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _first = init_global_engine("elevation_walk_first.db");
            let started_against = engine_install();
            let _second_dir = std::cell::RefCell::new(None);

            let mut asked = 0usize;
            let walk = drain_queue_with(started_against, &queue(3 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                _second_dir.replace(Some(init_global_engine("elevation_walk_second.db")));
                answer(ids)
            });

            assert_ne!(engine_install(), started_against);
            assert_eq!(asked, BATCH, "no batch is fetched after the install moved");
            assert!(matches!(walk.stopped, Some(Stopped::Superseded)));
            assert_eq!(walk.unasked.len(), 2 * BATCH);
        }

        #[test]
        fn losing_the_network_stops_the_walk_where_it_stands() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online(true);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(4 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                connectivity::set_online(false);
                answer(ids)
            });

            assert_eq!(
                asked, BATCH,
                "the walk must stop after the batch that lost the network, not finish the queue"
            );
            assert!(matches!(walk.stopped, Some(Stopped::Offline)));
            assert_eq!(walk.unasked.len(), 3 * BATCH);

            connectivity::reset();
        }

        #[test]
        fn a_flip_back_to_online_leaves_the_walk_running() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online(false);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(3 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });
            assert_eq!(asked, 0);

            connectivity::set_online(true);
            let mut asked_again = 0usize;
            let second = drain_queue_with(engine_install(), &walk.unasked, true, |ids, _ask| {
                asked_again += ids.len();
                connectivity::set_online(true);
                answer(ids)
            });

            assert_eq!(
                asked_again,
                3 * BATCH,
                "a state that came back online must not leave the pass stopped"
            );
            assert!(second.stopped.is_none());

            connectivity::reset();
        }

        /// Scenario: a block of tracks upstream answers 5xx for, every time,
        /// sits at the head of a queue that is re-derived in the same order
        /// on every pass.
        ///
        /// Expected behaviour: the pass after the one that gave up begins
        /// past that block, so the rest of the library is asked about. The
        /// derived order is total and stable, so without this every pass
        /// stops on the same twenty tracks and nothing behind them is ever
        /// fetched, which holds `elevation_backfill_remaining` above zero for
        /// the life of the install and vetoes the detector cutover with it.
        #[test]
        fn a_refusing_head_does_not_hide_the_rest_of_the_queue() {
            let _serial = serial_global_state();
            connectivity::reset();

            let full = queue(3 * BATCH);
            let blocked: std::collections::HashSet<String> =
                full[..BATCH].iter().map(|(id, _)| id.clone()).collect();
            let reply = |ids: &[String]| -> Vec<(String, Fetched)> {
                ids.iter()
                    .map(|id| {
                        let answer = if blocked.contains(id) {
                            Fetched::Failed(NetError::Http {
                                status: 503,
                                body: String::new(),
                            })
                        } else {
                            Fetched::NoAltitude
                        };
                        (id.clone(), answer)
                    })
                    .collect()
            };

            let first =
                drain_queue_with(engine_install(), &rotated(&full, 0), true, |ids, _ask| {
                    reply(ids)
                });
            assert!(
                matches!(first.stopped, Some(Stopped::NothingToWorkWith)),
                "a whole batch with nothing to work with must end the walk"
            );

            let next = next_pass_start(0, true, full.len());
            let mut asked: Vec<String> = Vec::new();
            drain_queue_with(
                engine_install(),
                &rotated(&full, next),
                true,
                |ids, _ask| {
                    asked.extend_from_slice(ids);
                    reply(ids)
                },
            );

            assert!(
                asked.iter().any(|id| !blocked.contains(id)),
                "the pass after a give-up must reach the tracks behind the block"
            );
        }

        /// Scenario: the failure threshold is crossed in a final batch shorter
        /// than `BATCH`, because the count carries across batches.
        ///
        /// Expected behaviour: the walk stops with nothing to work with and
        /// nothing left unasked, rather than slicing past the queue.
        #[test]
        fn a_give_up_in_a_short_final_batch_leaves_nothing_unasked() {
            let _serial = serial_global_state();
            connectivity::reset();

            let full = queue(BATCH + 7);
            let mut call = 0usize;
            let walk = drain_queue_with(engine_install(), &full, true, |ids, _ask| {
                call += 1;
                ids.iter()
                    .enumerate()
                    .map(|(i, id)| {
                        let answer = if call == 1 && i < 5 {
                            Fetched::NoAltitude
                        } else {
                            Fetched::Failed(NetError::Http {
                                status: 503,
                                body: String::new(),
                            })
                        };
                        (id.clone(), answer)
                    })
                    .collect()
            });

            assert!(matches!(walk.stopped, Some(Stopped::NothingToWorkWith)));
            assert!(walk.unasked.is_empty());
        }

        /// Only a give-up moves the start. An outage and a pause say nothing
        /// about these tracks, so the next pass asks newest first again.
        #[test]
        fn only_a_give_up_moves_where_the_next_pass_starts() {
            assert_eq!(next_pass_start(0, false, 3 * BATCH), 0);
            assert_eq!(next_pass_start(2 * BATCH, false, 3 * BATCH), 0);
            assert_eq!(next_pass_start(0, true, 3 * BATCH), BATCH);
            assert_eq!(next_pass_start(BATCH, true, 3 * BATCH), 2 * BATCH);
        }

        /// A start that walks off the end wraps rather than asking nothing,
        /// and an empty queue has nowhere to start.
        #[test]
        fn the_start_wraps_and_an_empty_queue_stays_at_zero() {
            assert_eq!(next_pass_start(2 * BATCH, true, 3 * BATCH), 0);
            assert_eq!(next_pass_start(0, true, 0), 0);
            assert_eq!(
                next_pass_start(0, true, BATCH / 2),
                MAX_CONSECUTIVE_FAILURES % (BATCH / 2)
            );
        }

        /// A rotation changes the order and nothing else: every track is
        /// still walked exactly once.
        #[test]
        fn a_rotation_keeps_every_track_exactly_once() {
            let full = queue(3 * BATCH);
            for start in [0, 1, BATCH, 3 * BATCH - 1, 3 * BATCH, 7 * BATCH] {
                let walked = rotated(&full, start);
                assert_eq!(walked.len(), full.len(), "start {}", start);
                let mut sorted = walked.clone();
                sorted.sort();
                let mut expected = full.clone();
                expected.sort();
                assert_eq!(sorted, expected, "start {}", start);
                assert_eq!(walked[0], full[start % full.len()], "start {}", start);
            }
            assert!(rotated(&[], 3).is_empty());
        }

        /// An offline nobody refreshed is a missed push, not a fact. Rust
        /// refusing work on a live connection is worse than never knowing, so
        /// the state expires and the walk goes back to trying.
        #[test]
        fn a_stale_offline_reads_as_try_rather_than_do_not() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online_at(false, Instant::now() - connectivity::STALE_AFTER);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(2 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, 2 * BATCH, "a state this old must not refuse work");
            assert!(walk.stopped.is_none());

            connectivity::reset();
        }

        /// The window is the backgrounded-only fallback, so it has to outlive
        /// the ladder that runs while backgrounded. A push aged by the resting
        /// rung is the ordinary case for a device left offline, and it must
        /// still refuse: an expiry that lands first spends every resting pass
        /// asking a network the device already said was gone.
        #[test]
        fn an_offline_still_refuses_at_the_ladders_resting_rung() {
            let _serial = serial_global_state();
            connectivity::reset();
            let resting = *RESUME_WAITS.last().expect("the ladder has rungs");
            connectivity::set_online_at(false, Instant::now() - resting);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(2 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, 0, "a push younger than the resting rung is a fact");
            assert!(walk.stopped.is_some());

            connectivity::reset();
        }

        /// The walk-level read is the one that saves the queue, but a start
        /// that already knows there is no network should not spawn a thread
        /// to find out. Credentials are set here because the start declines
        /// without one anyway, which would hide what is being measured.
        #[test]
        fn a_start_declines_while_offline_and_goes_ahead_once_it_is_back() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            let _creds = crate::objects::test_credentials();

            connectivity::set_online(false);
            assert!(
                !start_elevation_backfill().started(),
                "a fresh offline must not spawn a pass"
            );
            assert!(
                !BACKFILL.running.load(Ordering::SeqCst),
                "and must not leave the run flag claimed"
            );

            connectivity::reset();
            assert!(
                start_elevation_backfill().started(),
                "a never-pushed state has to behave exactly as it did before"
            );

            connectivity::reset();
            drain_backfill();
            drain_detection();
            // The pass runs detached and holds detection suspended for its
            // whole life. Returning while it still runs leaks that suspension
            // into whichever test takes the crate lock next, and every start
            // there is refused.
            assert!(
                !BACKFILL.running.load(Ordering::SeqCst),
                "the pass must be finished before the test releases the crate lock"
            );
            assert!(
                !detection_suspended(),
                "the pass's suspension must not outlive the test"
            );
        }

        /// A true from the start has to mean the slot is held, not that a
        /// thread will claim it shortly. Otherwise a second start in that
        /// window spawns a second pass, and a test that waits on the slot
        /// sees it free and returns while the pass is still to come.
        #[test]
        fn a_start_that_went_ahead_holds_the_slot_before_it_returns() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            let _creds = crate::objects::test_credentials();

            assert!(start_elevation_backfill().started());
            assert!(
                BACKFILL.running.load(Ordering::SeqCst),
                "the run flag must be claimed by the time the start reports true"
            );
            assert!(
                !start_elevation_backfill().started(),
                "a second start while the first is in flight must be refused"
            );

            drain_backfill();
            drain_detection();
            assert!(!BACKFILL.running.load(Ordering::SeqCst));
            assert!(!detection_suspended());
        }

        /// Scenario: the engine opens, or a credential arrives, and nothing
        /// outside Rust asks for the backfill.
        /// Expected behaviour: an owed queue with a credential starts a pass, an
        /// empty one starts none, and the Route Matching switch off refuses.
        #[test]
        fn the_engine_starts_an_owed_backfill_itself() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            let _creds = crate::objects::test_credentials();

            assert_eq!(start_owed_work(), FfiStartOutcome::Started);
            assert!(BACKFILL.running.load(Ordering::SeqCst));

            drain_backfill();
            drain_detection();
            assert!(!detection_suspended());
        }

        #[test]
        fn the_engine_starts_nothing_for_an_empty_queue() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = init_global_engine("no_elevation_owed_launch.db");
            connectivity::reset();
            let _creds = crate::objects::test_credentials();

            assert_eq!(start_owed_work(), FfiStartOutcome::NotOwed);
            assert!(!BACKFILL.running.load(Ordering::SeqCst));
        }

        #[test]
        fn the_engine_starts_nothing_with_route_matching_off() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            let _creds = crate::objects::test_credentials();
            with_persistent_engine(|e| e.set_detection_enabled(false))
                .expect("engine")
                .expect("switch");

            assert_eq!(start_owed_work(), FfiStartOutcome::NotConfigured);
            assert!(!BACKFILL.running.load(Ordering::SeqCst));
        }

        #[test]
        fn the_engine_starts_nothing_without_a_credential() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();

            assert_eq!(start_owed_work(), FfiStartOutcome::NotConfigured);
            assert!(!BACKFILL.running.load(Ordering::SeqCst));
        }

        /// Scenario: JavaScript hands the engine its credential after the
        /// library is open, which is the order of every launch.
        /// Expected behaviour: the credential itself starts the owed pass.
        #[test]
        fn handing_over_a_credential_starts_an_owed_backfill() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();

            crate::objects::sync::give_credentials("api_key", "secret".into(), "1".into())
                .expect("credential");
            assert!(BACKFILL.running.load(Ordering::SeqCst));

            drain_backfill();
            drain_detection();
            crate::objects::clear_test_credentials();
            assert!(!detection_suspended());
        }

        /// Scenario: the database is opened while a credential is already held,
        /// as a restore does.
        /// Expected behaviour: the open starts the owed pass.
        #[test]
        fn opening_a_library_starts_an_owed_backfill() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            let _creds = crate::objects::test_credentials();
            let path = _tmp.path().join("detection.db");
            crate::persistence::close_for_restore();
            assert!(!BACKFILL.running.load(Ordering::SeqCst));

            assert_eq!(
                crate::persistence::persistent_engine_ffi::open_if_closed(
                    path.to_string_lossy().into_owned(),
                    true
                ),
                Some(true)
            );
            assert!(BACKFILL.running.load(Ordering::SeqCst));

            drain_backfill();
            drain_detection();
            assert!(!detection_suspended());
        }

        /// Scenario: the launch trigger fires the backfill on every start and
        /// gets the same `false` for five different reasons.
        /// Expected behaviour: the start names the reason, so a caller can
        /// tell a connection that comes back from a sign-in that never will.
        #[test]
        fn a_refusal_names_its_reason() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();

            let no_credential = start_elevation_backfill();
            assert_eq!(no_credential, FfiStartOutcome::NotConfigured);
            assert!(
                !no_credential.is_retryable(),
                "waiting does not produce a sign-in"
            );

            let _creds = crate::objects::test_credentials();

            connectivity::set_online(false);
            let offline = start_elevation_backfill();
            assert_eq!(offline, FfiStartOutcome::Offline);
            assert!(offline.is_retryable(), "a connection comes back");
            connectivity::reset();

            pause_elevation_backfill();
            assert_eq!(start_elevation_backfill(), FfiStartOutcome::Held);
            reset_pause();

            assert_eq!(start_elevation_backfill(), FfiStartOutcome::Started);
            assert_eq!(
                start_elevation_backfill(),
                FfiStartOutcome::Busy,
                "a pass already holds the slot"
            );

            drain_backfill();
            drain_detection();
            assert!(!detection_suspended());
        }

        #[test]
        fn a_switched_off_library_starts_no_elevation_pass() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();
            let _creds = crate::objects::test_credentials();

            with_persistent_engine(|engine| engine.set_detection_enabled(false))
                .expect("engine")
                .expect("switch off");
            assert_eq!(start_pass(), FfiStartOutcome::NotConfigured);
            assert_eq!(start_elevation_backfill(), FfiStartOutcome::NotConfigured);
            assert!(!BACKFILL.running.load(Ordering::SeqCst));
        }

        #[test]
        fn switching_off_ends_the_resume_ladder() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            let mut sleeps = 0;
            let mut attempts = 0;
            resume_ladder(
                |_| {
                    sleeps += 1;
                    if sleeps == 2 {
                        with_persistent_engine(|engine| engine.set_detection_enabled(false))
                            .expect("engine")
                            .expect("switch off");
                    }
                    true
                },
                || Some(3),
                || false,
                detection_switched_off,
                || false,
                || attempts += 1,
            );
            assert_eq!(sleeps, 2);
            assert_eq!(attempts, 1);
        }

        #[test]
        fn switching_off_between_batches_leaves_the_rest_unasked() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();
            let queue: Vec<_> = (0..3 * BATCH)
                .map(|n| (format!("track-{n}"), "Ride".to_string()))
                .collect();
            let mut asked = 0;
            let walk = drain_queue_with(engine_install(), &queue, true, |ids, _| {
                asked += ids.len();
                with_persistent_engine(|engine| engine.set_detection_enabled(false))
                    .expect("engine")
                    .expect("switch off");
                ids.iter()
                    .map(|id| (id.clone(), Fetched::NoAltitude))
                    .collect()
            });

            assert_eq!(asked, BATCH);
            assert!(matches!(walk.stopped, Some(Stopped::SwitchedOff)));
            assert_eq!(walk.unasked.len(), 2 * BATCH);
        }

        /// The queue running out is the job finishing. It used to arrive as
        /// the same `false` as being offline, and it is what stamps the app
        /// version and stops the trigger asking on every later launch.
        #[test]
        fn an_empty_queue_is_a_success() {
            use crate::objects::FfiStartOutcome;

            let _serial = serial_global_state();
            let _tmp = init_global_engine("no_elevation_owed.db");
            connectivity::reset();
            reset_pause();
            let _creds = crate::objects::test_credentials();

            let outcome = start_elevation_backfill();
            assert_eq!(outcome, FfiStartOutcome::NotOwed);
            assert!(
                !outcome.is_retryable(),
                "there is nothing later asking could add"
            );
            assert!(
                !BACKFILL.running.load(Ordering::SeqCst),
                "refusing must not leave the slot claimed"
            );
        }

        /// A stale *online* is harmless: the value is only ever a reason to
        /// refuse, so expiry can only ever open the gate, never close it.
        #[test]
        fn a_stale_online_still_reads_as_try() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online_at(true, Instant::now() - connectivity::STALE_AFTER);

            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(BATCH), true, |ids, _ask| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, BATCH);
            assert!(walk.stopped.is_none());

            connectivity::reset();
        }
    }
    /// Scenario: a pass finished its walk with tracks the connection refused,
    /// and the ladder above the lane's own retries decides how often it asks
    /// again.
    ///
    /// Expected behaviour: the schedule is the ladder, longest last, and a
    /// wait that ends the re-asking ends it at that round. Neither is worth
    /// wall-clock time to assert, so the wait is handed in.
    mod re_asking {
        use super::*;

        fn owed(n: usize) -> Vec<(String, String)> {
            (0..n)
                .map(|i| (format!("a{}", i), "Ride".to_string()))
                .collect()
        }

        fn refused_walk(n: usize) -> Walk {
            Walk {
                outcome: BackfillOutcome::default(),
                stopped: None,
                refused: owed(n),
                unasked: Vec::new(),
            }
        }

        /// A round that refuses everything it was handed, so the ladder runs
        /// to its last rung.
        fn refuse_again(queue: &[(String, String)]) -> Walk {
            Walk {
                outcome: BackfillOutcome::default(),
                stopped: None,
                refused: queue.to_vec(),
                unasked: Vec::new(),
            }
        }

        #[test]
        fn the_re_asking_is_bounded_and_waits_longer_each_round() {
            let mut waited: Vec<Duration> = Vec::new();
            let mut asked = 0usize;

            let (outcome, stopped, still_owed) = re_ask_with(
                refused_walk(1),
                |delay| {
                    waited.push(delay);
                    true
                },
                |queue| {
                    asked += 1;
                    refuse_again(queue)
                },
            );

            assert_eq!(
                waited,
                backfill_retry_delays().to_vec(),
                "the rounds waited something other than the ladder"
            );
            assert!(
                waited.windows(2).all(|w| w[1] > w[0]),
                "each round has to wait longer than the one before it"
            );
            assert_eq!(
                asked, BACKFILL_RETRY_ROUNDS,
                "one ask per rung, and no more"
            );
            assert!(stopped.is_none());
            assert_eq!(outcome.elevated, 0);
            assert_eq!(
                still_owed.len(),
                1,
                "a track refused on every round is still owed"
            );
        }

        #[test]
        fn a_wait_that_ends_the_re_asking_stops_at_that_round() {
            let mut waited = 0usize;
            let mut asked = 0usize;

            let (_outcome, stopped, still_owed) = re_ask_with(
                refused_walk(2),
                |_delay| {
                    waited += 1;
                    waited < 2
                },
                |queue| {
                    asked += 1;
                    refuse_again(queue)
                },
            );

            assert_eq!(waited, 2, "the second rung is where the wait said stop");
            assert_eq!(
                asked, 1,
                "the round whose wait was cut short must not ask anyway"
            );
            assert!(
                stopped.is_none(),
                "a cancelled ladder is not a walk that stopped"
            );
            assert_eq!(still_owed.len(), 2, "both tracks are still owed");
        }

        #[test]
        fn nothing_refused_waits_for_nothing() {
            let mut waited = 0usize;
            let mut asked = 0usize;

            let (_outcome, stopped, still_owed) = re_ask_with(
                refused_walk(0),
                |_delay| {
                    waited += 1;
                    true
                },
                |queue| {
                    asked += 1;
                    refuse_again(queue)
                },
            );

            assert_eq!(waited, 0, "a pass that owes nothing must not back off");
            assert_eq!(asked, 0);
            assert!(stopped.is_none());
            assert!(still_owed.is_empty());
        }

        #[test]
        fn a_walk_that_already_stopped_is_not_re_asked() {
            let mut waited = 0usize;
            let walk = Walk {
                outcome: BackfillOutcome::default(),
                stopped: Some(Stopped::Offline),
                refused: owed(1),
                unasked: owed(2),
            };

            let (_outcome, stopped, still_owed) = re_ask_with(
                walk,
                |_delay| {
                    waited += 1;
                    true
                },
                refuse_again,
            );

            assert_eq!(waited, 0, "an offline pass must not spend the ladder");
            assert!(matches!(stopped, Some(Stopped::Offline)));
            assert_eq!(
                still_owed.len(),
                1,
                "a stopped walk hands back what it was refused, and its unasked \
                 tracks stay where the caller left them"
            );
        }

        #[test]
        fn a_round_that_stops_ends_the_ladder_where_it_stands() {
            let mut waited = 0usize;
            let mut asked = 0usize;

            let (_outcome, stopped, still_owed) = re_ask_with(
                refused_walk(3),
                |_delay| {
                    waited += 1;
                    true
                },
                |queue| {
                    asked += 1;
                    Walk {
                        outcome: BackfillOutcome::default(),
                        stopped: Some(Stopped::Offline),
                        refused: queue[..1].to_vec(),
                        unasked: queue[1..].to_vec(),
                    }
                },
            );

            assert_eq!(waited, 1);
            assert_eq!(
                asked, 1,
                "the ladder must not climb past a round that stopped"
            );
            assert!(matches!(stopped, Some(Stopped::Offline)));
            assert_eq!(
                still_owed.len(),
                3,
                "what a stopped round never asked about is still owed"
            );
        }
    }

    /// Scenario: a pass ended partial because the connection went away, and
    /// the ladder is sleeping on a long rung when the device comes back. The
    /// rung has to end there, not thirty minutes later, and the climb has to
    /// carry on from where it was so a flapping connection cannot pin the
    /// ladder to its first rung.
    mod online_edge {
        use super::*;
        use crate::net::connectivity;
        use std::sync::Arc;

        /// Drive the production sleep for `rungs` rungs while another thread
        /// fires offline-to-online edges until the climb ends. Every rung is a
        /// minute or more, so a rung the edge did not end outlasts the guard,
        /// which is half the shortest.
        fn climb_through_edges(
            rungs: usize,
            remaining: impl Fn() -> Option<u64> + Send + 'static,
        ) -> (Vec<Duration>, usize) {
            let done = Arc::new(AtomicBool::new(false));
            let stop = Arc::clone(&done);
            let waker = std::thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                    connectivity::set_online(false);
                    connectivity::set_online(true);
                }
            });
            let climbed = crate::test_globals::returns_within(
                RESUME_WAITS[0] / 2,
                "a ladder rung the edge did not end",
                move || {
                    let mut slept = Vec::new();
                    let mut attempts = 0usize;
                    resume_ladder(
                        |d| {
                            if slept.len() == rungs {
                                return false;
                            }
                            slept.push(d);
                            resume_sleep(d)
                        },
                        &remaining,
                        || false,
                        || false,
                        || false,
                        || {
                            attempts += 1;
                        },
                    );
                    (slept, attempts)
                },
            );
            done.store(true, Ordering::SeqCst);
            waker.join().unwrap();
            climbed
        }

        #[test]
        fn an_online_edge_ends_the_rung_without_waiting_it_out() {
            let _serial = serial_global_state();
            connectivity::reset();

            let (slept, attempts) = climb_through_edges(1, || Some(5));

            assert_eq!(slept, vec![RESUME_WAITS[0]]);
            assert_eq!(attempts, 1, "the pass is attempted on the edge");
            connectivity::reset();
        }

        #[test]
        fn a_flapping_connection_climbs_the_ladder_rather_than_resetting_it() {
            let _serial = serial_global_state();
            connectivity::reset();

            let (slept, attempts) = climb_through_edges(3, || Some(5));

            assert_eq!(
                slept,
                RESUME_WAITS[..3].to_vec(),
                "each edge moves up a rung"
            );
            assert_eq!(attempts, 3);
            connectivity::reset();
        }

        #[test]
        fn an_edge_with_nothing_outstanding_attempts_nothing() {
            let _serial = serial_global_state();
            connectivity::reset();

            let (slept, attempts) = climb_through_edges(3, || Some(0));

            assert_eq!(
                slept.len(),
                1,
                "a zero queue ends the ladder on the woken rung"
            );
            assert_eq!(attempts, 0);
            connectivity::reset();
        }
    }
    /// Scenario: the athlete pauses the download from Settings. The pass in
    /// flight ends at its next batch boundary, and nothing starts another in
    /// this process: not the launch trigger, not the ladder.
    /// Scenario: an ask that settles nothing leaves the row where it is, so the
    /// derived queue offers it again on the next pass. Which answers count
    /// against the track is what decides whether the queue can ever end.
    mod attempts {
        use super::*;

        fn sort_one(result: Fetched, ask: Ask) -> (Plan, BackfillOutcome) {
            let sports = std::collections::HashMap::from([("a1", "Ride")]);
            let mut plan = Plan::default();
            let mut outcome = BackfillOutcome::default();
            plan.sort("a1".to_string(), result, ask, &sports, &mut outcome);
            (plan, outcome)
        }

        #[test]
        fn an_answer_about_the_activity_counts_against_it() {
            let _serial = serial_global_state();

            let (plan, _) = sort_one(
                Fetched::Failed(NetError::Http {
                    status: 404,
                    body: "no such activity".to_string(),
                }),
                Ask::Elevation,
            );

            assert_eq!(
                plan.attempted,
                vec!["a1".to_string()],
                "upstream answered about this activity, so the ask is worth counting"
            );
            assert!(plan.refused.is_empty(), "a 404 is not worth asking again");
        }

        #[test]
        fn a_whole_track_ask_that_comes_back_empty_counts_against_it() {
            let _serial = serial_global_state();

            let (plan, _) = sort_one(Fetched::Empty, Ask::Track);

            assert_eq!(
                plan.attempted,
                vec!["a1".to_string()],
                "the coordinates were asked for and none came back, which is the last ask there is"
            );
        }

        #[test]
        fn a_connection_that_is_gone_says_nothing_about_the_activity() {
            let _serial = serial_global_state();

            let (plan, _) = sort_one(
                Fetched::Failed(NetError::Transport("connection reset".to_string())),
                Ask::Elevation,
            );

            assert!(
                plan.attempted.is_empty(),
                "a track must never be retired for the network being down"
            );
            assert_eq!(plan.refused.len(), 1, "it is worth asking again instead");
        }

        #[test]
        fn an_answer_that_settles_the_track_counts_nothing() {
            let _serial = serial_global_state();

            for (result, ask, what) in [
                (
                    Fetched::NoAltitude,
                    Ask::Elevation,
                    "upstream has no altitude",
                ),
                (
                    Fetched::Altitudes(vec![1.0], ElevationSeries::Corrected),
                    Ask::Elevation,
                    "a series to splice",
                ),
                (
                    Fetched::Empty,
                    Ask::Elevation,
                    "an empty elevation ask goes to the whole track",
                ),
            ] {
                let (plan, _) = sort_one(result, ask);
                assert!(
                    plan.attempted.is_empty(),
                    "{what} settles the row, so there is nothing to count"
                );
            }
        }
    }

    mod paused {
        use super::*;
        use crate::net::connectivity;

        fn queue(n: usize) -> Vec<(String, String)> {
            (0..n)
                .map(|i| (format!("p{}", i), "Ride".to_string()))
                .collect()
        }

        fn answer(ids: &[String]) -> Vec<(String, Fetched)> {
            ids.iter()
                .map(|id| (id.clone(), Fetched::NoAltitude))
                .collect()
        }

        #[test]
        fn a_pause_between_batches_ends_the_walk_with_no_further_fetches() {
            let _serial = serial_global_state();
            let _previous = seeded_global_engine();
            with_persistent_engine(|engine| engine.set_detection_enabled(false))
                .expect("engine")
                .expect("switch off");
            let _current = init_global_engine("pause_between_batches.db");
            connectivity::reset();
            reset_pause();

            let completed_before = BACKFILL.completed.load(Ordering::Relaxed);
            let mut asked = 0usize;
            let walk = drain_queue_with(engine_install(), &queue(3 * BATCH), true, |ids, _ask| {
                asked += ids.len();
                pause_elevation_backfill();
                answer(ids)
            });

            assert_eq!(
                asked, BATCH,
                "the batch in flight finishes, the next never starts"
            );
            assert!(matches!(walk.stopped, Some(Stopped::Paused)));
            assert_eq!(walk.unasked.len(), 2 * BATCH, "the rest is still owed");
            assert_eq!(
                BACKFILL.completed.load(Ordering::Relaxed) - completed_before,
                BATCH as u32,
                "the in-flight batch reaches the completion counter"
            );

            reset_pause();
        }

        #[test]
        fn a_pause_with_no_pass_in_flight_reads_as_paused_at_once() {
            let _serial = serial_global_state();
            reset_pause();
            set_phase(BACKFILL_PHASE_PARTIAL);

            assert!(
                !BACKFILL.running.load(Ordering::SeqCst),
                "nothing was running to stop"
            );

            pause_elevation_backfill();
            assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PAUSED);
            assert!(elevation_backfill_paused());

            reset_pause();
        }

        #[test]
        fn a_start_that_meets_the_pause_leaves_the_phase_paused() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();
            set_phase(BACKFILL_PHASE_PARTIAL);

            // A start holds the slot while it checks, and a pause landing in
            // that window sees a run in flight and leaves the phase to it.
            let slot = RunGuard::claim().expect("the slot is free");
            pause_elevation_backfill();
            assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PARTIAL);
            drop(slot);

            assert!(matches!(start_pass(), FfiStartOutcome::Held));
            assert_eq!(
                backfill_progress().phase,
                BACKFILL_PHASE_PAUSED,
                "the start that declines for the pause is the one left to say so"
            );

            reset_pause();
        }

        #[test]
        fn a_resume_lifts_the_pause_without_a_new_process() {
            let _serial = serial_global_state();
            reset_pause();
            set_phase(BACKFILL_PHASE_PARTIAL);

            pause_elevation_backfill();
            assert!(elevation_backfill_paused());
            assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PAUSED);

            assert!(
                resume_elevation_backfill(),
                "a paused install had a pause to lift"
            );
            assert!(
                !elevation_backfill_paused(),
                "the flag is the pause, so it has to clear"
            );
            assert_ne!(
                backfill_progress().phase,
                BACKFILL_PHASE_PAUSED,
                "a resumed install must not still read paused"
            );

            reset_pause();
        }

        #[test]
        fn a_resume_with_no_pause_to_lift_changes_nothing() {
            let _serial = serial_global_state();
            reset_pause();
            set_phase(BACKFILL_PHASE_PARTIAL);

            assert!(!resume_elevation_backfill(), "there was no pause to lift");
            assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PARTIAL);

            reset_pause();
        }

        #[test]
        fn a_resumed_install_starts_a_pass_again() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();

            pause_elevation_backfill();
            assert!(!start_pass().started(), "a paused install starts no pass");

            resume_elevation_backfill();
            assert!(!elevation_backfill_paused());

            reset_pause();
        }

        #[test]
        fn a_paused_start_attempts_nothing_even_with_work_outstanding() {
            let _serial = serial_global_state();
            let _tmp = seeded_global_engine();
            connectivity::reset();
            reset_pause();
            assert!(
                matches!(
                    with_persistent_engine(|engine| engine.elevation_backfill_remaining()),
                    Some(Ok(n)) if n > 0
                ),
                "the fixture has to hold work, or the refusal proves nothing"
            );

            pause_elevation_backfill();
            assert!(!start_pass().started(), "a paused install starts no pass");
            assert!(!pass_running(), "and holds no slot");

            reset_pause();
        }
    }

    /// Scenario: the crate unwinds on panic and the panic hook logs rather
    /// than aborting, so a panic anywhere inside the climb runs past the line
    /// that clears the flag. The ladder would then be armed for the life of
    /// the process and the elevation resume dead with it.
    mod resume_slot {
        use super::*;

        #[test]
        fn a_panicking_climb_releases_the_slot() {
            let _serial = serial_global_state();
            RESUME_ARMED.store(false, Ordering::SeqCst);

            let climb = spawn_resume_ladder(|| panic!("resume_ladder")).expect("the slot was free");
            assert!(climb.join().is_err(), "the climb panicked");

            assert!(
                !RESUME_ARMED.load(Ordering::SeqCst),
                "a panicked climb left the ladder armed for the process"
            );
        }

        #[test]
        fn a_climb_that_returns_releases_the_slot() {
            let _serial = serial_global_state();
            RESUME_ARMED.store(false, Ordering::SeqCst);

            spawn_resume_ladder(|| {})
                .expect("the slot was free")
                .join()
                .expect("the climb returned");

            assert!(!RESUME_ARMED.load(Ordering::SeqCst));
        }

        /// One ladder at a time: the second arm joins the climb that is
        /// already running rather than laying a parallel one.
        #[test]
        fn a_second_arm_is_refused_while_one_climbs() {
            let _serial = serial_global_state();
            RESUME_ARMED.store(false, Ordering::SeqCst);

            let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
            let first = spawn_resume_ladder(move || {
                release_rx.recv().ok();
            })
            .expect("the slot was free");

            assert!(
                spawn_resume_ladder(|| {}).is_none(),
                "a second ladder was laid beside the first"
            );

            release_tx.send(()).unwrap();
            first.join().unwrap();

            assert!(
                spawn_resume_ladder(|| {})
                    .expect("the slot was free again")
                    .join()
                    .is_ok()
            );
        }

        /// The slot is released after a panic, so the next arm gets it. A flag
        /// cleared but a ladder nobody can lay again is the same outage.
        #[test]
        fn the_next_arm_after_a_panic_gets_the_slot() {
            let _serial = serial_global_state();
            RESUME_ARMED.store(false, Ordering::SeqCst);

            let _ = spawn_resume_ladder(|| panic!("resume_ladder"))
                .expect("the slot was free")
                .join();

            let second = spawn_resume_ladder(|| {}).expect("the slot was free again");
            second.join().expect("the second climb returned");
            assert!(!RESUME_ARMED.load(Ordering::SeqCst));
        }
    }
}

#[cfg(test)]
#[path = "tests/elevation_auth.rs"]
mod auth_tests;

/// Scenario: a climbing best keeps to the corrected series, so every track the
/// backfill writes, and every track it wrote before the engine recorded the
/// series, has to say which series its points carry.
///
/// Expected behaviour: the reducers keep the series `parse_streams` chose, a
/// pass records it with the points, and the walk over older tracks records it
/// only when the points carry what upstream answers with.
#[cfg(test)]
mod series {
    use super::*;
    use crate::net::connectivity;
    use crate::persistence::{
        ELEVATION_SOURCE_CORRECTED, ELEVATION_SOURCE_DEVICE, ELEVATION_SOURCE_UNKNOWN,
        ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNKNOWN,
    };
    use crate::test_globals::{init_global_engine, serial_global_state};
    use tempfile::TempDir;

    const POINTS: usize = 8;

    fn line(seed: f64) -> Vec<GpsPoint> {
        (0..POINTS)
            .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
            .collect()
    }

    fn heights(base: f64) -> Vec<f64> {
        (0..POINTS).map(|i| base + i as f64 * 1.3).collect()
    }

    fn elevate(points: &[GpsPoint], series: &[f64]) -> Vec<GpsPoint> {
        points
            .iter()
            .zip(series)
            .map(|(p, e)| GpsPoint::with_elevation(p.latitude, p.longitude, *e))
            .collect()
    }

    fn parsed(fixed: bool) -> ParsedStreams {
        ParsedStreams {
            latlng: line(0.0)
                .iter()
                .map(|p| [p.latitude, p.longitude])
                .collect(),
            altitude: heights(500.0),
            altitude_is_fixed: fixed,
            ..ParsedStreams::default()
        }
    }

    /// A library holding each named track, stored flat.
    fn library(ids: &[&str]) -> TempDir {
        let tmp = init_global_engine("elevation_series.db");
        connectivity::reset();
        reset_pause();
        with_persistent_engine(|engine| {
            for (i, id) in ids.iter().enumerate() {
                engine
                    .add_activity(id.to_string(), line(i as f64 * 0.01), "Ride".into())
                    .expect("add activity");
            }
        })
        .expect("engine");
        tmp
    }

    /// A library of tracks a build before the column fetched elevation for:
    /// elevated, fetched, and of unknown series.
    fn fetched_library(ids: &[&str]) -> TempDir {
        let tmp = library(&[]);
        with_persistent_engine(|engine| {
            for (i, id) in ids.iter().enumerate() {
                let flat = line(i as f64 * 0.01);
                engine
                    .add_activity(
                        id.to_string(),
                        elevate(&flat, &heights(500.0)),
                        "Ride".into(),
                    )
                    .expect("add activity");
            }
            let states: Vec<(String, u8)> = ids
                .iter()
                .map(|id| (id.to_string(), ELEVATION_STATE_FETCHED))
                .collect();
            engine.record_elevation_state(&states).expect("state");
        })
        .expect("engine");
        tmp
    }

    fn source(id: &str) -> u8 {
        with_persistent_engine(|e| e.elevation_source_of_track(id))
            .expect("engine")
            .expect("stored")
    }

    fn state(id: &str) -> u8 {
        let state: i64 = with_persistent_engine(|e| {
            e.db.query_row(
                "SELECT elevation_state FROM gps_tracks WHERE activity_id = ?1",
                params![id],
                |row| row.get(0),
            )
        })
        .expect("engine")
        .expect("stored");
        u8::try_from(state).expect("a state")
    }

    fn blob(id: &str) -> Vec<u8> {
        with_persistent_engine(|e| {
            e.db.query_row(
                "SELECT track_data FROM gps_tracks WHERE activity_id = ?1",
                params![id],
                |row| row.get(0),
            )
        })
        .expect("engine")
        .expect("blob")
    }

    fn owed() -> Vec<String> {
        with_persistent_engine(|e| e.tracks_owed_elevation_source())
            .expect("engine")
            .expect("queue")
    }

    fn walk(answer: impl Fn(&str) -> Fetched) -> SourceWalk {
        let queue = owed();
        resolve_sources_with(
            engine_install(),
            &queue,
            || true,
            |ids| ids.iter().map(|id| (id.clone(), answer(id))).collect(),
        )
    }

    #[test]
    fn the_reducers_keep_the_series_parse_streams_chose() {
        assert!(matches!(
            reduce(parsed(true)),
            Fetched::Elevated(_, ElevationSeries::Corrected)
        ));
        assert!(matches!(
            reduce(parsed(false)),
            Fetched::Elevated(_, ElevationSeries::Device)
        ));
        assert!(matches!(
            reduce_altitudes(Some(parsed(true))),
            Fetched::Altitudes(_, ElevationSeries::Corrected)
        ));
        assert!(matches!(
            reduce_altitudes(Some(parsed(false))),
            Fetched::Altitudes(_, ElevationSeries::Device)
        ));
    }

    /// Scenario: one track takes the splice from the device series, the other
    /// was re-processed upstream and comes back whole with the corrected one.
    #[test]
    fn a_pass_records_the_series_of_each_track_it_elevates() {
        let _serial = serial_global_state();
        let _dir = library(&["spliced", "replaced"]);
        let queue: Vec<(String, String)> = ["spliced", "replaced"]
            .iter()
            .map(|id| (id.to_string(), "Ride".to_string()))
            .collect();

        drain_queue_with(engine_install(), &queue, true, |ids, ask| {
            ids.iter()
                .map(|id| {
                    let answer = match (id.as_str(), ask) {
                        ("spliced", _) => {
                            Fetched::Altitudes(heights(700.0), ElevationSeries::Device)
                        }
                        (_, Ask::Elevation) => {
                            Fetched::Altitudes(vec![1.0; POINTS + 2], ElevationSeries::Device)
                        }
                        (_, Ask::Track) => Fetched::Elevated(
                            elevate(&line(0.01), &heights(800.0)),
                            ElevationSeries::Corrected,
                        ),
                    };
                    (id.clone(), answer)
                })
                .collect()
        });

        assert_eq!(state("spliced"), ELEVATION_STATE_FETCHED);
        assert_eq!(source("spliced"), ELEVATION_SOURCE_DEVICE);
        assert_eq!(state("replaced"), ELEVATION_STATE_FETCHED);
        assert_eq!(source("replaced"), ELEVATION_SOURCE_CORRECTED);
    }

    /// Only a fetched track of unknown series is owed the read. A track still
    /// owed elevation goes through the backfill, and one whose series is known
    /// has nothing to settle.
    #[test]
    fn the_series_queue_holds_only_fetched_tracks_of_unknown_series() {
        let _serial = serial_global_state();
        let _dir = fetched_library(&["owed", "known", "demo-ride"]);
        with_persistent_engine(|e| {
            e.add_activity("flat".into(), line(0.5), "Ride".into())
                .expect("add flat");
            e.record_elevation_source(&[("known".to_string(), ELEVATION_SOURCE_CORRECTED)])
                .expect("source");
        })
        .expect("engine");

        assert_eq!(owed(), vec!["owed".to_string()]);
    }

    /// Scenario: upstream answers with the series the stored points carry.
    /// Expected behaviour: the series is recorded and not a byte of the track
    /// moves.
    #[test]
    fn a_track_carrying_the_answered_series_records_it_and_keeps_its_points() {
        let _serial = serial_global_state();
        let _dir = fetched_library(&["valley"]);
        let before = blob("valley");

        let walked = walk(|_| Fetched::Altitudes(heights(500.0), ElevationSeries::Device));

        assert_eq!(walked.recorded, 1);
        assert_eq!(source("valley"), ELEVATION_SOURCE_DEVICE);
        assert_eq!(state("valley"), ELEVATION_STATE_FETCHED);
        assert_eq!(blob("valley"), before, "the points are left as they are");
        assert!(owed().is_empty());
    }

    /// Scenario: upstream now answers with a series the stored points do not
    /// carry, so which one they hold cannot be told.
    /// Expected behaviour: the track goes back to the elevation queue, whose
    /// splice writes the series a fresh ingest would choose and records it.
    #[test]
    fn a_track_carrying_another_series_is_handed_back_to_the_backfill() {
        let _serial = serial_global_state();
        let _dir = fetched_library(&["ridge"]);

        let walked = walk(|_| Fetched::Altitudes(heights(900.0), ElevationSeries::Corrected));

        assert_eq!(walked.handed_back, 1);
        assert_eq!(state("ridge"), ELEVATION_STATE_UNKNOWN);
        assert_eq!(source("ridge"), ELEVATION_SOURCE_UNKNOWN);
        let queued = with_persistent_engine(|e| e.tracks_missing_elevation())
            .expect("engine")
            .expect("queue");
        assert_eq!(queued, vec![("ridge".to_string(), "Ride".to_string())]);
        assert!(owed().is_empty());
    }

    /// Scenario: upstream answers about the activity with no altitude to
    /// compare, on every pass.
    /// Expected behaviour: each answer counts against the track, which leaves
    /// the series queue at the limit and stays unknown and fetched.
    #[test]
    fn a_track_upstream_never_answers_for_leaves_the_series_queue() {
        let _serial = serial_global_state();
        let _dir = fetched_library(&["quiet"]);

        for asked in 1..=ELEVATION_ATTEMPT_LIMIT {
            assert_eq!(owed(), vec!["quiet".to_string()], "owed before ask {asked}");
            let walked = walk(|_| Fetched::NoAltitude);
            assert_eq!(walked.unanswered, 1);
        }

        assert!(owed().is_empty());
        assert_eq!(source("quiet"), ELEVATION_SOURCE_UNKNOWN);
        assert_eq!(state("quiet"), ELEVATION_STATE_FETCHED);
    }

    /// A refused connection and a rejected credential say nothing about the
    /// track, so neither counts against it.
    #[test]
    fn a_refused_ask_counts_nothing_and_a_rejected_credential_stops_the_walk() {
        let _serial = serial_global_state();
        let _dir = fetched_library(&["offline"]);

        let walked = walk(|_| Fetched::Failed(NetError::Transport("reset".into())));
        assert_eq!(walked, SourceWalk::default());

        let walked = walk(|_| Fetched::Failed(NetError::Unauthorized));
        assert!(walked.stopped);
        assert_eq!(owed(), vec!["offline".to_string()], "still owed");
        assert_eq!(source("offline"), ELEVATION_SOURCE_UNKNOWN);
    }
}
