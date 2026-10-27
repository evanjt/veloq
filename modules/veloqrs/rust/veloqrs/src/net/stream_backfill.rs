//! One-shot fetch of the per-metric series the retention window already threw
//! away.
//!
//! The default window was ninety days, so on any install older than that most
//! of the library downloaded only the three series the track needs and its
//! cadence, heart rate, power and temperature were never asked for. Widening
//! the default fixes what the next sync stores and nothing about what is
//! already on the device: there is no row in `activity_streams` to find and
//! nothing re-reads the decision. This pass is what goes back for them.
//!
//! The queue is derived, never stored: every activity with a track, inside the
//! window as it stands now, that has no `activity_streams` rows and has not
//! been asked [`STREAM_ATTEMPT_LIMIT`] times already. A crash or a kill costs
//! the activities in flight and nothing else, because the stored rows of the
//! ones that landed take them out of the queue on their own.
//!
//! An activity with no track joins the same queue when the census says
//! upstream holds a series for it: a strength session with heart rate, say.
//! The sync downloads only tracks, so this pass, which a settled sync starts,
//! is how such an activity's series reach the device. With no coordinates
//! there is no mask and no track to match, so its series are stored in the
//! server's own sample index with the `time` series that addresses it.
//!
//! The ask is the whole [`DEFAULT_STREAM_TYPES`] set, coordinates included,
//! even though the coordinates are already on the device. `storable_series`
//! reduces every series to the index space `latlng` defines, dropping the
//! samples whose coordinate was null, and a section addresses the stored track
//! in exactly that space. Without `latlng` in the response there is no mask to
//! reduce by, and a series stored in the server's space is offset from the
//! track by every dropped sample, silently, for every lap slice over it.
//!
//! A response whose masked length disagrees with the stored `point_count` is
//! upstream having re-processed that activity. Its series cannot be addressed
//! against the track this device holds, so nothing is stored and the ask is
//! counted. Re-ingesting the track is the elevation pass's business, not this
//! one's: moving a track's geometry invalidates the catalogue derived from it.
//!
//! Three rules make the pass terminate. An ask that settles nothing is counted
//! against the activity, so a ride recorded with no sensors leaves the queue
//! after [`STREAM_ATTEMPT_LIMIT`] passes rather than being offered for the life
//! of the install. A connection failure leaves the row untouched and uncounted,
//! so it is asked again. A 401 ends the pass outright rather than spending the
//! whole library on rejected requests.
//!
//! A sync that settles successfully starts the pass by itself when activities
//! inside the window still owe their series, and so does the detector
//! cutover's settle on an upgrade ([`autostart_stream_backfill`] decides for
//! both). It defers while the elevation backfill still owes or a cutover is
//! pending or running, so it never competes with the work the cutover waits
//! on. With Route Matching off neither of those runs, so it waits only on a
//! cutover already running. The athlete can still stop it, and
//! [`stop_stream_backfill`] takes effect at the next batch boundary. A stop
//! holds the automatic start until the retention window next changes
//! ([`release_autostart_hold`]); the Download action on the settings row starts
//! a pass regardless.

use crate::governor::Lane;
use crate::net::intervals::endpoints::DEFAULT_STREAM_TYPES;
use crate::net::source::Source;
use crate::net::transport::{NetError, Transport};
use crate::net::types::{
    StreamDto, TrackClock, parse_streams, storable_series, track_clock, trackless_series,
};
use crate::net::{LiveSource, live_source};
use crate::objects::FfiStartOutcome;
use crate::persistence::attempts::now_ms;
use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, record_job_run};
use crate::persistence::{PersistentEngine, StreamGap, engine_install, with_persistent_engine_for};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

/// Activities asked for per batch. The cancel flag and the connectivity state
/// are read at the boundary, so this is also how long a stop takes to land.
const BATCH: usize = 20;

/// Requests in flight at once. Under the governor's shared pace, so the pace is
/// the limiter rather than this number.
const FETCH_CONCURRENCY: usize = 6;

/// Consecutive failures that end the pass. One whole batch: the results inside
/// a batch arrive unordered, so reaching this means a full batch came back with
/// nothing to work with, which no partial outage produces.
pub const MAX_CONSECUTIVE_FAILURES: usize = BATCH;

/// Asks that settle nothing before an activity is retired out of the queue.
///
/// An ask settles nothing when upstream answers and the answer carries no
/// storable series: a ride with no sensors, a body that will not parse, or a
/// track upstream has since re-processed. A connection that is gone is not one
/// of these and is not counted.
pub const STREAM_ATTEMPT_LIMIT: u32 = 3;

/// Nothing is running.
pub const STREAM_PHASE_IDLE: &str = "idle";
/// A pass is asking upstream.
pub const STREAM_PHASE_FETCHING: &str = "fetching";
/// A pass reached the end of its queue.
pub const STREAM_PHASE_COMPLETE: &str = "complete";
/// A pass ended before its queue did, and the rows it did not reach are
/// unchanged, so the next pass asks about them.
pub const STREAM_PHASE_PARTIAL: &str = "partial";
/// The queue is past the large-download threshold and the athlete has not said
/// yes, so nothing is fetched.
pub const STREAM_PHASE_AWAITING_CONSENT: &str = "awaiting_consent";
/// The athlete stopped it.
pub const STREAM_PHASE_STOPPED: &str = "stopped";
/// Series are owed and the automatic start is waiting for the elevation
/// backfill or the detector cutover to finish first. Nothing is fetched, and
/// the athlete can start the pass by hand.
pub const STREAM_PHASE_DEFERRED: &str = "deferred";
/// A pass could not proceed at all.
pub const STREAM_PHASE_FAILED: &str = "failed";
/// intervals.icu refused, or the request budget deferred, the pass. The rows
/// it did not reach are owed, and the engine resumes it when the refusal
/// lifts.
pub const STREAM_PHASE_WAITING: &str = "waiting";

/// Activities owed at or below which the automatic start needs no answer. The
/// same figure as the history slider's large-download threshold.
pub const STREAM_CONSENT_THRESHOLD: u32 = 500;

/// Bytes on the wire, with gzip, per sample of each requested series an
/// activity's body lists. Measured against the live API on 2026-10-10 over 33
/// activities with a track, fetched with the full request: 2.75 pooled, 2.2 to
/// 3.9 each. Counting the listed series absorbs the derived ones upstream
/// serves without listing (`grade_smooth`, `w_bal`, `fixed_altitude`,
/// `ga_velocity`), and counting samples rather than moving seconds absorbs the
/// recording rate, which moved bytes per moving second from 0.5 to 3.3 over
/// the same activities.
pub const WIRE_BYTES_PER_SERIES_SAMPLE: f64 = 2.75;

/// Bytes on the wire per moving second of one full series request, for an
/// activity whose body says nothing about its series, measured against the
/// live API with gzip (20.5, rounded up).
pub const WIRE_BYTES_PER_MOVING_SECOND: u64 = 21;

/// The settings row holding a recorded yes, so later automatic starts skip the
/// ask.
pub const STREAM_CONSENT_KEY: &str = "__stream_backfill_consent";

/// The settings row holding the athlete's stop: the retention window, in days
/// with zero for keep everything, that the stop was given under. The automatic
/// start stays quiet while the window still reads that. A row of its own, so a
/// stop after a yes leaves the yes for the window that comes next.
pub const STREAM_HOLD_KEY: &str = "__stream_backfill_held";

/// What the stream pass would download, in the units the ask states: the
/// listed series' samples at the per-series rate, and the activities that list
/// none at the flat rate.
pub fn estimate_bytes(series_samples: u64, unlisted_seconds: u64) -> u64 {
    let listed = (series_samples as f64 * WIRE_BYTES_PER_SERIES_SAMPLE).round() as u64;
    listed.saturating_add(unlisted_seconds.saturating_mul(WIRE_BYTES_PER_MOVING_SECOND))
}

/// The owed queue's length and what downloading it would cost, from the one
/// read of its rows. The ask before a large download and the status read at
/// rest both price the queue here, so the card and the row cannot disagree.
pub(crate) fn queue_estimate(conn: &rusqlite::Connection) -> rusqlite::Result<(u64, u64)> {
    let queue = crate::persistence::streams::pooled::backfill_estimate(conn, STREAM_ATTEMPT_LIMIT)?;
    Ok((
        queue.owed as u64,
        estimate_bytes(queue.series_samples, queue.unlisted_seconds),
    ))
}

struct BackfillState {
    running: AtomicBool,
    cancelled: AtomicBool,
    completed: AtomicU32,
    total: AtomicU32,
    stored: AtomicU32,
    failed: AtomicU32,
    estimate_requests: AtomicU32,
    estimate_bytes: AtomicU64,
    /// The phase, and when a waiting one resumes in epoch milliseconds, under
    /// one lock so no reader sees a resume time beside another phase.
    phase: Mutex<(&'static str, Option<i64>)>,
}

static BACKFILL: BackfillState = BackfillState {
    running: AtomicBool::new(false),
    cancelled: AtomicBool::new(false),
    completed: AtomicU32::new(0),
    total: AtomicU32::new(0),
    stored: AtomicU32::new(0),
    failed: AtomicU32::new(0),
    estimate_requests: AtomicU32::new(0),
    estimate_bytes: AtomicU64::new(0),
    phase: Mutex::new((STREAM_PHASE_IDLE, None)),
};

pub(crate) fn set_phase(phase: &'static str) {
    set_phase_resuming(phase, None);
}

/// Settle on [`STREAM_PHASE_WAITING`], resuming at `at`.
fn set_waiting(at: chrono::DateTime<chrono::Utc>) {
    set_phase_resuming(STREAM_PHASE_WAITING, Some(at.timestamp_millis()));
}

fn set_phase_resuming(phase: &'static str, resumes_at_ms: Option<i64>) {
    *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()) = (phase, resumes_at_ms);
    // The guard above is a temporary of the statement it is in, so the
    // announcement is made with the phase lock already released.
    crate::objects::observer::notify(crate::objects::observer::Announcement::StreamBackfillPhase(
        phase.to_string(),
    ));
}

/// What a poller sees while the pass runs and after it settles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamBackfillSnapshot {
    pub phase: &'static str,
    /// Activities this pass has finished with, however they ended.
    pub completed: u32,
    /// Activities the pass started with.
    pub total: u32,
    /// Activities whose series landed in the store.
    pub stored: u32,
    /// Activities whose fetch failed, so they are unchanged and asked again.
    pub failed: u32,
    /// Requests the held pass would make; meaningful while awaiting consent.
    pub estimate_requests: u32,
    /// Bytes on the wire the held pass would download.
    pub estimate_bytes: u64,
    /// When a waiting pass resumes, in epoch milliseconds: the end of the
    /// request budget's deferral or of intervals.icu's refusal. `None` in every
    /// other phase.
    pub resumes_at_ms: Option<i64>,
}

impl StreamBackfillSnapshot {
    /// Whole-percent progress. An empty queue is finished, not zero.
    pub fn percent(&self) -> u32 {
        if self.total == 0 {
            return 100;
        }
        (self.completed.min(self.total) * 100) / self.total
    }
}

/// The current state, safe to read from any thread at any time.
pub fn stream_backfill_progress() -> StreamBackfillSnapshot {
    let (phase, resumes_at_ms) = *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner());
    StreamBackfillSnapshot {
        phase,
        completed: BACKFILL.completed.load(Ordering::Relaxed),
        total: BACKFILL.total.load(Ordering::Relaxed),
        stored: BACKFILL.stored.load(Ordering::Relaxed),
        failed: BACKFILL.failed.load(Ordering::Relaxed),
        estimate_requests: BACKFILL.estimate_requests.load(Ordering::Relaxed),
        estimate_bytes: BACKFILL.estimate_bytes.load(Ordering::Relaxed),
        resumes_at_ms,
    }
}

/// Ask the pass in flight to stop. It ends at its next batch boundary, so the
/// activities already stored stay stored and nothing is half written.
///
/// The queue is derived, so a stopped pass and a crashed one resume
/// identically. What is persisted is the stop itself, in [`STREAM_HOLD_KEY`],
/// so the automatic start leaves the queue alone across launches until the
/// window changes.
///
/// Stopping a pass the engine is holding for the athlete's answer is the no:
/// nothing is fetched, the phase reads stopped, and the automatic start stays
/// quiet until the window changes.
pub fn stop_stream_backfill() {
    BACKFILL.cancelled.store(true, Ordering::SeqCst);
    if BACKFILL.running.load(Ordering::SeqCst) {
        hold_autostart();
    } else if stream_backfill_progress().phase == STREAM_PHASE_AWAITING_CONSENT {
        hold_autostart();
        set_phase(STREAM_PHASE_STOPPED);
    }
}

/// The retention window as the hold records it: days, zero for keep
/// everything.
fn retention_window(conn: &rusqlite::Connection) -> String {
    crate::persistence::streams::pooled::retention_days(conn)
        .unwrap_or(0)
        .to_string()
}

/// Record the athlete's stop under the window it was given in.
fn hold_autostart() {
    let recorded = crate::objects::error::with_engine(|e| {
        let window = retention_window(&e.db);
        e.set_setting(STREAM_HOLD_KEY, &window)
    });
    if !matches!(recorded, Ok(Ok(()))) {
        log::warn!(
            "[StreamBackfill] the stop could not be recorded, so the next sync may ask again"
        );
    }
}

/// Whether a stop holds the automatic start: one was recorded and the window
/// still reads what it was recorded under.
fn autostart_held(conn: &rusqlite::Connection) -> rusqlite::Result<bool> {
    let held = crate::persistence::settings::setting_from(conn, STREAM_HOLD_KEY)?;
    Ok(held.is_some_and(|w| w == retention_window(conn)))
}

/// Lift the hold a stop left. Called when the retention window changes, which
/// is what the stop was about, and on a yes. A window changed and changed
/// back is still a change, which comparing the windows alone would miss.
pub fn release_autostart_hold() {
    let _ = crate::objects::error::with_engine(|e| e.delete_setting(STREAM_HOLD_KEY));
}

/// What the automatic start reads.
#[derive(Debug, Clone, Copy)]
struct AutostartInputs {
    /// Activities inside the window still owing their series.
    owed: u64,
    /// Tracks the elevation backfill still owes.
    elevation_owed: u64,
    /// A detector cutover is owed and has not started.
    cutover_pending: bool,
    /// A detector cutover is running.
    cutover_running: bool,
    /// Route Matching is on, so the elevation backfill and the cutover will
    /// run on their own.
    detection_enabled: bool,
    stopped_by_athlete: bool,
    /// The athlete has said yes to a large download.
    consented: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutostartVerdict {
    Start,
    /// The queue is past the large-download threshold and nothing says yes.
    AwaitingConsent,
    NotOwed,
    /// The elevation backfill or the cutover still has work that will run.
    Deferred,
    /// The athlete stopped the pass and the window has not changed since.
    Held,
}

/// What the athlete's answers say about downloading the series still owed,
/// whichever pass would do it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SeriesPermission {
    /// The athlete stopped the stream pass and the window has not changed
    /// since.
    Held,
    /// The owed queue is past the large-download threshold and nothing says
    /// yes.
    AwaitingConsent,
    Granted,
}

/// The one decision on whether the owed series may be downloaded. The stream
/// pass's automatic start reads it, and so does the elevation pass, which
/// asks a track for its series too only when this grants it.
pub(crate) fn series_permission(
    owed: u64,
    stopped_by_athlete: bool,
    consented: bool,
) -> SeriesPermission {
    if stopped_by_athlete {
        SeriesPermission::Held
    } else if owed > STREAM_CONSENT_THRESHOLD as u64 && !consented {
        SeriesPermission::AwaitingConsent
    } else {
        SeriesPermission::Granted
    }
}

/// The ask comes before the deferral, so a library past the threshold is
/// asked while the elevation pass still runs, and a yes reaches the tracks
/// that pass has not reached yet.
fn autostart_verdict(i: AutostartInputs) -> AutostartVerdict {
    if i.owed == 0 {
        return AutostartVerdict::NotOwed;
    }
    match series_permission(i.owed, i.stopped_by_athlete, i.consented) {
        SeriesPermission::Held => AutostartVerdict::Held,
        SeriesPermission::AwaitingConsent => AutostartVerdict::AwaitingConsent,
        // With Route Matching off neither the elevation backfill nor the
        // cutover runs, so waiting on what they owe is waiting for ever. A
        // cutover already running ends on its own and is still waited out.
        // Elevation is waited on only past the threshold: at or under it the
        // elevation pass asks its tracks for their series itself, and this
        // pass leaves those to it, so both run at once.
        SeriesPermission::Granted
            if i.cutover_running
                || (i.detection_enabled
                    && ((i.elevation_owed > 0 && i.owed > STREAM_CONSENT_THRESHOLD as u64)
                        || i.cutover_pending)) =>
        {
            AutostartVerdict::Deferred
        }
        SeriesPermission::Granted => AutostartVerdict::Start,
    }
}

/// The permission as it stands now, read from the owed queue, the recorded
/// answer and the athlete's stop.
pub(crate) fn current_series_permission(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<SeriesPermission> {
    let owed = crate::persistence::streams::pooled::backfill_remaining(conn, STREAM_ATTEMPT_LIMIT)?;
    let consented = crate::persistence::settings::setting_from(conn, STREAM_CONSENT_KEY)?
        .is_some_and(|v| v == "yes");
    Ok(series_permission(
        owed as u64,
        autostart_held(conn)?,
        consented,
    ))
}

/// Drop everything the process holds in memory, as a relaunch does.
#[cfg(test)]
fn forget_process_state_for_test() {
    BACKFILL.cancelled.store(false, Ordering::SeqCst);
    set_phase(STREAM_PHASE_IDLE);
}

#[cfg(test)]
pub(crate) fn hold_autostart_for_test() {
    hold_autostart();
}

/// Start the pass when the library owes series and nothing else has a claim on
/// the engine first. The one place that decides, called after a successful
/// sync and after a cutover settles. Answers what the start did, so a caller
/// that cares can read it; the others ignore it.
pub fn autostart_stream_backfill() -> Option<FfiStartOutcome> {
    let inputs = crate::objects::error::with_reader(|conn| {
        let (owed, bytes) = queue_estimate(conn)?;
        let elevation_owed =
            crate::net::elevation_backfill::pooled_elevation_backfill_remaining(conn)?;
        let consented = crate::persistence::settings::setting_from(conn, STREAM_CONSENT_KEY)?
            .is_some_and(|v| v == "yes");
        let detection_enabled = crate::persistence::settings::detection_enabled_from(conn);
        let held = autostart_held(conn)?;
        Ok::<_, rusqlite::Error>((
            owed,
            bytes,
            elevation_owed,
            consented,
            detection_enabled,
            held,
        ))
    })
    .ok()?
    .ok()?;
    let verdict = autostart_verdict(AutostartInputs {
        owed: inputs.0,
        elevation_owed: inputs.2,
        cutover_pending: crate::persistence::cutover::cutover_pending(),
        cutover_running: crate::persistence::cutover::cutover_running(),
        detection_enabled: inputs.4,
        stopped_by_athlete: inputs.5,
        consented: inputs.3,
    });
    if !BACKFILL.running.load(Ordering::SeqCst) {
        let phase = stream_backfill_progress().phase;
        let waiting = phase == STREAM_PHASE_AWAITING_CONSENT || phase == STREAM_PHASE_DEFERRED;
        match verdict {
            AutostartVerdict::AwaitingConsent => {
                BACKFILL
                    .estimate_requests
                    .store(inputs.0.try_into().unwrap_or(u32::MAX), Ordering::Relaxed);
                BACKFILL.estimate_bytes.store(inputs.1, Ordering::Relaxed);
                set_phase(STREAM_PHASE_AWAITING_CONSENT);
            }
            // Said rather than left idle, so the row can offer the pass by
            // hand instead of sitting on an owed count with no action. A
            // finished pass's own phase stays, since it says how that pass
            // ended.
            AutostartVerdict::Deferred if phase == STREAM_PHASE_IDLE || waiting => {
                set_phase(STREAM_PHASE_DEFERRED);
            }
            AutostartVerdict::Held | AutostartVerdict::Deferred => {}
            AutostartVerdict::Start | AutostartVerdict::NotOwed if waiting => {
                set_phase(STREAM_PHASE_IDLE);
            }
            AutostartVerdict::Start | AutostartVerdict::NotOwed => {}
        }
    }
    match verdict {
        AutostartVerdict::Start => Some(start_stream_backfill()),
        _ => None,
    }
}

/// Record the athlete's yes to a large download and start the pass. Later
/// automatic starts skip the ask.
///
/// The ask is shown while the elevation pass still runs. A yes given then is
/// recorded and answered `Held`: that pass asks each track it has not reached
/// for its series too, and the automatic start after it takes what is left,
/// so starting here would ask for the same tracks twice.
pub fn consent_stream_backfill() -> FfiStartOutcome {
    let recorded = crate::objects::error::with_engine(|e| e.set_setting(STREAM_CONSENT_KEY, "yes"));
    if !matches!(recorded, Ok(Ok(()))) {
        return FfiStartOutcome::NotReady;
    }
    release_autostart_hold();
    let elevation_owed = crate::objects::error::with_reader(
        crate::net::elevation_backfill::pooled_elevation_backfill_remaining,
    );
    let busy =
        matches!(elevation_owed, Ok(Ok(n)) if n > 0) || crate::persistence::cutover::cutover_held();
    if busy && !BACKFILL.running.load(Ordering::SeqCst) {
        if stream_backfill_progress().phase == STREAM_PHASE_AWAITING_CONSENT {
            set_phase(STREAM_PHASE_IDLE);
        }
        return FfiStartOutcome::Held;
    }
    start_stream_backfill()
}

/// Whether a stop is pending or the pass that honoured one has not been
/// restarted.
pub fn stream_backfill_cancelled() -> bool {
    BACKFILL.cancelled.load(Ordering::SeqCst)
}

/// Holds the single-run slot. Release is structural, so a panic cannot leave
/// the backfill permanently unstartable.
struct RunGuard;

impl Drop for RunGuard {
    fn drop(&mut self) {
        BACKFILL.running.store(false, Ordering::SeqCst);
    }
}

impl RunGuard {
    fn claim() -> Option<Self> {
        BACKFILL
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| RunGuard)
    }
}

/// What one pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StreamBackfillOutcome {
    /// Activities the derived queue held when the pass began.
    pub queued: u32,
    /// Activities whose series are now in the store.
    pub stored: u32,
    /// Activities upstream answered for with nothing to store. Counted against
    /// the activity, so enough of these retire it.
    pub empty: u32,
    /// Activities whose fetch failed. Unchanged, so the next pass asks again.
    pub failed: u32,
}

/// How a call to [`run_stream_backfill`] ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamBackfillRun {
    /// Another pass holds the slot. Nothing was fetched and nothing changed.
    Refused,
    /// The pass ran to the end of its queue.
    Finished(StreamBackfillOutcome),
    /// The pass could not proceed.
    Failed(String),
}

/// Why a pass ended before its queue did.
enum Stopped {
    SignedOut,
    /// Another library was installed under the walk, so what it fetches would
    /// be discarded.
    Superseded,
    /// The credential was rejected, so every remaining request would be too.
    Unauthorized,
    /// [`MAX_CONSECUTIVE_FAILURES`] in a row: there is nothing to work with.
    NothingToWorkWith,
    /// TypeScript says the network is gone.
    Offline,
    /// The athlete stopped it.
    Cancelled,
    /// intervals.icu refused, or the request budget deferred, the walk. It
    /// lifts at `until`, or when the governor's cooldown ends when the
    /// refusal carried no time.
    Refused {
        until: Option<chrono::DateTime<chrono::Utc>>,
    },
}

/// What one activity's ask came back as.
enum Fetched {
    /// Series reduced to the track's index space, ready to store, and what
    /// the answer says about the clock in that space. The series are empty
    /// only when there is a clock that fits the track to store.
    Series(Vec<StreamDto>, TrackClock),
    /// Series of an activity with no track, in the server's own sample index
    /// with the `time` series that addresses it, ready to store.
    Samples(Vec<StreamDto>),
    /// Upstream answered and there is nothing to store: no sensors on the
    /// ride, a body that will not parse, or a track that has since moved.
    Nothing,
    /// The ask did not reach an answer about this activity.
    Failed(NetError),
}

/// Whether this failure says the connection is gone rather than answering for
/// one activity.
///
/// A 404 or a body that will not parse is upstream replying about one
/// activity. Counting those would wedge the queue: it is derived in the same
/// order every pass, so a permanently 404-ing prefix would stop every future
/// pass in the same place.
fn is_connectivity(e: &NetError) -> bool {
    match e {
        NetError::Transport(_) => true,
        NetError::Http { status, .. } => *status >= 500,
        _ => false,
    }
}

/// Whether this failure is upstream answering for the one activity asked
/// about, so the ask counts against it. A refused credential speaks for the
/// whole account and is not counted.
fn says_something_about_the_activity(e: &NetError) -> bool {
    !is_connectivity(e) && !e.is_refusal() && !matches!(e, NetError::Unauthorized)
}

/// One activity's series, reduced to the index space its stored track is in,
/// or kept in the server's own when it has no track.
async fn fetch_one(source: &impl Source, upstream: &str, points: Option<usize>) -> Fetched {
    let bytes = match source
        .streams_bytes(upstream, DEFAULT_STREAM_TYPES, Lane::Backfill.into())
        .await
    {
        Ok(b) => b,
        Err(e) => return Fetched::Failed(e),
    };
    reduce(&bytes, points, upstream)
}

/// What a response body comes to for an activity whose stored track holds
/// `points` samples, or that has no track when `points` is `None`. The whole
/// decision, with no transport in it.
fn reduce(body: &[u8], points: Option<usize>, named: &str) -> Fetched {
    let raw: Vec<StreamDto> = match serde_json::from_slice(body) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[Streams] {} did not parse: {}", named, e);
            return Fetched::Nothing;
        }
    };
    let Some(points) = points else {
        // Coordinates in the answer mean upstream now holds a track this device
        // has not stored, which is the track fetch's to take, so this reads as
        // an answer with nothing to store.
        let series = trackless_series(&raw);
        return if series.is_empty() {
            Fetched::Nothing
        } else {
            Fetched::Samples(series)
        };
    };
    let series = storable_series(&raw);
    // The clock arrived with the series, so storing it spares the section
    // maths a `time,latlng` request of their own.
    let parsed = parse_streams(raw);
    let clock = track_clock(&parsed);
    if series.is_empty() && !matches!(clock, TrackClock::Fits(_)) {
        return Fetched::Nothing;
    }
    // The series and the clock are reduced by the same mask as the
    // coordinates, so the coordinates measure them. A length that no longer
    // matches the stored track is upstream having re-processed the activity,
    // and the stored section indices address the track this device holds.
    if parsed.latlng.len() != points {
        log::info!(
            "[Streams] {} came back covering {} samples, the stored track holds {}, not storing",
            named,
            parsed.latlng.len(),
            points
        );
        return Fetched::Nothing;
    }
    Fetched::Series(series, clock)
}

/// One batch of asks, at [`FETCH_CONCURRENCY`] in flight.
async fn fetch_batch(
    source: &impl Source,
    batch: &[StreamGap],
    upstream: &std::collections::HashMap<String, String>,
) -> Vec<(String, Fetched)> {
    use futures::stream::{self, StreamExt};

    stream::iter(batch.iter().cloned())
        .map(|gap| {
            let named = crate::persistence::origin::upstream_or_key(
                &gap.activity_id,
                upstream.get(&gap.activity_id).map(String::as_str),
            )
            .to_string();
            async move {
                let fetched = fetch_one(source, &named, gap.point_count).await;
                (gap.activity_id, fetched)
            }
        })
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await
}

/// What one batch's store step did.
#[derive(Debug, Default)]
struct Applied {
    /// Activities whose series landed.
    stored: u32,
    /// Activities upstream answered with no series to store.
    empty: u32,
    /// Activities whose clock landed, to announce once the lock is let go.
    clocks: Vec<String>,
}

impl PersistentEngine {
    /// Store one batch's series and count the asks that settled nothing, in one
    /// pass over the engine lock rather than one per activity.
    fn apply_stream_batch(&mut self, results: &[(String, Fetched)]) -> Applied {
        let mut applied = Applied::default();
        for (id, result) in results {
            match result {
                Fetched::Series(series, clock) => {
                    match self.store_track_series(id, series, clock.to_store()) {
                        Ok(clock) => {
                            if clock {
                                applied.clocks.push(id.clone());
                            }
                            if series.is_empty() {
                                applied.empty += 1;
                                if let Err(e) = self.record_stream_backfill_attempt(id) {
                                    log::warn!(
                                        "[Streams] counting the ask for {} failed: {}",
                                        id,
                                        e
                                    );
                                }
                            } else {
                                applied.stored += 1;
                            }
                        }
                        Err(e) => log::warn!("[Streams] storing {} failed: {}", id, e),
                    }
                }
                Fetched::Samples(series) => match self.store_trackless_streams(id, series) {
                    Ok(()) => applied.stored += 1,
                    Err(e) => log::warn!("[Streams] storing {} failed: {}", id, e),
                },
                Fetched::Nothing => {
                    applied.empty += 1;
                    if let Err(e) = self.record_stream_backfill_attempt(id) {
                        log::warn!("[Streams] counting the ask for {} failed: {}", id, e);
                    }
                }
                // A 403 is what a block on the data looks like. It waits for a
                // new version or for the athlete, and never retires.
                Fetched::Failed(NetError::Http { status: 403, .. }) => {
                    log::info!("[Streams] {} withheld by upstream (403)", id);
                    if let Err(e) = self.withhold_stream_backfill(id) {
                        log::warn!("[Streams] withholding {} failed: {}", id, e);
                    }
                }
                Fetched::Failed(e) => {
                    if says_something_about_the_activity(e)
                        && let Err(e) = self.record_stream_backfill_attempt(id)
                    {
                        log::warn!("[Streams] counting the ask for {} failed: {}", id, e);
                    }
                }
            }
        }
        // Once for the batch: the scan is whole-table, and the portions a new
        // clock can time are the ones it finds.
        if !applied.clocks.is_empty() {
            self.backfill_section_performance_cache();
        }
        applied
    }
}

/// Run a pass over the queue, claiming the single-run slot first.
pub fn run_stream_backfill(transport: &Transport, athlete_id: &str) -> StreamBackfillRun {
    let Some(slot) = RunGuard::claim() else {
        log::info!("[Streams] backfill refused: a pass is already in flight");
        return StreamBackfillRun::Refused;
    };
    run_in_slot(
        slot,
        engine_install(),
        &live_source(transport.clone(), athlete_id),
    )
}

fn run_in_slot(_slot: RunGuard, install: u64, session: &LiveSource) -> StreamBackfillRun {
    let run = run_pass(install, session);
    record_run(install, &run);
    run
}

/// The pass's one exit: the last-run summary is written here, from the phase
/// the pass settled on, so no early return can skip it.
fn record_run(install: u64, run: &StreamBackfillRun) {
    let phase = stream_backfill_progress().phase;
    let summary = match run {
        StreamBackfillRun::Refused => return,
        StreamBackfillRun::Failed(_) => JobRun {
            job: BackgroundJob::StreamBackfill,
            finished_at: crate::WholeNumber(now_ms()),
            outcome: RunOutcome::Failed,
            handled: 0,
            added: 0,
            changed: 0,
            retired: 0,
            failed: 0,
        },
        StreamBackfillRun::Finished(outcome) => JobRun {
            job: BackgroundJob::StreamBackfill,
            finished_at: crate::WholeNumber(now_ms()),
            outcome: run_outcome(phase, outcome.failed),
            handled: outcome.queued,
            added: 0,
            changed: outcome.stored,
            retired: 0,
            failed: outcome.failed,
        },
    };
    let _ = with_persistent_engine_for(install, |engine| record_job_run(&engine.db, &summary));
}

/// How a finished pass reads in the last-run summary. A pass that walked its
/// whole queue but left activities for the next one is partial, not complete.
fn run_outcome(phase: &str, failed: u32) -> RunOutcome {
    match phase {
        STREAM_PHASE_STOPPED => RunOutcome::Stopped,
        STREAM_PHASE_WAITING => RunOutcome::Deferred,
        STREAM_PHASE_FAILED => RunOutcome::Failed,
        STREAM_PHASE_COMPLETE if failed == 0 => RunOutcome::Complete,
        _ => RunOutcome::Partial,
    }
}

/// The queue without the activities another pass asks for their series.
fn without_covered<'a>(
    queue: Vec<StreamGap>,
    covered: impl IntoIterator<Item = &'a str>,
) -> Vec<StreamGap> {
    let covered: std::collections::HashSet<&str> = covered.into_iter().collect();
    queue
        .into_iter()
        .filter(|g| !covered.contains(g.activity_id.as_str()))
        .collect()
}

fn run_pass(install: u64, session: &LiveSource) -> StreamBackfillRun {
    // The elevation pass asks a track it owes for its series in the same
    // request, so this pass leaves those tracks to it. Whatever that ask does
    // not settle is still owed afterwards and the next start takes it.
    let covers_series = crate::net::elevation_backfill::elevation_pass_covers_series();
    let queue = match with_persistent_engine_for(install, |engine| -> rusqlite::Result<_> {
        let queue = engine.activities_missing_streams(STREAM_ATTEMPT_LIMIT)?;
        if !covers_series {
            return Ok(queue);
        }
        let covered = engine.tracks_missing_elevation().unwrap_or_default();
        Ok(without_covered(
            queue,
            covered.iter().map(|(id, _)| id.as_str()),
        ))
    }) {
        Some(Ok(queue)) => queue,
        Some(Err(e)) => {
            set_phase(STREAM_PHASE_FAILED);
            return StreamBackfillRun::Failed(format!("queue unreadable: {}", e));
        }
        None => {
            set_phase(STREAM_PHASE_FAILED);
            return StreamBackfillRun::Failed("no engine".to_string());
        }
    };

    BACKFILL.cancelled.store(false, Ordering::SeqCst);
    BACKFILL.total.store(queue.len() as u32, Ordering::Relaxed);
    BACKFILL.completed.store(0, Ordering::Relaxed);
    BACKFILL.stored.store(0, Ordering::Relaxed);
    BACKFILL.failed.store(0, Ordering::Relaxed);
    set_phase(STREAM_PHASE_FETCHING);
    log::info!(
        "[Streams] backfill starting over {} activities",
        queue.len()
    );

    let (outcome, stopped) = drain_queue(install, session, &queue);
    BACKFILL.failed.store(outcome.failed, Ordering::Relaxed);

    match stopped {
        Some(Stopped::SignedOut | Stopped::Superseded) => {
            set_phase(STREAM_PHASE_PARTIAL);
            return StreamBackfillRun::Finished(outcome);
        }
        Some(Stopped::Unauthorized) => {
            set_phase(STREAM_PHASE_FAILED);
            log::warn!("[Streams] backfill stopped: unauthorized");
            crate::runtime::block_on(crate::objects::park_auth_expired(session));
            return StreamBackfillRun::Failed("unauthorized".to_string());
        }
        Some(Stopped::NothingToWorkWith) => {
            set_phase(STREAM_PHASE_PARTIAL);
            log::warn!(
                "[Streams] backfill gave up after {} failures in a row",
                MAX_CONSECUTIVE_FAILURES
            );
        }
        Some(Stopped::Offline) => {
            set_phase(STREAM_PHASE_PARTIAL);
            log::info!("[Streams] backfill stopped: offline");
        }
        Some(Stopped::Cancelled) => {
            set_phase(STREAM_PHASE_STOPPED);
            log::info!("[Streams] backfill stopped by the athlete");
        }
        // Nothing more is sent until the refusal lifts, and the engine's own
        // wake-up starts the next pass then.
        Some(Stopped::Refused { until }) => {
            let at =
                until.unwrap_or_else(|| session.transport().cooldown_lifts_at(chrono::Utc::now()));
            set_waiting(at);
            log::info!("[Streams] backfill stopped: refused until {at}");
            crate::net::resume::resume_at(at);
        }
        None => set_phase(STREAM_PHASE_COMPLETE),
    }

    log::info!(
        "[Streams] backfill finished: {} stored, {} with nothing to store, {} failed, of {} queued",
        outcome.stored,
        outcome.empty,
        outcome.failed,
        outcome.queued
    );
    StreamBackfillRun::Finished(outcome)
}

/// The walk over the queue, with the fetch handed in so every stop condition
/// can be exercised without a transport.
///
/// The cancel read is handed in beside the offline one rather than reached for,
/// because `BACKFILL.cancelled` is process-wide: a walk that read it directly
/// answered to any stop anywhere, which under cargo's parallel runner is the
/// test in the next thread rather than the athlete.
#[cfg(test)]
fn drain_queue_with(
    queue: &[StreamGap],
    fetch: impl FnMut(&[StreamGap]) -> Vec<(String, Fetched)>,
    apply: impl FnMut(&[(String, Fetched)]) -> (u32, u32),
    cancelled: impl FnMut() -> bool,
    offline: impl FnMut() -> bool,
) -> (StreamBackfillOutcome, Option<Stopped>) {
    drain_queue_with_auth(queue, fetch, apply, cancelled, offline, || true, || true)
}

fn drain_queue_with_auth(
    queue: &[StreamGap],
    mut fetch: impl FnMut(&[StreamGap]) -> Vec<(String, Fetched)>,
    mut apply: impl FnMut(&[(String, Fetched)]) -> (u32, u32),
    mut cancelled: impl FnMut() -> bool,
    mut offline: impl FnMut() -> bool,
    mut still_signed_in: impl FnMut() -> bool,
    mut install_current: impl FnMut() -> bool,
) -> (StreamBackfillOutcome, Option<Stopped>) {
    let mut outcome = StreamBackfillOutcome {
        queued: queue.len() as u32,
        ..StreamBackfillOutcome::default()
    };
    let mut consecutive_failures = 0usize;

    for batch in queue.chunks(BATCH) {
        if !install_current() {
            return (outcome, Some(Stopped::Superseded));
        }
        if !still_signed_in() {
            return (outcome, Some(Stopped::SignedOut));
        }
        // Read at the boundary, not only before the walk: a pass that loses the
        // network half way through would otherwise spend the rest of its queue
        // discovering that one request at a time.
        if cancelled() {
            return (outcome, Some(Stopped::Cancelled));
        }
        if offline() {
            return (outcome, Some(Stopped::Offline));
        }

        let results = fetch(batch);

        // A rejected credential rejects every remaining request too.
        if results
            .iter()
            .any(|(_, f)| matches!(f, Fetched::Failed(NetError::Unauthorized)))
        {
            return (outcome, Some(Stopped::Unauthorized));
        }
        // So does a refusal, and it is never counted against the pass: the
        // rows it held are owed and asked again once it lifts.
        let refusals: Vec<&NetError> = results
            .iter()
            .filter_map(|(_, f)| match f {
                Fetched::Failed(e) if e.is_refusal() => Some(e),
                _ => None,
            })
            .collect();
        if !refusals.is_empty() {
            let until = refusals
                .iter()
                .filter_map(|e| match e {
                    NetError::Deferred { until } => Some(*until),
                    _ => None,
                })
                .max();
            let answered: Vec<(String, Fetched)> = results
                .into_iter()
                .filter(|(_, f)| !matches!(f, Fetched::Failed(e) if e.is_refusal()))
                .collect();
            outcome.failed += answered
                .iter()
                .filter(|(_, f)| matches!(f, Fetched::Failed(_)))
                .count() as u32;
            let (stored, empty) = apply(&answered);
            outcome.stored += stored;
            outcome.empty += empty;
            BACKFILL.stored.fetch_add(stored, Ordering::Relaxed);
            return (outcome, Some(Stopped::Refused { until }));
        }

        for (_, result) in &results {
            match result {
                Fetched::Failed(e) if is_connectivity(e) => consecutive_failures += 1,
                _ => consecutive_failures = 0,
            }
        }
        outcome.failed += results
            .iter()
            .filter(|(_, f)| matches!(f, Fetched::Failed(_)))
            .count() as u32;

        let (stored, empty) = apply(&results);
        outcome.stored += stored;
        outcome.empty += empty;
        BACKFILL.stored.fetch_add(stored, Ordering::Relaxed);
        BACKFILL
            .completed
            .fetch_add(batch.len() as u32, Ordering::Relaxed);

        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            return (outcome, Some(Stopped::NothingToWorkWith));
        }
    }

    (outcome, None)
}

fn drain_queue(
    install: u64,
    session: &LiveSource,
    queue: &[StreamGap],
) -> (StreamBackfillOutcome, Option<Stopped>) {
    let ids: Vec<String> = queue.iter().map(|g| g.activity_id.clone()).collect();
    // The URL names the activity upstream, the queue names it locally. Resolved
    // once for the whole pass rather than per fetch, so the dispatch loop never
    // waits on the engine lock.
    let upstream = with_persistent_engine_for(install, |engine| engine.intervals_ids(&ids))
        .unwrap_or_default();

    drain_queue_with_auth(
        queue,
        |batch| crate::runtime::block_on(fetch_batch(session, batch, &upstream)),
        |results| {
            let applied =
                with_persistent_engine_for(install, |engine| engine.apply_stream_batch(results))
                    .unwrap_or_default();
            // With the engine lock let go, so a reader woken by it can take it.
            if !applied.clocks.is_empty() {
                crate::objects::observer::notify(
                    crate::objects::observer::Announcement::TimeStreamsStored(applied.clocks),
                );
            }
            (applied.stored, applied.empty)
        },
        stream_backfill_cancelled,
        crate::net::connectivity::is_offline,
        || crate::objects::sync::still_signed_in(session.account()),
        || engine_install() == install,
    )
}

/// Start a pass on a detached thread using the process credential.
///
/// The verdict names the refusal, so a caller can tell an empty queue, which is
/// the job finished, from a device that is merely offline.
pub fn start_stream_backfill() -> FfiStartOutcome {
    // A count, so it reads through the pool rather than waiting on the write
    // lock behind a sync page: the screen that taps start is on the JS thread.
    let remaining = crate::objects::error::with_reader(|conn| {
        crate::persistence::streams::pooled::backfill_remaining(conn, STREAM_ATTEMPT_LIMIT)
    });
    match remaining {
        Ok(Ok(n)) if n > 0 => {}
        Ok(Ok(_)) => return FfiStartOutcome::NotOwed,
        _ => {
            log::info!("[Streams] backfill deferred: queue unreadable");
            return FfiStartOutcome::NotReady;
        }
    }
    // Claimed here rather than on the thread, so a `Started` means a pass holds
    // the slot: a second start in the same instant is refused rather than
    // spawning alongside.
    let Some(slot) = RunGuard::claim() else {
        return FfiStartOutcome::Busy;
    };
    if crate::net::connectivity::is_offline() {
        log::info!("[Streams] backfill deferred: offline");
        return FfiStartOutcome::Offline;
    }
    let Some(Ok(session)) = crate::objects::current_session() else {
        log::info!("[Streams] backfill deferred: no credential yet");
        return FfiStartOutcome::NotConfigured;
    };

    // Which library this pass belongs to, read here rather than on the worker:
    // a restore installing another database mid-pass would otherwise take
    // streams fetched against the old library's activity ids.
    let install = engine_install();
    let governor = &crate::governor::GOVERNOR;
    governor.arm_backfill_burst(governor.now());
    crate::threads::spawn_named("veloq-streams", move || {
        run_in_slot(slot, install, &session);
    });
    FfiStartOutcome::Started
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected behaviour: a request the budget held back says nothing about
    /// the activity, so it is never counted as an ask for it.
    #[test]
    fn a_deferral_is_never_held_against_the_activity() {
        let deferred = NetError::Deferred {
            until: chrono::Utc::now(),
        };
        assert!(!says_something_about_the_activity(&deferred));
        assert!(!says_something_about_the_activity(&NetError::RateLimited));
    }

    /// Scenario: intervals.icu refuses the pass's first batch, or the budget
    /// defers it.
    ///
    /// Expected behaviour: the walk stops at once with the time the refusal
    /// lifts, asks no further batch, and counts nothing toward the failures
    /// in a row or the pass's failures.
    #[test]
    fn a_refused_batch_stops_the_walk_and_counts_nothing() {
        let until = chrono::Utc::now() + chrono::TimeDelta::minutes(10);
        let mut asked = 0usize;
        let (outcome, stopped) = drain_queue_with(
            &gaps(3 * BATCH),
            |batch| {
                asked += batch.len();
                batch
                    .iter()
                    .map(|g| {
                        (
                            g.activity_id.clone(),
                            Fetched::Failed(NetError::Deferred { until }),
                        )
                    })
                    .collect()
            },
            |_| (0, 0),
            || false,
            || false,
        );
        assert_eq!(asked, BATCH, "the walk asked past the refusal");
        assert!(
            matches!(stopped, Some(Stopped::Refused { until: Some(u) }) if u == until),
            "the walk did not stop on the refusal"
        );
        assert_eq!(outcome.failed, 0);
    }

    fn gaps(n: usize) -> Vec<StreamGap> {
        (0..n)
            .map(|i| StreamGap {
                activity_id: format!("a{i}"),
                point_count: Some(3),
            })
            .collect()
    }

    /// A walk that never touches the network: every batch answers with what the
    /// caller says, and nothing is applied. Nobody stopped it.
    fn walk(
        queue: &[StreamGap],
        answer: impl Fn(&StreamGap) -> Fetched,
    ) -> (StreamBackfillOutcome, Option<Stopped>, usize) {
        walk_with_cancel(queue, answer, || false)
    }

    /// The same walk with its own stop, so the one test about stopping drives a
    /// flag of its own rather than the process-wide one.
    fn walk_with_cancel(
        queue: &[StreamGap],
        answer: impl Fn(&StreamGap) -> Fetched,
        cancelled: impl FnMut() -> bool,
    ) -> (StreamBackfillOutcome, Option<Stopped>, usize) {
        let asked = std::cell::Cell::new(0usize);
        let (outcome, stopped) = drain_queue_with(
            queue,
            |batch| {
                asked.set(asked.get() + batch.len());
                batch
                    .iter()
                    .map(|g| (g.activity_id.clone(), answer(g)))
                    .collect()
            },
            |_| (0, 0),
            cancelled,
            || false,
        );
        (outcome, stopped, asked.get())
    }

    /// Scenario: a sync settles on a library whose activities inside the window
    /// have tracks and no series.
    ///
    /// Expected behaviour: the pass starts by itself, unless nothing is owed,
    /// the elevation backfill or a cutover still has work, or the athlete
    /// stopped the pass and the window has not changed since.
    #[test]
    fn the_automatic_start_waits_for_what_the_cutover_waits_on() {
        let idle = AutostartInputs {
            owed: 245,
            elevation_owed: 0,
            cutover_pending: false,
            cutover_running: false,
            detection_enabled: true,
            stopped_by_athlete: false,
            consented: false,
        };
        assert_eq!(autostart_verdict(idle), AutostartVerdict::Start);
        assert_eq!(
            autostart_verdict(AutostartInputs { owed: 0, ..idle }),
            AutostartVerdict::NotOwed
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                elevation_owed: 1,
                ..idle
            }),
            AutostartVerdict::Start
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                cutover_pending: true,
                ..idle
            }),
            AutostartVerdict::Deferred
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                cutover_running: true,
                ..idle
            }),
            AutostartVerdict::Deferred
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                stopped_by_athlete: true,
                ..idle
            }),
            AutostartVerdict::Held
        );
    }

    /// Scenario: an upgraded library with Route Matching off owes series,
    /// elevation and the detector cutover. With the switch off neither the
    /// elevation backfill nor the cutover will run.
    ///
    /// Expected behaviour: the pass starts rather than deferring to work that
    /// never drains. A cutover already running is still waited out, and with
    /// the switch back on the order is elevation, cutover, then series.
    #[test]
    fn with_route_matching_off_the_automatic_start_waits_for_nothing_that_will_not_run() {
        let off = AutostartInputs {
            owed: 10,
            elevation_owed: 500,
            cutover_pending: true,
            cutover_running: false,
            detection_enabled: false,
            stopped_by_athlete: false,
            consented: false,
        };
        assert_eq!(autostart_verdict(off), AutostartVerdict::Start);
        assert_eq!(
            autostart_verdict(AutostartInputs {
                owed: STREAM_CONSENT_THRESHOLD as u64 + 1,
                ..off
            }),
            AutostartVerdict::AwaitingConsent
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                stopped_by_athlete: true,
                ..off
            }),
            AutostartVerdict::Held
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                cutover_running: true,
                ..off
            }),
            AutostartVerdict::Deferred
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                detection_enabled: true,
                ..off
            }),
            AutostartVerdict::Deferred
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                detection_enabled: true,
                elevation_owed: 0,
                ..off
            }),
            AutostartVerdict::Deferred
        );
    }

    /// Scenario: a library upgrades with more activities owing series than the
    /// large-download threshold.
    ///
    /// Expected behaviour: at the threshold the pass starts; one past it the
    /// start holds for the athlete's answer. A recorded yes starts at any
    /// size, and a stop still outranks the ask. Other work in flight does
    /// not: the ask comes first, so a yes reaches the elevation pass while it
    /// still has tracks to ask for their series, and a yes still waits for
    /// that work before the pass itself starts.
    #[test]
    fn a_queue_past_the_large_download_threshold_asks_before_it_starts() {
        let at = AutostartInputs {
            owed: STREAM_CONSENT_THRESHOLD as u64,
            elevation_owed: 0,
            cutover_pending: false,
            cutover_running: false,
            detection_enabled: true,
            stopped_by_athlete: false,
            consented: false,
        };
        assert_eq!(autostart_verdict(at), AutostartVerdict::Start);
        let past = AutostartInputs {
            owed: STREAM_CONSENT_THRESHOLD as u64 + 1,
            ..at
        };
        assert_eq!(autostart_verdict(past), AutostartVerdict::AwaitingConsent);
        assert_eq!(
            autostart_verdict(AutostartInputs {
                consented: true,
                ..past
            }),
            AutostartVerdict::Start
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                stopped_by_athlete: true,
                ..past
            }),
            AutostartVerdict::Held
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                elevation_owed: 1,
                ..past
            }),
            AutostartVerdict::AwaitingConsent
        );
        assert_eq!(
            autostart_verdict(AutostartInputs {
                elevation_owed: 1,
                consented: true,
                ..past
            }),
            AutostartVerdict::Deferred
        );
    }

    /// Scenario: an upgraded library at or under the large-download threshold
    /// owes elevation and series with Route Matching on.
    ///
    /// Expected behaviour: the series pass starts beside the elevation pass
    /// rather than behind it. Past the threshold with a yes the deferral
    /// stays, and a pending or running cutover is still waited out.
    #[test]
    fn at_or_under_the_threshold_the_series_pass_does_not_wait_for_elevation() {
        let upgraded = AutostartInputs {
            owed: STREAM_CONSENT_THRESHOLD as u64,
            elevation_owed: 212,
            cutover_pending: false,
            cutover_running: false,
            detection_enabled: true,
            stopped_by_athlete: false,
            consented: false,
        };
        assert_eq!(autostart_verdict(upgraded), AutostartVerdict::Start);
        assert_eq!(
            autostart_verdict(AutostartInputs {
                cutover_pending: true,
                ..upgraded
            }),
            AutostartVerdict::Deferred
        );
    }

    /// Scenario: the elevation pass asks the tracks it owes for their series
    /// in the same request.
    ///
    /// Expected behaviour: the series pass leaves those activities out of its
    /// walk and keeps the rest in order.
    #[test]
    fn the_series_walk_leaves_out_what_the_elevation_pass_asks() {
        let queue = gaps(4);
        let covered = [queue[1].activity_id.clone(), queue[3].activity_id.clone()];
        let kept = without_covered(queue.clone(), covered.iter().map(String::as_str));
        let ids: Vec<_> = kept.iter().map(|g| g.activity_id.clone()).collect();
        assert_eq!(
            ids,
            vec![queue[0].activity_id.clone(), queue[2].activity_id.clone()]
        );
        assert_eq!(without_covered(queue.clone(), []).len(), 4);
    }

    /// Scenario: the stream pass and the elevation pass both read whether the
    /// owed series may be downloaded.
    ///
    /// Expected behaviour: one answer for both. A stop holds it at any size,
    /// past the threshold it waits for a yes, and at or under it, or with a
    /// yes, it is granted.
    #[test]
    fn the_series_permission_is_the_athletes_answers_alone() {
        let threshold = STREAM_CONSENT_THRESHOLD as u64;
        assert_eq!(series_permission(1, true, true), SeriesPermission::Held);
        assert_eq!(
            series_permission(threshold + 1, false, false),
            SeriesPermission::AwaitingConsent
        );
        assert_eq!(
            series_permission(threshold, false, false),
            SeriesPermission::Granted
        );
        assert_eq!(
            series_permission(threshold + 1, false, true),
            SeriesPermission::Granted
        );
    }

    /// Scenario: the card shows the size of the download it asks about.
    ///
    /// Expected behaviour: listed series' samples are priced at the per-series
    /// rate and unlisted moving seconds at the flat rate, and the two add.
    #[test]
    fn the_estimate_prices_samples_and_unlisted_seconds_at_their_rates() {
        assert_eq!(estimate_bytes(0, 0), 0);
        assert_eq!(estimate_bytes(0, 1000), 1000 * WIRE_BYTES_PER_MOVING_SECOND);
        assert_eq!(
            estimate_bytes(4000, 0),
            (4000.0 * WIRE_BYTES_PER_SERIES_SAMPLE).round() as u64
        );
        assert_eq!(
            estimate_bytes(4000, 1000),
            estimate_bytes(4000, 0) + estimate_bytes(0, 1000)
        );
        assert_eq!(estimate_bytes(u64::MAX, u64::MAX), u64::MAX);
    }

    /// Whether the automatic start reads as held, from the stored rows.
    fn held() -> bool {
        crate::objects::error::with_reader(autostart_held)
            .expect("reader")
            .expect("hold")
    }

    /// Scenario: the athlete answers the ask.
    ///
    /// Expected behaviour: a stop while the pass is held holds the automatic
    /// start until the window changes and reads as stopped, not as still asking.
    #[test]
    fn stopping_a_held_pass_is_the_no_and_holds_the_automatic_start() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        release_autostart_hold();
        set_phase(STREAM_PHASE_AWAITING_CONSENT);
        stop_stream_backfill();
        assert!(held());
        assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_STOPPED);
        release_autostart_hold();
        BACKFILL.cancelled.store(false, Ordering::SeqCst);
        set_phase(STREAM_PHASE_IDLE);
    }

    /// Scenario: a sync settles on an upgraded library that owes series and
    /// elevation, first with Route Matching on and then with it off.
    ///
    /// Expected behaviour: on, a queue at or under the threshold starts beside
    /// the elevation pass and never reads deferred; off, it asks for the pass
    /// all the same.
    #[test]
    fn the_automatic_start_says_it_defers_and_stops_deferring_with_route_matching_off() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::net::connectivity::reset();
        release_autostart_hold();
        set_phase(STREAM_PHASE_IDLE);
        crate::persistence::with_persistent_engine(|e| e.set_stream_retention_days(0))
            .expect("engine")
            .expect("keep every series");
        let (owed, elevation_owed) = crate::objects::error::with_reader(|conn| {
            (
                queue_estimate(conn).expect("series queue").0,
                crate::net::elevation_backfill::pooled_elevation_backfill_remaining(conn)
                    .expect("elevation queue"),
            )
        })
        .expect("reader");
        assert!(owed > 0 && elevation_owed > 0);

        assert!(
            autostart_stream_backfill().is_some(),
            "a small queue starts beside the elevation pass"
        );
        assert_ne!(stream_backfill_progress().phase, STREAM_PHASE_DEFERRED);

        crate::persistence::with_persistent_engine(|e| e.set_detection_enabled(false))
            .expect("engine")
            .expect("switch");
        assert_eq!(
            autostart_stream_backfill(),
            Some(FfiStartOutcome::NotConfigured),
            "the pass is asked for and refuses only for want of a credential"
        );
        assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_IDLE);
    }

    /// Scenario: the athlete answers Not now to the ask, the app is closed,
    /// and the next launch's first sync settles under the same window. Then
    /// the athlete changes the window.
    ///
    /// Expected behaviour: the no outlives the process, so the automatic start
    /// stays quiet and does not ask again; a changed window asks again.
    #[test]
    fn not_now_survives_a_relaunch_until_the_window_changes() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        crate::net::connectivity::reset();
        release_autostart_hold();
        crate::persistence::with_persistent_engine(|e| e.set_stream_retention_days(0))
            .expect("engine")
            .expect("keep every series");
        let permission = || {
            crate::objects::error::with_reader(current_series_permission)
                .expect("reader")
                .expect("permission")
        };

        set_phase(STREAM_PHASE_AWAITING_CONSENT);
        stop_stream_backfill();
        forget_process_state_for_test();

        assert_eq!(permission(), SeriesPermission::Held);
        assert_eq!(autostart_stream_backfill(), None);
        assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_IDLE);

        crate::persistence::with_persistent_engine(|e| e.set_stream_retention_days(30))
            .expect("engine")
            .expect("narrow the window");
        assert_ne!(permission(), SeriesPermission::Held);

        crate::persistence::with_persistent_engine(|e| e.set_stream_retention_days(0))
            .expect("engine")
            .expect("widen the window");
        release_autostart_hold();
        assert_ne!(
            permission(),
            SeriesPermission::Held,
            "a window changed and changed back is still a change"
        );
        set_phase(STREAM_PHASE_IDLE);
    }

    /// Scenario: the athlete says yes to the ask while the elevation pass
    /// still has tracks owed.
    ///
    /// Expected behaviour: the yes is recorded for later automatic starts, the
    /// ask is cleared, and no second pass starts beside the elevation one.
    #[test]
    fn a_yes_given_while_elevation_is_owed_is_recorded_and_starts_nothing() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        release_autostart_hold();
        set_phase(STREAM_PHASE_AWAITING_CONSENT);
        let elevation_owed = crate::objects::error::with_reader(
            crate::net::elevation_backfill::pooled_elevation_backfill_remaining,
        )
        .expect("reader")
        .expect("elevation queue");
        assert!(elevation_owed > 0);

        assert_eq!(consent_stream_backfill(), FfiStartOutcome::Held);

        let consent = crate::objects::error::with_reader(|conn| {
            crate::persistence::settings::setting_from(conn, STREAM_CONSENT_KEY)
        })
        .expect("reader")
        .expect("setting");
        assert_eq!(consent.as_deref(), Some("yes"));
        assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_IDLE);
        assert!(!BACKFILL.running.load(Ordering::SeqCst));
    }

    /// Scenario: the athlete stops a running pass, then widens the window.
    ///
    /// Expected behaviour: the stop holds the automatic start until the window
    /// changes, and a stop with no pass running holds nothing.
    #[test]
    fn a_stop_holds_the_automatic_start_until_the_window_changes() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        release_autostart_hold();
        stop_stream_backfill();
        assert!(!held(), "no pass was running, so nothing is held");

        BACKFILL.running.store(true, Ordering::SeqCst);
        stop_stream_backfill();
        BACKFILL.running.store(false, Ordering::SeqCst);
        assert!(held());

        release_autostart_hold();
        assert!(!held());
        BACKFILL.cancelled.store(false, Ordering::SeqCst);
    }

    /// Scenario: a restore installs another library while a walk is part way
    /// through its queue.
    ///
    /// Expected behaviour: the walk ends at the next batch boundary and the
    /// activities behind it are never fetched.
    #[test]
    fn a_restore_mid_walk_ends_it_before_the_next_batch() {
        let queue = gaps(BATCH * 3);
        let asked = std::cell::Cell::new(0usize);
        let installed = std::cell::Cell::new(true);

        let (_, stopped) = drain_queue_with_auth(
            &queue,
            |batch| {
                asked.set(asked.get() + batch.len());
                installed.set(false);
                batch
                    .iter()
                    .map(|g| (g.activity_id.clone(), Fetched::Nothing))
                    .collect()
            },
            |_| (0, 0),
            || false,
            || false,
            || true,
            || installed.get(),
        );

        assert!(matches!(stopped, Some(Stopped::Superseded)));
        assert_eq!(asked.get(), BATCH);
    }

    /// Scenario: 34 MB on a phone connection is not a silent operation, so the
    /// athlete can stop it. `drain_queue` gives the walk
    /// `stream_backfill_cancelled` as its stop; this gives it one of its own.
    ///
    /// Expected behaviour: the stop lands at the next batch boundary, so the
    /// activities behind it are never asked and the ones already stored stay
    /// stored.
    #[test]
    fn a_stop_leaves_the_rest_of_the_queue_unasked() {
        let queue = gaps(BATCH * 3);

        let (_, stopped, asked) = walk_with_cancel(&queue, |_| Fetched::Nothing, || true);

        assert!(matches!(stopped, Some(Stopped::Cancelled)));
        assert_eq!(asked, 0, "the stop is read before the batch, not after it");
    }

    /// Scenario: cargo runs this module's tests on parallel threads, and
    /// stopping the backfill sets a process-wide flag.
    ///
    /// Expected behaviour: a walk nobody asked to stop reaches the end of its
    /// queue while that flag is set. It used to read the same static, so on
    /// 2026-09-19 three walks beside the stop test failed on one run of the
    /// crate and passed on the two after, and passed every time the module was
    /// run alone.
    ///
    /// This is the one walk that drives the process-wide flag. It takes the
    /// crate lock because a real pass in the `pass` tests below clears that
    /// flag when it starts, and would otherwise clear this stop before it is
    /// read.
    #[test]
    fn a_walk_nobody_stopped_ignores_another_pass_cancel() {
        let _serial = crate::test_globals::serial_global_state();
        let queue = gaps(BATCH * 2);
        stop_stream_backfill();
        let pending = stream_backfill_cancelled();

        let (outcome, stopped, asked) = walk(&queue, |_| Fetched::Nothing);

        BACKFILL.cancelled.store(false, Ordering::SeqCst);
        assert!(pending, "the stop reached the flag the running pass reads");
        assert!(
            stopped.is_none(),
            "and the walk beside it finished its queue"
        );
        assert_eq!(asked, queue.len());
        assert_eq!(outcome.queued, queue.len() as u32);
    }

    /// A rejected credential rejects every remaining request too, so spending
    /// the rest of the library on 401s helps nobody.
    #[test]
    fn a_rejected_credential_ends_the_pass_at_that_batch() {
        let queue = gaps(BATCH * 3);

        let (_, stopped, asked) = walk(&queue, |_| Fetched::Failed(NetError::Unauthorized));

        assert!(matches!(stopped, Some(Stopped::Unauthorized)));
        assert_eq!(asked, BATCH, "one batch asked, the other two left alone");
    }

    /// A whole batch that came back with nothing to work with is the connection
    /// being gone, which no partial outage produces.
    #[test]
    fn a_batch_of_connection_failures_ends_the_pass() {
        let queue = gaps(BATCH * 3);

        let (outcome, stopped, asked) = walk(&queue, |_| {
            Fetched::Failed(NetError::Transport("no route".to_string()))
        });

        assert!(matches!(stopped, Some(Stopped::NothingToWorkWith)));
        assert_eq!(asked, BATCH);
        assert_eq!(
            outcome.failed, BATCH as u32,
            "their rows are untouched, so the next pass asks about them again"
        );
    }

    /// Scenario: a prefix of the queue that upstream permanently 404s. The
    /// queue is derived in the same order every pass, so counting those as the
    /// connection being gone would stop every future pass in the same place.
    ///
    /// Expected behaviour: an answer about one activity never ends the pass.
    #[test]
    fn a_404_answers_for_one_activity_and_does_not_wedge_the_queue() {
        let queue = gaps(BATCH * 2);

        let (outcome, stopped, asked) = walk(&queue, |_| {
            Fetched::Failed(NetError::Http {
                status: 404,
                body: String::new(),
            })
        });

        assert!(stopped.is_none(), "the walk reached the end of its queue");
        assert_eq!(asked, queue.len());
        assert_eq!(outcome.queued, queue.len() as u32);
    }

    fn engine_holding(id: &str) -> (tempfile::TempDir, PersistentEngine) {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let track = (0..4)
            .map(|i| tracematch::GpsPoint::new(46.2 + i as f64 * 0.001, 7.35))
            .collect();
        engine
            .add_activity(id.to_string(), track, "Ride".into())
            .unwrap();
        (dir, engine)
    }

    fn still_owed(engine: &PersistentEngine) -> usize {
        engine
            .stream_backfill_remaining(STREAM_ATTEMPT_LIMIT)
            .unwrap()
    }

    /// Scenario: upstream answers 404 or another 4xx for one activity on every
    /// pass.
    ///
    /// Expected behaviour: each answer counts against the activity, so after
    /// `STREAM_ATTEMPT_LIMIT` passes it leaves the queue and the backfill can
    /// report finished.
    #[test]
    fn an_answer_about_one_activity_retires_it_after_the_attempt_limit() {
        for status in [404, 410, 422] {
            let (_dir, mut engine) = engine_holding("a1");
            for _ in 0..STREAM_ATTEMPT_LIMIT {
                assert_eq!(still_owed(&engine), 1, "status {status}");
                engine.apply_stream_batch(&[(
                    "a1".to_string(),
                    Fetched::Failed(NetError::Http {
                        status,
                        body: String::new(),
                    }),
                )]);
            }
            assert_eq!(still_owed(&engine), 0, "status {status}");
        }
    }

    fn refused(status: u16) -> Vec<(String, Fetched)> {
        vec![(
            "a1".to_string(),
            Fetched::Failed(NetError::Http {
                status,
                body: String::new(),
            }),
        )]
    }

    fn set_census_version(engine: &mut PersistentEngine, version: &str) {
        let entry = crate::net::types::ActivityCensusEntry {
            id: "a1".to_string(),
            icu_sync_date: Some(version.to_string()),
            has_latlng: true,
            ..Default::default()
        };
        engine.record_activity_census("i1", &[entry]).unwrap();
    }

    /// Scenario: upstream answers 403 for one activity's series.
    ///
    /// Expected behaviour: it is withheld, not counted as an attempt. It
    /// leaves the queue on the first answer, however many passes follow, and
    /// does not count as retired.
    #[test]
    fn a_403_withholds_the_series_without_counting_an_attempt() {
        let (_dir, mut engine) = engine_holding("a1");
        engine.apply_stream_batch(&refused(403));
        assert_eq!(still_owed(&engine), 0);
        let attempts: i64 = engine
            .db
            .query_row(
                "SELECT COALESCE(SUM(attempts), 0) FROM activity_stream_backfill",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(attempts, 0);
    }

    /// Scenario: a series was withheld or retired at one version of the
    /// activity, and a sync then meets another.
    ///
    /// Expected behaviour: it is owed again. With the version unmoved, or
    /// never recorded, it stays out. The athlete asking again frees the
    /// withheld ones alone.
    #[test]
    fn a_new_upstream_version_asks_a_withheld_or_retired_series_again() {
        for status in [403, 404] {
            let (_dir, mut engine) = engine_holding("a1");
            set_census_version(&mut engine, "v1");
            for _ in 0..STREAM_ATTEMPT_LIMIT {
                engine.apply_stream_batch(&refused(status));
            }
            assert_eq!(still_owed(&engine), 0, "status {status}");
            set_census_version(&mut engine, "v1");
            assert_eq!(still_owed(&engine), 0, "status {status}");

            set_census_version(&mut engine, "v2");
            assert_eq!(still_owed(&engine), 1, "status {status}");
        }
    }

    #[test]
    fn asking_again_frees_the_withheld_series_and_not_the_retired() {
        let (_dir, mut engine) = engine_holding("a1");
        engine.apply_stream_batch(&refused(403));
        assert_eq!(engine.release_withheld_downloads().unwrap(), 1);
        assert_eq!(still_owed(&engine), 1);

        for _ in 0..STREAM_ATTEMPT_LIMIT {
            engine.apply_stream_batch(&refused(404));
        }
        assert_eq!(engine.release_withheld_downloads().unwrap(), 0);
        assert_eq!(still_owed(&engine), 0);
    }

    /// Scenario: the connection drops, the rate limit bites, upstream errors
    /// or the credential is refused.
    ///
    /// Expected behaviour: nothing is said about the activity, so it stays
    /// owed however many passes fail this way.
    #[test]
    fn a_failure_that_says_nothing_about_the_activity_never_retires_it() {
        let failures = || {
            vec![
                NetError::Transport("no route".to_string()),
                NetError::RateLimited,
                NetError::Unauthorized,
                NetError::Http {
                    status: 503,
                    body: String::new(),
                },
            ]
        };
        let (_dir, mut engine) = engine_holding("a1");
        for _ in 0..=STREAM_ATTEMPT_LIMIT {
            for e in failures() {
                engine.apply_stream_batch(&[("a1".to_string(), Fetched::Failed(e))]);
            }
        }
        assert_eq!(still_owed(&engine), 1);
    }

    fn body(series: &[(&str, &str)]) -> Vec<u8> {
        let json: Vec<_> = series
            .iter()
            .map(|(kind, data)| format!("{{\"type\":\"{}\",\"data\":{}}}", kind, data))
            .collect();
        format!("[{}]", json.join(",")).into_bytes()
    }

    /// `latlng` carries lat in `data` and lng in `data2`, so a test body has to
    /// be shaped the way the wire shapes it or the mask comes out empty.
    fn latlng(n: usize) -> String {
        let lats: Vec<String> = (0..n).map(|i| format!("{}.0", 40 + i)).collect();
        let lngs: Vec<String> = (0..n).map(|i| format!("{}.0", 7 + i)).collect();
        format!("[{}],\"data2\":[{}]", lats.join(","), lngs.join(","))
    }

    /// Expected behaviour: one activity's series are asked for on its streams
    /// path with the detail screen's full set of types, and the answer comes
    /// back reduced to the stored track ready to store.
    #[test]
    fn one_activity_is_asked_for_with_the_detail_types() {
        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use httpmock::prelude::*;

        let server = MockServer::start();
        let answer = body(&[("latlng", &latlng(4)), ("watts", "[100,110,120,130]")]);
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/activity/i3/streams.json")
                .query_param("types", DEFAULT_STREAM_TYPES);
            then.status(200).body(answer);
        });
        let gov = std::sync::Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), gov).unwrap();
        let session = live_source(transport, "1");

        let fetched = crate::runtime::block_on(fetch_one(&session, "i3", Some(4)));

        mock.assert();
        let Fetched::Series(series, _) = fetched else {
            panic!("the answer was not reduced to series to store");
        };
        assert!(series.iter().any(|s| s.kind == "watts"));
    }

    /// Scenario: upstream re-processed an activity after this device stored its
    /// track. Its series are in a different index space, and every stored
    /// section index addresses the space the device holds.
    ///
    /// Expected behaviour: nothing is stored. Re-ingesting a moved track is the
    /// elevation pass's business, because it invalidates the catalogue.
    #[test]
    fn a_track_that_moved_upstream_stores_nothing() {
        let body = body(&[("latlng", &latlng(4)), ("watts", "[100,110,120,130]")]);

        assert!(matches!(reduce(&body, Some(4), "a1"), Fetched::Series(..)));
        assert!(
            matches!(reduce(&body, Some(3), "a1"), Fetched::Nothing),
            "the stored track holds three samples, the answer covers four"
        );
    }

    /// The coordinates are already on the device, but the ask carries them
    /// anyway: they define the index space every other series is reduced to. A
    /// response without them has no mask, so nothing in it can be addressed
    /// against the stored track.
    #[test]
    fn a_response_without_coordinates_has_no_index_space_to_store_in() {
        let body = body(&[("watts", "[100,110,120]")]);

        assert!(matches!(reduce(&body, Some(3), "a1"), Fetched::Nothing));
    }

    /// An activity with no track has no mask and no track length to match, so
    /// its series are kept in the server's own sample index, with the `time`
    /// series that addresses them.
    #[test]
    fn a_trackless_answer_keeps_its_series_in_the_servers_sample_index() {
        let body = body(&[("time", "[0,1,2]"), ("heartrate", "[90,null,95]")]);

        let Fetched::Samples(series) = reduce(&body, None, "a1") else {
            panic!("a trackless answer with heart rate is something to store");
        };
        assert_eq!(
            series.iter().map(|s| s.kind.as_str()).collect::<Vec<_>>(),
            vec!["time", "heartrate"]
        );
        assert_eq!(series[1].data, vec![Some(90.0), None, Some(95.0)]);
    }

    /// A trackless answer holding only its clock, or nothing at all, is
    /// upstream answering with nothing to store, so the ask is counted. So is
    /// one that now carries coordinates: that track is the track fetch's.
    #[test]
    fn a_trackless_answer_with_nothing_beyond_its_clock_stores_nothing() {
        for series in [
            vec![("time", "[0,1,2]")],
            vec![],
            vec![("heartrate", "[90,91,92]")],
        ] {
            let body = body(&series);
            assert!(
                matches!(reduce(&body, None, "a1"), Fetched::Nothing),
                "{series:?}"
            );
        }
        let gained = latlng(3);
        let body = body(&[
            ("time", "[0,1,2]"),
            ("latlng", &gained),
            ("heartrate", "[90,91,92]"),
        ]);
        assert!(matches!(reduce(&body, None, "a1"), Fetched::Nothing));
    }

    /// A ride recorded with no sensors carries nothing beyond the track. It
    /// must read as upstream answering, so the ask is counted and the activity
    /// eventually retires, rather than as a failure that is retried for ever.
    #[test]
    fn a_ride_with_no_sensors_reads_as_an_answer_not_a_failure() {
        let body = body(&[("latlng", &latlng(3))]);

        assert!(matches!(reduce(&body, Some(3), "a1"), Fetched::Nothing));
    }

    /// An empty queue is finished, not stalled at zero per cent.
    #[test]
    fn an_empty_queue_reads_as_finished() {
        let snapshot = StreamBackfillSnapshot {
            phase: STREAM_PHASE_COMPLETE,
            completed: 0,
            total: 0,
            stored: 0,
            failed: 0,
            estimate_requests: 0,
            estimate_bytes: 0,
            resumes_at_ms: None,
        };
        assert_eq!(snapshot.percent(), 100);
    }

    /// Progress never reads past the end, even when a pass counts more
    /// activities finished than it queued.
    #[test]
    fn progress_is_whole_percent_and_capped_at_the_queue() {
        let snapshot = |completed, total| StreamBackfillSnapshot {
            phase: STREAM_PHASE_FETCHING,
            completed,
            total,
            stored: 0,
            failed: 0,
            estimate_requests: 0,
            estimate_bytes: 0,
            resumes_at_ms: None,
        };
        assert_eq!(snapshot(1, 3).percent(), 33);
        assert_eq!(snapshot(7, 5).percent(), 100);
    }

    /// Whole passes through `run_stream_backfill` and `start_stream_backfill`
    /// against the process-wide engine and a local mock upstream. They hold the
    /// crate lock: the engine, the connectivity state, the credential and the
    /// single-run slot are all process-wide.
    mod pass {
        use super::*;
        use crate::governor::{AuthMethod, Governor, NoopPolicy};
        use crate::net::connectivity;
        use crate::persistence::with_persistent_engine;
        use crate::test_globals::{init_global_engine, serial_global_state};
        use httpmock::prelude::*;
        use std::sync::Arc;
        use tempfile::TempDir;
        use tracematch::GpsPoint;

        const POINTS: usize = 8;

        fn transport(server: &MockServer) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov).unwrap()
        }

        fn track(seed: f64) -> Vec<GpsPoint> {
            (0..POINTS)
                .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
                .collect()
        }

        /// A fresh process-wide engine holding one track per id, none with
        /// streams, so every id is in the derived queue.
        fn engine_with(ids: &[&str]) -> TempDir {
            let tmp = init_global_engine("stream_backfill.db");
            crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
                .expect("test credential");
            with_persistent_engine(|engine| {
                for (i, id) in ids.iter().enumerate() {
                    engine
                        .add_activity(id.to_string(), track(i as f64 * 0.05), "Ride".into())
                        .expect("add activity");
                }
            })
            .expect("engine");
            tmp
        }

        fn queue() -> Vec<String> {
            let mut ids: Vec<String> =
                with_persistent_engine(|e| e.activities_missing_streams(STREAM_ATTEMPT_LIMIT))
                    .expect("engine")
                    .expect("queue")
                    .into_iter()
                    .map(|g| g.activity_id)
                    .collect();
            ids.sort();
            ids
        }

        fn serves<'a>(
            server: &'a MockServer,
            upstream: &str,
            series: &[(&str, &str)],
        ) -> httpmock::Mock<'a> {
            let body = body(series);
            let path = format!("/activity/{upstream}/streams.json");
            server.mock(|when, then| {
                when.method(GET).path(path);
                then.status(200).body(body);
            })
        }

        fn watts() -> String {
            format!("[{}]", ["150"; POINTS].join(","))
        }

        /// Scenario: one pass over a queue holding an activity with sensors, a
        /// ride with none, an activity upstream refuses, and a ride the device
        /// recorded that an upload later gave an intervals.icu id.
        ///
        /// Expected behaviour: the series land for both activities with
        /// sensors and take them out of the queue, the sensorless ride is
        /// counted as answered, the refusal is counted as failed and left
        /// unchanged, and the recorded ride is asked for under the id upstream
        /// knows it by rather than the device's own key.
        #[test]
        fn a_pass_stores_what_upstream_carries_and_counts_what_it_does_not() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1", "i2", "i3", "local-rec"]);
            with_persistent_engine(|e| e.record_upload("local-rec", "i77"))
                .expect("engine")
                .expect("upload recorded");

            let server = MockServer::start();
            let sensors = serves(
                &server,
                "i1",
                &[("latlng", &latlng(POINTS)), ("watts", &watts())],
            );
            let bare = serves(&server, "i2", &[("latlng", &latlng(POINTS))]);
            let refused = server.mock(|when, then| {
                when.method(GET).path("/activity/i3/streams.json");
                then.status(404);
            });
            let uploaded = serves(
                &server,
                "i77",
                &[("latlng", &latlng(POINTS)), ("watts", &watts())],
            );
            let by_local_key = server.mock(|when, then| {
                when.method(GET).path("/activity/local-rec/streams.json");
                then.status(500);
            });

            let run = run_stream_backfill(&transport(&server), "1");

            assert_eq!(
                run,
                StreamBackfillRun::Finished(StreamBackfillOutcome {
                    queued: 4,
                    stored: 2,
                    empty: 1,
                    failed: 1,
                })
            );
            sensors.assert_calls(1);
            bare.assert_calls(1);
            refused.assert_calls(1);
            uploaded.assert_calls(1);
            by_local_key.assert_calls(0);
            assert_eq!(
                queue(),
                vec!["i2".to_string(), "i3".to_string()],
                "stored rows take an activity out of the queue on their own"
            );
            let progress = stream_backfill_progress();
            assert_eq!(progress.phase, STREAM_PHASE_COMPLETE);
            assert_eq!((progress.completed, progress.total), (4, 4));
            assert_eq!((progress.stored, progress.failed), (2, 1));
            assert_eq!(progress.percent(), 100);
        }

        /// Scenario: a strength session recorded with heart rate and no
        /// coordinates sits inside the window beside a ride with a track, and
        /// the census says upstream holds a series for it.
        ///
        /// Expected behaviour: one pass asks about both and stores both, the
        /// session's heart rate with the clock that indexes it, and the detail
        /// selection is then answered from the device with no track and no
        /// cached body.
        #[test]
        fn a_pass_stores_a_trackless_activitys_series_for_the_detail_screen() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1"]);
            with_persistent_engine(|e| {
                e.db.execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES ('i9', 'WeightTraining', 0, 0, 0, 0, strftime('%s', 'now') - 86400)",
                    [],
                )
                .expect("trackless activity");
                e.record_activity_census(
                    "1",
                    &[crate::net::types::ActivityCensusEntry {
                        id: "i9".to_string(),
                        start_date_local: Some("2026-09-01T08:00:00".to_string()),
                        has_series: true,
                        ..Default::default()
                    }],
                )
                .expect("census");
            })
            .expect("engine");

            let server = MockServer::start();
            let ride = serves(
                &server,
                "i1",
                &[("latlng", &latlng(POINTS)), ("watts", &watts())],
            );
            let gym = serves(
                &server,
                "i9",
                &[("time", "[0,1,2,3]"), ("heartrate", "[90,95,100,104]")],
            );

            let run = run_stream_backfill(&transport(&server), "1");

            assert_eq!(
                run,
                StreamBackfillRun::Finished(StreamBackfillOutcome {
                    queued: 2,
                    stored: 2,
                    empty: 0,
                    failed: 0,
                })
            );
            ride.assert_calls(1);
            gym.assert_calls(1);
            assert!(queue().is_empty());

            let detail = "altitude,cadence,distance,fixed_altitude,ga_velocity,grade_smooth,\
                          heartrate,latlng,temp,time,velocity_smooth,w_bal,watts";
            let raw = with_persistent_engine(|e| e.read_stream_body("i9", detail))
                .expect("engine")
                .expect("read")
                .expect("the session's chart is on the device");
            let items: Vec<StreamDto> = serde_json::from_str(&raw).expect("a stream array");
            let of = |kind: &str| {
                items
                    .iter()
                    .find(|s| s.kind == kind)
                    .map(|s| s.data.clone())
            };
            assert_eq!(
                of("heartrate"),
                Some(vec![Some(90.0), Some(95.0), Some(100.0), Some(104.0)])
            );
            assert_eq!(
                of("time"),
                Some(vec![Some(0.0), Some(1.0), Some(2.0), Some(3.0)])
            );
            assert_eq!(of("latlng"), None);
        }

        fn recorded_run() -> crate::persistence::job_runs::JobRun {
            with_persistent_engine(|e| crate::persistence::job_runs::job_runs(&e.db))
                .expect("engine")
                .expect("runs read")
                .into_iter()
                .find(|run| run.job == crate::persistence::job_runs::BackgroundJob::StreamBackfill)
                .expect("the pass recorded its run")
        }

        /// Scenario: a pass stores one activity's series and upstream refuses
        /// another's.
        ///
        /// Expected behaviour: the run is recorded once as partial, with both
        /// activities handled, one changed and one failed, and it reads the
        /// same after the engine is reopened. A pass that is refused the slot
        /// records nothing.
        #[test]
        fn a_pass_records_its_last_run() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1", "i3"]);
            let server = MockServer::start();
            serves(
                &server,
                "i1",
                &[("latlng", &latlng(POINTS)), ("watts", &watts())],
            );
            server.mock(|when, then| {
                when.method(GET).path("/activity/i3/streams.json");
                then.status(404);
            });

            let held = RunGuard::claim().expect("the slot starts free");
            run_stream_backfill(&transport(&server), "1");
            drop(held);
            let none_yet =
                with_persistent_engine(|e| crate::persistence::job_runs::job_runs(&e.db))
                    .expect("engine")
                    .expect("runs read");
            assert!(none_yet.is_empty(), "a refused start ran nothing");

            run_stream_backfill(&transport(&server), "1");

            let run = recorded_run();
            assert_eq!(
                run.outcome,
                crate::persistence::job_runs::RunOutcome::Partial
            );
            assert_eq!(
                (run.handled, run.added, run.changed, run.retired, run.failed),
                (2, 0, 1, 0, 1)
            );
            assert!(run.finished_at > crate::WholeNumber(0));
        }

        /// Scenario: a pass cannot read its queue because there is no engine.
        ///
        /// Expected behaviour: nothing can be recorded and nothing panics.
        #[test]
        fn a_pass_with_no_engine_records_nothing_and_does_not_panic() {
            let _serial = serial_global_state();
            crate::persistence::clear_persistent_engine();
            let server = MockServer::start();
            run_stream_backfill(&transport(&server), "1");
        }

        /// Scenario: a ride recorded with no sensors answers every pass with
        /// its track and nothing else.
        ///
        /// Expected behaviour: it leaves the queue after
        /// `STREAM_ATTEMPT_LIMIT` passes, after which a pass has nothing to
        /// ask and a start reports the job as not owed rather than starting.
        #[test]
        fn a_ride_with_no_sensors_retires_after_the_attempt_limit() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i2"]);
            let server = MockServer::start();
            let bare = serves(&server, "i2", &[("latlng", &latlng(POINTS))]);
            let t = transport(&server);

            for pass in 1..=STREAM_ATTEMPT_LIMIT {
                assert_eq!(
                    queue(),
                    vec!["i2".to_string()],
                    "still owed before pass {pass}"
                );
                let run = run_stream_backfill(&t, "1");
                assert!(matches!(
                    run,
                    StreamBackfillRun::Finished(StreamBackfillOutcome { empty: 1, .. })
                ));
            }

            assert!(queue().is_empty());
            assert_eq!(
                run_stream_backfill(&t, "1"),
                StreamBackfillRun::Finished(StreamBackfillOutcome::default())
            );
            bare.assert_calls(STREAM_ATTEMPT_LIMIT as usize);
            assert_eq!(start_stream_backfill(), FfiStartOutcome::NotOwed);
        }

        /// Scenario: upstream rejects the credential on a stream fetch, and
        /// the profile check that confirms a rejection answers normally.
        ///
        /// Expected behaviour: the pass ends as failed at that batch, the
        /// rejection is checked against the profile before anyone is signed
        /// out, and nothing is counted against the activity.
        #[test]
        fn a_rejected_credential_fails_the_pass_and_is_confirmed_against_the_profile() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1"]);
            let server = MockServer::start();
            let rejected = server.mock(|when, then| {
                when.method(GET).path("/activity/i1/streams.json");
                then.status(401);
            });
            let profile = server.mock(|when, then| {
                when.method(GET).path("/athlete/1");
                then.status(200).body(r#"{"id":"1"}"#);
            });

            let run = run_stream_backfill(&transport(&server), "1");

            assert_eq!(run, StreamBackfillRun::Failed("unauthorized".to_string()));
            rejected.assert_calls(1);
            profile.assert_calls(1);
            assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_FAILED);
            assert_eq!(queue(), vec!["i1".to_string()]);
        }

        /// A pass that starts while TypeScript says the network is gone asks
        /// nothing and ends partial, so the whole queue is still owed.
        #[test]
        fn a_pass_that_starts_offline_asks_nothing_and_ends_partial() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1", "i2"]);
            let server = MockServer::start();
            let any = server.mock(|when, then| {
                when.method(GET);
                then.status(200).body("[]");
            });
            connectivity::set_online(false);

            let run = run_stream_backfill(&transport(&server), "1");
            connectivity::reset();

            assert_eq!(
                run,
                StreamBackfillRun::Finished(StreamBackfillOutcome {
                    queued: 2,
                    ..StreamBackfillOutcome::default()
                })
            );
            any.assert_calls(0);
            assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_PARTIAL);
            assert_eq!(queue().len(), 2);
        }

        /// Scenario: the install's own backfill allowance is one request, so
        /// the pass asks for the first activity and the budget defers the rest.
        /// Nothing was refused upstream.
        ///
        /// Expected behaviour: the pass reports waiting, with the time it
        /// resumes equal to the deferral's own.
        #[test]
        fn a_pass_the_allowance_defers_reports_when_it_resumes() {
            use crate::governor::{Allowance, Budget, Intent, SYNC_ALLOWANCE};
            fn noon() -> chrono::DateTime<chrono::Utc> {
                chrono::DateTime::parse_from_rfc3339("2026-10-20T12:00:00Z")
                    .expect("fixed time")
                    .with_timezone(&chrono::Utc)
            }
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1", "i2", "i3"]);
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).body("[]");
            });
            let one = Allowance {
                per_fifteen_minutes: 1,
                per_day: None,
            };
            let governor = Arc::new(
                Governor::new(1000, Box::new(NoopPolicy))
                    .with_clock(noon)
                    .with_budget(
                        Budget::with_allowances(one, SYNC_ALLOWANCE, 0),
                        None,
                        || 0.0,
                    ),
            );
            let transport = Transport::with_governor(
                server.base_url(),
                AuthMethod::ApiKey("secret"),
                Arc::clone(&governor),
            )
            .unwrap();

            run_stream_backfill(&transport, "1");

            let deferred_until = governor
                .deferred_until(Intent::Backfill, noon())
                .expect("the allowance is spent");
            let progress = stream_backfill_progress();
            assert_eq!(progress.phase, STREAM_PHASE_WAITING);
            assert_eq!(
                progress.resumes_at_ms,
                Some(deferred_until.timestamp_millis())
            );
        }

        /// Scenario: a pass holds the single-run slot when a second run and a
        /// start arrive.
        ///
        /// Expected behaviour: both are refused without asking upstream, and
        /// the slot is free again the moment its holder is dropped.
        #[test]
        fn a_second_pass_is_refused_while_one_holds_the_slot() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1"]);
            let server = MockServer::start();
            let any = server.mock(|when, then| {
                when.method(GET);
                then.status(200).body("[]");
            });

            let held = RunGuard::claim().expect("the slot starts free");
            assert_eq!(
                run_stream_backfill(&transport(&server), "1"),
                StreamBackfillRun::Refused
            );
            assert_eq!(start_stream_backfill(), FfiStartOutcome::Busy);
            drop(held);

            any.assert_calls(0);
            assert!(
                RunGuard::claim().is_some(),
                "dropping the holder frees the slot"
            );
        }

        /// With no engine there is no queue to read, so a pass fails and a
        /// start says not ready rather than reporting the job finished.
        #[test]
        fn without_an_engine_a_pass_fails_and_a_start_is_not_ready() {
            let _serial = serial_global_state();
            // The pool goes too: a start counts through it, and one an earlier
            // test bound would read an empty queue rather than none at all.
            crate::persistence::clear_persistent_engine();
            let server = MockServer::start();

            assert_eq!(
                run_stream_backfill(&transport(&server), "1"),
                StreamBackfillRun::Failed("no engine".to_string())
            );
            assert_eq!(stream_backfill_progress().phase, STREAM_PHASE_FAILED);
            assert_eq!(start_stream_backfill(), FfiStartOutcome::NotReady);
        }

        /// Scenario: the queue is owed but the device is offline, and then
        /// back online with no credential yet.
        ///
        /// Expected behaviour: each start names its refusal, and neither
        /// leaves the slot held, so the next start is not refused as busy.
        #[test]
        fn a_start_names_offline_and_a_missing_credential_and_frees_the_slot() {
            let _serial = serial_global_state();
            connectivity::reset();
            let _tmp = engine_with(&["i1"]);
            crate::objects::clear_test_credentials();

            connectivity::set_online(false);
            assert_eq!(start_stream_backfill(), FfiStartOutcome::Offline);
            connectivity::reset();

            assert_eq!(start_stream_backfill(), FfiStartOutcome::NotConfigured);
            assert!(RunGuard::claim().is_some(), "neither refusal kept the slot");
        }
    }
}

#[cfg(test)]
#[path = "tests/stream_auth.rs"]
mod auth_tests;

#[cfg(test)]
#[path = "tests/stream_time.rs"]
mod time_tests;

#[cfg(test)]
#[path = "tests/stream_source.rs"]
mod source_tests;
