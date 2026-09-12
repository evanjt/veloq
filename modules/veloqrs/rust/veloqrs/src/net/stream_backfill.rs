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
//! Unlike the elevation backfill this is not fired at launch. It is tens of
//! megabytes on whatever connection the phone has, so the athlete starts it and
//! the athlete stops it, and [`stop_stream_backfill`] takes effect at the next
//! batch boundary.

use crate::governor::Lane;
use crate::net::endpoints::DEFAULT_STREAM_TYPES;
use crate::net::transport::{NetError, Transport};
use crate::net::types::{StreamDto, storable_series};
use crate::objects::FfiStartOutcome;
use crate::persistence::{PersistentEngine, StreamGap, with_persistent_engine};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

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
/// The athlete stopped it.
pub const STREAM_PHASE_STOPPED: &str = "stopped";
/// A pass could not proceed at all.
pub const STREAM_PHASE_FAILED: &str = "failed";

struct BackfillState {
    running: AtomicBool,
    cancelled: AtomicBool,
    completed: AtomicU32,
    total: AtomicU32,
    stored: AtomicU32,
    failed: AtomicU32,
    phase: Mutex<&'static str>,
}

static BACKFILL: BackfillState = BackfillState {
    running: AtomicBool::new(false),
    cancelled: AtomicBool::new(false),
    completed: AtomicU32::new(0),
    total: AtomicU32::new(0),
    stored: AtomicU32::new(0),
    failed: AtomicU32::new(0),
    phase: Mutex::new(STREAM_PHASE_IDLE),
};

fn set_phase(phase: &'static str) {
    *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
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
    StreamBackfillSnapshot {
        phase: *BACKFILL.phase.lock().unwrap_or_else(|e| e.into_inner()),
        completed: BACKFILL.completed.load(Ordering::Relaxed),
        total: BACKFILL.total.load(Ordering::Relaxed),
        stored: BACKFILL.stored.load(Ordering::Relaxed),
        failed: BACKFILL.failed.load(Ordering::Relaxed),
    }
}

/// Ask the pass in flight to stop. It ends at its next batch boundary, so the
/// activities already stored stay stored and nothing is half written.
///
/// Nothing is persisted: the queue is derived, so a stopped pass and a crashed
/// one resume identically.
pub fn stop_stream_backfill() {
    BACKFILL.cancelled.store(true, Ordering::SeqCst);
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
    /// The credential was rejected, so every remaining request would be too.
    Unauthorized,
    /// [`MAX_CONSECUTIVE_FAILURES`] in a row: there is nothing to work with.
    NothingToWorkWith,
    /// TypeScript says the network is gone.
    Offline,
    /// The athlete stopped it.
    Cancelled,
}

/// What one activity's ask came back as.
enum Fetched {
    /// Series reduced to the track's index space, ready to store.
    Series(Vec<StreamDto>),
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
        NetError::Transport(_) | NetError::RateLimited => true,
        NetError::Http { status, .. } => *status >= 500,
        _ => false,
    }
}

/// One activity's series, reduced to the index space its stored track is in.
async fn fetch_one(transport: &Transport, upstream: &str, points: usize) -> Fetched {
    let bytes = match transport
        .get_bytes(
            &format!("/activity/{}/streams.json", upstream),
            &[("types", DEFAULT_STREAM_TYPES)],
            Lane::Backfill,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return Fetched::Failed(e),
    };
    reduce(&bytes, points, upstream)
}

/// What a response body comes to for an activity whose stored track holds
/// `points` samples. The whole decision, with no transport in it.
fn reduce(body: &[u8], points: usize, named: &str) -> Fetched {
    let raw: Vec<StreamDto> = match serde_json::from_slice(body) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[Streams] {} did not parse: {}", named, e);
            return Fetched::Nothing;
        }
    };
    let series = storable_series(&raw);
    if series.is_empty() {
        return Fetched::Nothing;
    }
    // Every series `storable_series` returns is already in the one index space,
    // so the first is as good as any to measure it by. A length that no longer
    // matches the stored track is upstream having re-processed the activity,
    // and the stored section indices address the track this device holds.
    if series[0].data.len() != points {
        log::info!(
            "[Streams] {} came back covering {} samples, the stored track holds {}, not storing",
            named,
            series[0].data.len(),
            points
        );
        return Fetched::Nothing;
    }
    Fetched::Series(series)
}

/// One batch of asks, at [`FETCH_CONCURRENCY`] in flight.
async fn fetch_batch(
    transport: &Transport,
    batch: &[StreamGap],
    upstream: &std::collections::HashMap<String, String>,
) -> Vec<(String, Fetched)> {
    use futures::stream::{self, StreamExt};

    stream::iter(batch.iter().cloned())
        .map(|gap| {
            let named = upstream
                .get(&gap.activity_id)
                .cloned()
                .unwrap_or_else(|| gap.activity_id.clone());
            async move {
                let fetched = fetch_one(transport, &named, gap.point_count).await;
                (gap.activity_id, fetched)
            }
        })
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await
}

impl PersistentEngine {
    /// Store one batch's series and count the asks that settled nothing, in one
    /// pass over the engine lock rather than one per activity.
    fn apply_stream_batch(&self, results: &[(String, Fetched)]) -> (u32, u32) {
        let mut stored = 0;
        let mut empty = 0;
        for (id, result) in results {
            match result {
                Fetched::Series(series) => match self.store_activity_streams(id, series) {
                    Ok(()) => stored += 1,
                    Err(e) => log::warn!("[Streams] storing {} failed: {}", id, e),
                },
                Fetched::Nothing => {
                    empty += 1;
                    if let Err(e) = self.record_stream_backfill_attempt(id) {
                        log::warn!("[Streams] counting the ask for {} failed: {}", id, e);
                    }
                }
                Fetched::Failed(_) => {}
            }
        }
        (stored, empty)
    }
}

/// Run a pass over the queue, claiming the single-run slot first.
pub fn run_stream_backfill(transport: &Transport, athlete_id: &str) -> StreamBackfillRun {
    let Some(slot) = RunGuard::claim() else {
        log::info!("[Streams] backfill refused: a pass is already in flight");
        return StreamBackfillRun::Refused;
    };
    run_in_slot(slot, transport, athlete_id)
}

fn run_in_slot(_slot: RunGuard, transport: &Transport, athlete_id: &str) -> StreamBackfillRun {
    let queue = match with_persistent_engine(|engine| {
        engine.activities_missing_streams(STREAM_ATTEMPT_LIMIT)
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

    let (outcome, stopped) = drain_queue(transport, &queue);
    BACKFILL.failed.store(outcome.failed, Ordering::Relaxed);

    match stopped {
        Some(Stopped::Unauthorized) => {
            set_phase(STREAM_PHASE_FAILED);
            log::warn!("[Streams] backfill stopped: unauthorized");
            crate::runtime::block_on(crate::objects::park_auth_expired(transport, athlete_id));
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
fn drain_queue_with(
    queue: &[StreamGap],
    mut fetch: impl FnMut(&[StreamGap]) -> Vec<(String, Fetched)>,
    mut apply: impl FnMut(&[(String, Fetched)]) -> (u32, u32),
    mut offline: impl FnMut() -> bool,
) -> (StreamBackfillOutcome, Option<Stopped>) {
    let mut outcome = StreamBackfillOutcome {
        queued: queue.len() as u32,
        ..StreamBackfillOutcome::default()
    };
    let mut consecutive_failures = 0usize;

    for batch in queue.chunks(BATCH) {
        // Read at the boundary, not only before the walk: a pass that loses the
        // network half way through would otherwise spend the rest of its queue
        // discovering that one request at a time.
        if stream_backfill_cancelled() {
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
    transport: &Transport,
    queue: &[StreamGap],
) -> (StreamBackfillOutcome, Option<Stopped>) {
    let ids: Vec<String> = queue.iter().map(|g| g.activity_id.clone()).collect();
    // The URL names the activity upstream, the queue names it locally. Resolved
    // once for the whole pass rather than per fetch, so the dispatch loop never
    // waits on the engine lock.
    let upstream = with_persistent_engine(|engine| engine.intervals_ids(&ids)).unwrap_or_default();

    drain_queue_with(
        queue,
        |batch| crate::runtime::block_on(fetch_batch(transport, batch, &upstream)),
        |results| {
            with_persistent_engine(|engine| engine.apply_stream_batch(results)).unwrap_or((0, 0))
        },
        crate::net::connectivity::is_offline,
    )
}

/// Start a pass on a detached thread using the process credential.
///
/// The verdict names the refusal, so a caller can tell an empty queue, which is
/// the job finished, from a device that is merely offline.
pub fn start_stream_backfill() -> FfiStartOutcome {
    let remaining =
        with_persistent_engine(|engine| engine.stream_backfill_remaining(STREAM_ATTEMPT_LIMIT));
    match remaining {
        Some(Ok(n)) if n > 0 => {}
        Some(Ok(_)) => return FfiStartOutcome::NotOwed,
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
    let Some(Ok((transport, athlete_id))) = crate::objects::current_session() else {
        log::info!("[Streams] backfill deferred: no credential yet");
        return FfiStartOutcome::NotConfigured;
    };

    std::thread::spawn(move || {
        run_in_slot(slot, &transport, &athlete_id);
    });
    FfiStartOutcome::Started
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gaps(n: usize) -> Vec<StreamGap> {
        (0..n)
            .map(|i| StreamGap {
                activity_id: format!("a{i}"),
                point_count: 3,
            })
            .collect()
    }

    /// A walk that never touches the network: every batch answers with what the
    /// caller says, and nothing is applied.
    fn walk(
        queue: &[StreamGap],
        answer: impl Fn(&StreamGap) -> Fetched,
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
            || false,
        );
        (outcome, stopped, asked.get())
    }

    /// Scenario: 34 MB on a phone connection is not a silent operation, so the
    /// athlete can stop it.
    ///
    /// Expected behaviour: the stop lands at the next batch boundary, so the
    /// activities behind it are never asked and the ones already stored stay
    /// stored.
    #[test]
    fn a_stop_leaves_the_rest_of_the_queue_unasked() {
        let queue = gaps(BATCH * 3);
        stop_stream_backfill();

        let (_, stopped, asked) = walk(&queue, |_| Fetched::Nothing);

        assert!(matches!(stopped, Some(Stopped::Cancelled)));
        assert_eq!(asked, 0, "the stop is read before the batch, not after it");
        BACKFILL.cancelled.store(false, Ordering::SeqCst);
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

    /// Scenario: upstream re-processed an activity after this device stored its
    /// track. Its series are in a different index space, and every stored
    /// section index addresses the space the device holds.
    ///
    /// Expected behaviour: nothing is stored. Re-ingesting a moved track is the
    /// elevation pass's business, because it invalidates the catalogue.
    #[test]
    fn a_track_that_moved_upstream_stores_nothing() {
        let body = body(&[("latlng", &latlng(4)), ("watts", "[100,110,120,130]")]);

        assert!(matches!(reduce(&body, 4, "a1"), Fetched::Series(_)));
        assert!(
            matches!(reduce(&body, 3, "a1"), Fetched::Nothing),
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

        assert!(matches!(reduce(&body, 3, "a1"), Fetched::Nothing));
    }

    /// A ride recorded with no sensors carries nothing beyond the track. It
    /// must read as upstream answering, so the ask is counted and the activity
    /// eventually retires, rather than as a failure that is retried for ever.
    #[test]
    fn a_ride_with_no_sensors_reads_as_an_answer_not_a_failure() {
        let body = body(&[("latlng", &latlng(3))]);

        assert!(matches!(reduce(&body, 3, "a1"), Fetched::Nothing));
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
        };
        assert_eq!(snapshot.percent(), 100);
    }
}
