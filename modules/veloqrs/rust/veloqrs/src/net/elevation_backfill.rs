//! One-shot re-fetch of every stored track that does not yet carry elevation.
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
//! Three rules make the pass terminate. Upstream that answers with coordinates
//! but no usable altitude records `UNAVAILABLE`, so it leaves the queue
//! permanently. A network failure or an empty response leaves the row
//! untouched, so it can be asked again. A 401 ends the pass outright rather
//! than spending the whole library on rejected requests.
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
//! itself, not a bare re-cut. The launch trigger declines while this queue is
//! non-empty, so the drained pass is the only thing left holding the
//! migration. See [`terminal_cut`].

use crate::governor::Lane;
use crate::net::endpoints::{TRACK_STREAM_TYPES, fetch_streams};
use crate::net::transport::{NetError, Transport};
use crate::net::types::ParsedStreams;
use crate::objects::detection::{DetectionPoll, poll_detection_once};
use crate::persistence::cutover::CutoverOutcome;
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::{
    ELEVATION_STATE_UNAVAILABLE, PersistentEngine, suspend_detection, with_persistent_engine,
};
use rusqlite::{Result as SqlResult, params};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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

fn set_phase(phase: &'static str) {
    *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
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
        let mut stmt = self.db.prepare(
            "SELECT g.activity_id, a.sport_type
               FROM gps_tracks g
               JOIN activities a ON a.id = g.activity_id
              WHERE g.elevation_state = ?1
              ORDER BY a.start_date IS NULL, a.start_date DESC, g.activity_id",
        )?;
        let rows = stmt.query_map(
            params![i64::from(crate::persistence::ELEVATION_STATE_UNKNOWN)],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        rows.collect()
    }

    /// How many tracks the backfill still has to ask about. Zero means a pass
    /// has nothing left to do, which is not the same as the library reading
    /// uniformly elevated.
    ///
    /// The query error is propagated rather than counted as zero. Both launch
    /// triggers treat a zero as the definitive "nothing left", one of them by
    /// stamping the app version, and a locked database at launch is ordinary.
    pub fn elevation_backfill_remaining(&self) -> SqlResult<u64> {
        self.tracks_missing_elevation().map(|q| q.len() as u64)
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

/// One track's fetch, reduced to what the store step needs.
enum Fetched {
    /// Points carrying at least one elevation.
    Elevated(Vec<GpsPoint>),
    /// The response arrived, carried coordinates, and had no usable altitude
    /// anywhere. Upstream has answered and the answer will not change.
    NoAltitude,
    /// The response arrived empty. A stored track exists, so upstream once had
    /// coordinates for this activity; an empty body now is a transient answer,
    /// and the row stays as it is for the next run to retry.
    Empty,
    /// The request failed. The row stays as it is.
    Failed(NetError),
}

/// Reduce a parsed response to the store step's cases. Coordinates and
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
    Fetched::Elevated(points)
}

/// Fetch one batch, bounded to [`FETCH_CONCURRENCY`] requests in flight.
async fn fetch_batch(transport: &Transport, ids: &[String]) -> Vec<(String, Fetched)> {
    use futures::stream::{self, StreamExt};

    stream::iter(ids.to_vec())
        .map(|id| async move {
            let outcome =
                match fetch_streams(transport, &id, Some(TRACK_STREAM_TYPES), Lane::Backfill).await
                {
                    Ok(parsed) => reduce(parsed),
                    Err(e) => Fetched::Failed(e),
                };
            (id, outcome)
        })
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await
}

/// Re-fetch every stored track that does not carry elevation, then re-cut the
/// catalogue once.
///
/// Blocking, so a caller can drive it and see the outcome. Detection is
/// suspended from before the first fetch until after the terminal phase is
/// set, structurally: the guard's drop is the release, so a failure part way
/// through resumes detection just as a clean finish does. The final re-cut
/// starts while the guard is still held (through the unchecked engine path),
/// so nothing else can claim the detection slot between the last store and
/// the re-cut, and it runs only when the queue drained to empty, so no
/// catalogue is ever cut over a half-converted library.
pub fn run_elevation_backfill(transport: &Transport) -> BackfillRun {
    let Some(_slot) = RunGuard::claim() else {
        log::info!("[Elevation] backfill refused: a run is already in flight");
        return BackfillRun::Refused;
    };

    let queue = match with_persistent_engine(|engine| engine.tracks_missing_elevation()) {
        Some(Ok(queue)) => queue,
        Some(Err(e)) => {
            set_phase(BACKFILL_PHASE_FAILED);
            return BackfillRun::Failed(format!("queue unreadable: {}", e));
        }
        None => {
            set_phase(BACKFILL_PHASE_FAILED);
            return BackfillRun::Failed("no engine".to_string());
        }
    };

    BACKFILL.total.store(queue.len() as u32, Ordering::Relaxed);
    BACKFILL.completed.store(0, Ordering::Relaxed);
    BACKFILL.failed.store(0, Ordering::Relaxed);
    set_phase(BACKFILL_PHASE_FETCHING);
    log::info!("[Elevation] backfill starting over {} tracks", queue.len());

    let _suspend = suspend_detection();

    let walk = drain_queue(transport, &queue, true);
    let (mut outcome, stopped, owed) = re_ask(transport, walk);
    // Whatever is still owed was asked and refused, so it is this pass's
    // failure count. Stored rather than added: the gauge counted every refusal
    // as it happened, and a track that landed on a later round is not one.
    outcome.failed += owed.len() as u32;
    BACKFILL.failed.store(outcome.failed, Ordering::Relaxed);

    match stopped {
        Some(Stopped::Unauthorized) => {
            set_phase(BACKFILL_PHASE_FAILED);
            log::warn!("[Elevation] backfill stopped: unauthorized");
            // The pass is the only thing talking upstream during a
            // conversion, so a credential rejected here is reported the way
            // sync reports one. Nothing else would ask until the next sync,
            // and until then the revoked session stands.
            crate::objects::park_auth_expired();
            return BackfillRun::Failed("unauthorized".to_string());
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
        None => {}
    }

    // An unreadable count is not a drained one: a pass that cannot see its own
    // queue ends partial, so the next launch asks again rather than the run
    // claiming a library it never checked.
    let (remaining, fetched) = with_persistent_engine(|engine| {
        let remaining = engine.elevation_backfill_remaining().ok();
        let fetched = engine
            .elevation_state_counts()
            .map(|c| c.fetched)
            .unwrap_or(0);
        (remaining, fetched)
    })
    .unwrap_or((None, 0));
    let drained = remaining == Some(0);

    // The terminal phase lands before the guard releases, so there is no
    // window in which the phase still reads "fetching" while detection has
    // already resumed.
    set_phase(if drained {
        BACKFILL_PHASE_COMPLETE
    } else {
        BACKFILL_PHASE_PARTIAL
    });

    // The terminal cut fires on the pass that drains the queue, provided the
    // library carries any elevation at all. `fetched > 0` rather than this
    // pass's own count: an earlier pass may have elevated tracks and then died
    // before its cut, and this pass has to make good on that even when
    // everything it asked about itself turned out unavailable. The guard is
    // still held here, so nothing else can claim the detection slot first.
    if drained && outcome.queued > 0 && fetched > 0 && terminal_cut() {
        outcome.detects_started = 1;
        BACKFILL.detects.fetch_add(1, Ordering::Relaxed);
    }
    log::info!(
        "[Elevation] backfill finished: {} elevated, {} unavailable, {} failed, {} still to ask",
        outcome.elevated,
        outcome.unavailable,
        outcome.failed,
        remaining.map_or_else(|| "an unreadable number of".to_string(), |n| n.to_string())
    );

    BackfillRun::Finished(outcome)
}

/// Why a pass ended before its queue did.
enum Stopped {
    /// The credential was rejected, so every remaining request would be too.
    Unauthorized,
    /// Nothing to work with: [`MAX_CONSECUTIVE_FAILURES`] in a row.
    NothingToWorkWith,
    /// TypeScript says the network is gone, so the rest of the queue would
    /// only be spent discovering that one request at a time.
    Offline,
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
    transport: &Transport,
    first: Walk,
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
        std::thread::sleep(delay);

        let round = drain_queue(transport, &refused, false);
        outcome.elevated += round.outcome.elevated;
        outcome.unavailable += round.outcome.unavailable;
        outcome.failed += round.outcome.failed;
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
fn drain_queue(transport: &Transport, queue: &[(String, String)], count_progress: bool) -> Walk {
    drain_queue_with(queue, count_progress, |ids| {
        crate::runtime::block_on(fetch_batch(transport, ids))
    })
}

/// The walk itself, with the fetch handed in.
///
/// Split from [`drain_queue`] so the stop conditions can be exercised without
/// a transport: everything that ends a walk early is decided here.
fn drain_queue_with(
    queue: &[(String, String)],
    count_progress: bool,
    mut fetch: impl FnMut(&[String]) -> Vec<(String, Fetched)>,
) -> Walk {
    let mut outcome = BackfillOutcome {
        queued: queue.len() as u32,
        ..BackfillOutcome::default()
    };
    let mut refused: Vec<(String, String)> = Vec::new();

    let mut consecutive_failures = 0usize;

    for (chunk, batch) in queue.chunks(BATCH).enumerate() {
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

        let ids: Vec<String> = batch.iter().map(|(id, _)| id.clone()).collect();
        let fetched = fetch(&ids);

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

        let mut to_store: Vec<(String, Vec<GpsPoint>, String)> = Vec::new();
        let mut states: Vec<(String, u8)> = Vec::new();

        for (id, result) in fetched {
            match result {
                Fetched::Elevated(points) => {
                    let sport = sports.get(id.as_str()).copied().unwrap_or("Ride");
                    to_store.push((id, points, sport.to_string()));
                    consecutive_failures = 0;
                }
                Fetched::NoAltitude => {
                    states.push((id, ELEVATION_STATE_UNAVAILABLE));
                    outcome.unavailable += 1;
                    consecutive_failures = 0;
                }
                Fetched::Empty => {
                    log::info!("[Elevation] {} answered empty, left for the next run", id);
                    outcome.failed += 1;
                    BACKFILL.failed.fetch_add(1, Ordering::Relaxed);
                    // Upstream replied, so the connection is fine.
                    consecutive_failures = 0;
                }
                Fetched::Failed(e) => {
                    BACKFILL.failed.fetch_add(1, Ordering::Relaxed);
                    if is_connectivity(&e) {
                        log::info!("[Elevation] {} refused, worth asking again: {}", id, e);
                        let sport = sports.get(id.as_str()).copied().unwrap_or("Ride");
                        refused.push((id, sport.to_string()));
                        consecutive_failures += 1;
                    } else {
                        log::info!("[Elevation] {} left for the next run: {}", id, e);
                        outcome.failed += 1;
                        consecutive_failures = 0;
                    }
                }
            }
        }

        outcome.elevated += store_batch(&to_store, &states) as u32;
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
                unasked: queue[(chunk + 1) * BATCH..].to_vec(),
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

/// Re-ingest the elevated tracks and stamp provenance for the whole batch.
/// Returns how many tracks landed with elevation.
fn store_batch(to_store: &[(String, Vec<GpsPoint>, String)], states: &[(String, u8)]) -> usize {
    with_persistent_engine(|engine| {
        // The re-ingest upserts the activity row in place, so its date, name
        // and distance survive, and the section_activities links keyed on the
        // id are never cascade-deleted.
        let mut stored = 0;
        let mut all_states = states.to_vec();
        if !to_store.is_empty() {
            match engine.add_activities_batch(to_store.to_vec()) {
                Ok(()) => {
                    stored = to_store.len();
                    // Provenance follows the points the engine kept, so a track
                    // left flat by an unusable series reads as unavailable.
                    all_states.extend(to_store.iter().map(|(id, points, _)| {
                        (id.clone(), crate::ffi::elevation_state_of(points))
                    }));
                }
                Err(e) => log::warn!("[Elevation] batch store failed: {}", e),
            }
        }

        if let Err(e) = engine.record_elevation_state(&all_states) {
            log::warn!("[Elevation] provenance not recorded: {}", e);
        }
        stored
    })
    .unwrap_or(0)
}

/// The one cut a drained pass owes, handed to whoever owns it.
///
/// An upgrading install is owed the detector cutover, and the launch trigger
/// that would normally run it declines while this queue is non-empty
/// (`src/features/routes/lib/cutoverTrigger.ts`), so the pass that empties the
/// queue is the only thing left that can hand it over. It has to hand over
/// rather than re-cut: the cutover archives the flat-era catalogue, switches
/// the config and then runs the same cold detect, so a bare re-cut here is
/// both a duplicate pass and the thing that retires the migration before it
/// has run. It stamps `DETECTOR_METHOD` on the catalogue, and
/// `cutover_is_owed` reads false from that stamp forever after.
///
/// Run inline rather than spawned, so the suspension guard this is called
/// under covers the migration too. Spawning would release it between the two
/// and let an ordinary conditioning detect land a catalogue for the archive to
/// snapshot instead of the flat-era one.
fn terminal_cut() -> bool {
    let owed = with_persistent_engine(|engine| engine.cutover_is_owed()).unwrap_or(false);
    if !owed {
        return start_final_detect();
    }
    match crate::persistence::cutover::run_cutover() {
        Ok(CutoverOutcome::Completed(_)) => true,
        // Owed a moment ago and not owed now, or a run already in flight:
        // either way something else is doing the cold detect this pass would
        // have started, so starting a second one duplicates it.
        Ok(CutoverOutcome::NotOwed) => false,
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
fn start_final_detect() -> bool {
    // A run that predates the backfill may still hold the detection slot.
    // Drive it to its end through the shared poll, which applies its result
    // and clears the handle; the cold re-cut below then supersedes whatever
    // it wrote. The suspension refuses every new start, so once the slot
    // empties it stays empty.
    loop {
        match poll_detection_once() {
            Ok(DetectionPoll::Idle) => break,
            Ok(DetectionPoll::Running) => std::thread::sleep(DRIVER_POLL),
            Ok(DetectionPoll::Applied) | Ok(DetectionPoll::Died) => continue,
            Err(e) => {
                log::warn!(
                    "[Elevation] re-cut skipped: could not drain the slot: {}",
                    e
                );
                return false;
            }
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

    let handle = with_persistent_engine(|engine| {
        engine.clear_processed_activity_ids();
        engine.detect_sections_background_unchecked()
    });

    let Some(handle) = handle else {
        return false;
    };

    *guard = Some(handle);
    drop(guard);

    std::thread::spawn(|| {
        loop {
            std::thread::sleep(DRIVER_POLL);
            match poll_detection_once() {
                Ok(DetectionPoll::Running) => continue,
                Ok(DetectionPoll::Applied) => {
                    log::info!("[Elevation] re-cut applied");
                    break;
                }
                Ok(DetectionPoll::Idle) | Ok(DetectionPoll::Died) => break,
                Err(e) => {
                    log::warn!("[Elevation] re-cut poll failed: {}", e);
                    break;
                }
            }
        }
    });
    true
}

/// Start a backfill on a detached thread using the process credential.
///
/// Returns false when there is no credential, when a run is already in flight,
/// or when the queue is already empty, so a caller can fire this at every
/// launch and let it decide.
pub fn start_elevation_backfill() -> bool {
    // A queue that cannot be read is not an empty one, but it is also not a
    // queue a run could work, so this declines and the next launch asks again.
    let remaining = with_persistent_engine(|engine| engine.elevation_backfill_remaining());
    if !matches!(remaining, Some(Ok(n)) if n > 0) {
        return false;
    }
    if BACKFILL.running.load(Ordering::SeqCst) {
        return false;
    }
    // The state TypeScript pushes is advisory, so this only declines on a
    // fresh offline. Unset or stale falls through and the pass runs, which is
    // exactly what happened before there was a state to read.
    if crate::net::connectivity::is_offline() {
        log::info!("[Elevation] backfill deferred: offline");
        return false;
    }
    let Some(Ok(transport)) = crate::objects::current_transport() else {
        log::info!("[Elevation] backfill deferred: no credential yet");
        return false;
    };

    std::thread::spawn(move || {
        run_elevation_backfill(&transport);
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::sections::detection_workers_started;
    use crate::test_globals::{
        clear_detection_handle, drain_detection, race, seeded_global_engine, serial_global_state,
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
    #[test]
    fn a_final_detect_never_spawns_a_worker_it_drops() {
        let _serial = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_detection_handle();
        let before = detection_workers_started();

        let won = race(start_final_detect);

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

        let earlier = with_persistent_engine(|engine| engine.detect_sections_background())
            .expect("the earlier run starts");
        *SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(earlier);

        let before = detection_workers_started();
        assert!(start_final_detect(), "the re-cut starts after the drain");
        assert_eq!(
            detection_workers_started() - before,
            1,
            "the re-cut spawns its own worker and nothing else"
        );

        drain_detection();
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
        let Fetched::Elevated(points) = reduce(parsed) else {
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

    /// Scenario: the launch triggers read the remaining count as the one
    /// definitive answer. `elevationBackfillTrigger` stamps the app version on
    /// a zero and never asks again for that release, and `cutoverTrigger`
    /// reads a zero as permission to cut a library over.
    ///
    /// Expected behaviour: an engine that is not there cannot answer, so the
    /// export raises rather than reporting a finished library.
    #[test]
    fn an_engineless_remaining_call_raises_rather_than_reading_zero() {
        let _serial = serial_global_state();
        *crate::persistence::PERSISTENT_ENGINE
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;

        assert!(matches!(
            crate::ffi::get_elevation_backfill_remaining(),
            Err(crate::VeloqError::NotInitialized)
        ));
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
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(engine);

        let answer = crate::ffi::get_elevation_backfill_remaining();

        *crate::persistence::PERSISTENT_ENGINE
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;

        assert!(matches!(answer, Err(crate::VeloqError::Database { .. })));
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

    /// Scenario: `Q65` put the network lifecycle in Rust, so a pass has to
    /// react to the connectivity TypeScript pushes rather than spending its
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
            let walk = drain_queue_with(&queue(3 * BATCH), true, |ids| {
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
            let walk = drain_queue_with(&queue(2 * BATCH), true, |ids| {
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

        #[test]
        fn losing_the_network_stops_the_walk_where_it_stands() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online(true);

            let mut asked = 0usize;
            let walk = drain_queue_with(&queue(4 * BATCH), true, |ids| {
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
            let walk = drain_queue_with(&queue(3 * BATCH), true, |ids| {
                asked += ids.len();
                answer(ids)
            });
            assert_eq!(asked, 0);

            connectivity::set_online(true);
            let mut asked_again = 0usize;
            let second = drain_queue_with(&walk.unasked, true, |ids| {
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

        /// An offline nobody refreshed is a missed push, not a fact. Rust
        /// refusing work on a live connection is worse than never knowing, so
        /// the state expires and the walk goes back to trying.
        #[test]
        fn a_stale_offline_reads_as_try_rather_than_do_not() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online_at(false, Instant::now() - connectivity::STALE_AFTER);

            let mut asked = 0usize;
            let walk = drain_queue_with(&queue(2 * BATCH), true, |ids| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, 2 * BATCH, "a state this old must not refuse work");
            assert!(walk.stopped.is_none());

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
                !start_elevation_backfill(),
                "a fresh offline must not spawn a pass"
            );
            assert!(
                !BACKFILL.running.load(Ordering::SeqCst),
                "and must not leave the run flag claimed"
            );

            connectivity::reset();
            assert!(
                start_elevation_backfill(),
                "a never-pushed state has to behave exactly as it did before"
            );

            connectivity::reset();
            drain_detection();
        }

        /// A stale *online* is harmless: the value is only ever a reason to
        /// refuse, so expiry can only ever open the gate, never close it.
        #[test]
        fn a_stale_online_still_reads_as_try() {
            let _serial = serial_global_state();
            connectivity::reset();
            connectivity::set_online_at(true, Instant::now() - connectivity::STALE_AFTER);

            let mut asked = 0usize;
            let walk = drain_queue_with(&queue(BATCH), true, |ids| {
                asked += ids.len();
                answer(ids)
            });

            assert_eq!(asked, BATCH);
            assert!(walk.stopped.is_none());

            connectivity::reset();
        }
    }
}
