//! Bulk GPS-track and FIT downloads for intervals.icu.
//!
//! Everything here goes through the shared `Transport`, so there is one client
//! in the process: one connection pool, one governor choke point, one retry
//! and `Retry-After` policy, and one place that classifies a 401. This module
//! keeps only what `Transport` does not do - fanning a batch out across
//! `MAX_CONCURRENCY` tasks and reporting progress to the FFI poll.
//!
//! Tracks come from `streams.json` rather than the map endpoint, because the
//! map endpoint carries coordinates alone. `parse_streams` reduces every series
//! to one validity mask taken from `latlng`, so `latlngs[i]` and `elevations[i]`
//! describe the same sample and stored section indices keep addressing the same
//! ground.

use crate::governor::Lane;
use crate::net::transport::{NetError, Transport};
use crate::net::types::{StreamDto, parse_streams};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

/// Helper to calculate elapsed milliseconds from an Instant
#[inline]
fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

/// Why a run wants the network, which decides what waits for what.
///
/// `Interactive` is a screen the athlete is looking at: the map tap that owns
/// no track yet, an activity opened before its download landed. It is one or
/// two activities and somebody is watching it arrive. `Bulk` is the sync's own
/// pass over the window, hundreds of them, with nothing on screen waiting for
/// any particular one.
#[derive(Clone, Copy, PartialEq, Eq, Debug, uniffi::Enum)]
pub enum DownloadPriority {
    Interactive,
    Bulk,
}

/// The governor lane a track request takes. A bulk pass has nothing on screen
/// waiting, so it stays behind the requests a screen makes.
fn track_lane(priority: DownloadPriority) -> Lane {
    match priority {
        DownloadPriority::Interactive => Lane::Interactive,
        DownloadPriority::Bulk => Lane::Backfill,
    }
}

/// One fetch-and-store run's share of the download slot.
struct QueuedRun {
    run: u64,
    total: u32,
    completed: u32,
    cancelled: bool,
    abort_requested: bool,
    abort_notify: Arc<tokio::sync::Notify>,
    priority: DownloadPriority,
}

/// The runs that have been started, oldest first. The head holds the slot.
///
/// Three callers start a fetch-and-store: the foreground GPS sync, the headless
/// push task and the map's own download. There was one set of counters and one
/// cancel flag, so a second start reset both under the run in flight. The first
/// caller's poll then settled on the second run's guard drop, read no result of
/// its own and reported a download that was still running as a failure, and a
/// cancel aimed at either run stopped both.
///
/// A run joins the queue on the thread that starts it, before the id is handed
/// back, so the slot reads busy from the moment the caller has something to
/// poll. Its own thread waits for the head before fetching anything.
struct DownloadQueue {
    runs: std::collections::VecDeque<QueuedRun>,
}

static DOWNLOAD_QUEUE: std::sync::Mutex<DownloadQueue> = std::sync::Mutex::new(DownloadQueue {
    runs: std::collections::VecDeque::new(),
});
static DOWNLOAD_SLOT_FREED: std::sync::Condvar = std::sync::Condvar::new();

fn queue() -> std::sync::MutexGuard<'static, DownloadQueue> {
    DOWNLOAD_QUEUE.lock().unwrap_or_else(|e| e.into_inner())
}

impl DownloadQueue {
    /// The run the process-wide poll speaks for, which is the oldest in the
    /// queue: the bulk pass whenever one is running, since an interactive run
    /// joins behind it rather than ahead of it. It reads as active from the
    /// moment it is enqueued, before its own thread has started fetching, so a
    /// caller that has just been handed a run id never polls an idle slot.
    #[cfg(test)]
    fn holder(&self) -> Option<&QueuedRun> {
        self.runs.front()
    }

    fn any_interactive(&self) -> bool {
        self.runs
            .iter()
            .any(|r| r.priority == DownloadPriority::Interactive)
    }

    /// Whether this bulk run may start: no interactive run wants the network,
    /// no other bulk run is fetching, and it is the oldest bulk run waiting.
    fn bulk_may_start(&self, run: u64) -> bool {
        if self.any_interactive() {
            return false;
        }
        let next = self
            .runs
            .iter()
            .find(|r| r.priority == DownloadPriority::Bulk)
            .map(|r| r.run);
        next == Some(run)
    }
}

/// Join the download queue and answer the place taken.
///
/// Called on the thread that starts the run, not the one that fetches, so a
/// caller that has been given a run id is already visible to the poll.
pub fn enqueue_download(run: u64, total: u32, priority: DownloadPriority) {
    queue().runs.push_back(QueuedRun {
        run,
        total,
        completed: 0,
        cancelled: false,
        abort_requested: false,
        abort_notify: Arc::new(tokio::sync::Notify::new()),
        priority,
    });
}

/// The priority a run was enqueued with. A run that was never enqueued is a
/// single fetch somebody is waiting on, so it reads as interactive.
fn run_priority(run: u64) -> DownloadPriority {
    queue()
        .runs
        .iter()
        .find(|entry| entry.run == run)
        .map_or(DownloadPriority::Interactive, |entry| entry.priority)
}

/// Wait until this run may fetch, and hold that place.
///
/// A bulk run waits for the bulk run ahead of it, as it always has, and now
/// also for any interactive run. An interactive run waits for nothing: it is
/// one activity somebody is watching for, so it goes out beside the bulk pass
/// rather than behind its hundreds, and the bulk pass stops dispatching while
/// it is out (`should_yield_to_interactive`).
///
/// The guard leaves the queue however the fetch thread ends. The crate unwinds
/// rather than aborts and the panic hook logs and returns, so a panic in the
/// fetch thread kills that thread alone: without the guard the slot stayed held
/// for the life of the process, the only consumer polls it every 100 ms and
/// breaks on nothing else, and the app spun at 10 Hz behind a sync banner that
/// never cleared.
pub fn hold_download_slot(run: u64) -> DownloadSlotGuard {
    let mut guard = queue();
    loop {
        let entry = guard
            .runs
            .iter()
            .find(|r| r.run == run)
            .map(|r| (r.priority, r.cancelled))
            // A run nobody enqueued is a test or a caller that skipped the
            // queue. It fetches, and speaks for nothing.
            .unwrap_or((DownloadPriority::Interactive, false));
        if entry.1 || entry.0 == DownloadPriority::Interactive || guard.bulk_may_start(run) {
            return DownloadSlotGuard { run };
        }
        guard = DOWNLOAD_SLOT_FREED
            .wait(guard)
            .unwrap_or_else(|e| e.into_inner());
    }
}

/// Whether this run should hold its next request back.
///
/// True for a bulk run while any interactive run is queued or fetching. The
/// bulk pass has fifty requests in flight and the governor paces every one of
/// them, so a tap that arrives mid-pass would otherwise sit behind whatever
/// share of those hundreds is still to dispatch.
pub fn should_yield_to_interactive(run: u64) -> bool {
    let guard = queue();
    let mine = guard.runs.iter().find(|r| r.run == run);
    match mine {
        Some(entry) if entry.priority == DownloadPriority::Bulk => guard.any_interactive(),
        _ => false,
    }
}

pub struct DownloadSlotGuard {
    run: u64,
}

impl Drop for DownloadSlotGuard {
    fn drop(&mut self) {
        leave_download_queue(self.run);
    }
}

/// Drop a run from the queue whether it ever held the slot or not.
pub fn leave_download_queue(run: u64) {
    queue().runs.retain(|r| r.run != run);
    DOWNLOAD_SLOT_FREED.notify_all();
}

/// Ask the running download to stop. Returns whether there was one.
///
/// Cooperative: the fetch and the storing loop both check between activities,
/// so a request already in flight finishes and no further one is dispatched.
/// Stopping mid-activity would leave a track half written, and the loop is the
/// only place the library is whole.
/// Scoped to the named run, wherever it sits in the queue, so a cancel cannot
/// reach the run ahead of it or the one that starts next. A run that has left
/// the queue answers false and nothing is armed for a later one.
pub fn cancel_download(run: u64) -> bool {
    let mut guard = queue();
    match guard.runs.iter_mut().find(|r| r.run == run) {
        Some(entry) => {
            entry.cancelled = true;
            DOWNLOAD_SLOT_FREED.notify_all();
            true
        }
        None => false,
    }
}

/// Ask every running and queued download to stop before the engine closes.
pub fn cancel_all_downloads() {
    let mut guard = queue();
    for run in &mut guard.runs {
        run.cancelled = true;
        run.abort_requested = true;
        run.abort_notify.notify_one();
    }
    DOWNLOAD_SLOT_FREED.notify_all();
}

/// Whether this run has been asked to stop.
pub fn download_cancelled(run: u64) -> bool {
    queue().runs.iter().any(|r| r.run == run && r.cancelled)
}

fn download_abort_requested(run: u64) -> bool {
    queue()
        .runs
        .iter()
        .any(|r| r.run == run && r.abort_requested)
}

/// Count one activity against the run that fetched it.
///
/// Against the run and not against the holder, because an interactive run now
/// fetches beside a bulk pass and either one's completions would otherwise be
/// counted by whichever was admitted first.
pub fn increment_run_download_progress(run: u64) {
    if let Some(entry) = queue().runs.iter_mut().find(|r| r.run == run) {
        // A retry pass re-counts the ids it offers again.
        entry.completed = (entry.completed + 1).min(entry.total);
    }
}

/// Current progress for the FFI poll: the holder's counters, and whether any
/// run is still queued.
///
/// A caller waiting its turn reads the holder's counters rather than its own.
/// That keeps the poll's stall deadline honest, which is on movement and not on
/// wall clock, and the bar it feeds is scaled against the caller's own id count
/// anyway.
#[cfg(test)]
pub fn get_download_progress() -> (u32, u32, bool) {
    let guard = queue();
    match guard.holder() {
        Some(holder) => (holder.completed, holder.total, true),
        None => (0, 0, false),
    }
}

/// Progress for one run alone. Inactive once that run has left the queue,
/// whatever else is downloading.
pub fn run_download_progress(run: u64) -> (u32, u32, bool) {
    let guard = queue();
    match guard.runs.iter().find(|r| r.run == run) {
        Some(entry) => (entry.completed, entry.total, true),
        None => (0, 0, false),
    }
}

/// How long a bulk request waits for interactive runs before going anyway.
///
/// An interactive run that wedges must not stop the sync for the session, and
/// a single track is seconds at worst, so the cap is generous and still finite.
const INTERACTIVE_YIELD_CAP: std::time::Duration = std::time::Duration::from_secs(15);

/// How often the gate looks again. Short enough that the pause after the
/// interactive run finishes is not itself the delay.
const INTERACTIVE_YIELD_POLL: std::time::Duration = std::time::Duration::from_millis(25);

/// Pause a bulk run's next request while an interactive one wants the network.
async fn wait_out_interactive_runs(run: u64) {
    if !should_yield_to_interactive(run) {
        return;
    }
    let until = Instant::now() + INTERACTIVE_YIELD_CAP;
    while should_yield_to_interactive(run) && Instant::now() < until {
        tokio::time::sleep(INTERACTIVE_YIELD_POLL).await;
    }
}

// Dispatch pace is the governor's job now (≤8 req/s across the whole process),
// so this module no longer carries its own burst/sustained intervals.
// Retry and dispatch pace are the transport's job now, so this module only
// decides how many activities may be in flight at once.
pub(crate) const MAX_CONCURRENCY: usize = 50; // Network latency ~200-400ms per activity

/// One activity's track as fetched: coordinates, the elevation that belongs to
/// each of them, and the bytes the body cost.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityMapResult {
    pub activity_id: String,
    pub latlngs: Option<Vec<[f64; 2]>>,
    /// Same length and same index space as `latlngs`, or `None` when the
    /// response carried no usable altitude. A sample with no altitude, or a
    /// non-finite one, is `None` at its own index rather than a fabricated
    /// number.
    pub elevations: Option<Vec<Option<f64>>>,
    /// Whether `elevations` is upstream's corrected series rather than the one
    /// the device recorded. False when there are no elevations.
    #[serde(default)]
    pub elevation_corrected: bool,
    /// Response body size after transfer decoding, for the throughput log.
    pub body_bytes: u32,
    /// The series the durable store holds, masked into the track's index
    /// space. Empty unless the fetch was widened, which only happens for an
    /// activity inside the retention window.
    pub streams: Vec<StreamDto>,
    /// Cumulative seconds at each stored point, in that same index space.
    /// Empty unless the fetch was widened: `TRACK_STREAM_TYPES` does not ask
    /// for `time`, so a narrow fetch still owes the second pass.
    pub times: Vec<u32>,
    pub success: bool,
    pub error: Option<String>,
}

/// Progress callback type
pub type ProgressCallback = Arc<dyn Fn(u32, u32) + Send + Sync>;

/// Running dispatch number, for the progress log only. Pacing, retry and
/// `Retry-After` all belong to the transport now.
struct DispatchCounter {
    dispatched_count: AtomicU32,
}

impl DispatchCounter {
    fn new() -> Self {
        Self {
            dispatched_count: AtomicU32::new(0),
        }
    }

    /// Next 1-based dispatch number.
    fn next_dispatch_number(&self) -> u32 {
        self.dispatched_count.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// Batch fetcher for activity maps and FIT files.
pub struct ActivityFetcher {
    transport: Transport,
}

impl ActivityFetcher {
    /// Build a fetcher from the credential the sync service holds. Errors when
    /// no credential is set, rather than issuing an unauthenticated request.
    pub fn from_credentials() -> Result<Self, String> {
        let transport = crate::objects::current_transport()
            .ok_or_else(|| "no credentials set".to_string())??;
        Ok(Self { transport })
    }

    /// Build a fetcher over a caller-supplied transport, so tests can point it
    /// at a mock server.
    pub fn with_transport(transport: Transport) -> Self {
        Self { transport }
    }

    /// The shared transport, so callers can issue their own paced requests
    /// against the same client rather than building a second one.
    pub fn transport(&self) -> &Transport {
        &self.transport
    }

    /// Download the raw FIT file for an activity.
    ///
    /// The error keeps its kind. The caller decides from it whether the activity
    /// has settled (upstream holds no file) or should be retried, and flattening
    /// it to a string made a transport blip indistinguishable from a 404.
    ///
    /// The lane is the caller's: a strength card the athlete opened is waiting
    /// on this, a batch behind a sync is not, and the batch ran on the
    /// Interactive lane and competed with the foreground for it.
    pub async fn download_fit_file(
        &self,
        activity_id: &str,
        lane: Lane,
    ) -> Result<Vec<u8>, NetError> {
        self.transport
            .get_bytes(&format!("/activity/{}/file", activity_id), &[], lane)
            .await
    }
}

/// The intervals.icu id for each key that has one. Read once per batch, and
/// empty when the engine is not open, in which case each URL falls back to the
/// key it was given.
async fn upstream_ids(activity_ids: &[String]) -> std::collections::HashMap<String, String> {
    let ids = activity_ids.to_vec();
    crate::persistence::with_persistent_engine_blocking(move |engine| engine.intervals_ids(&ids))
        .await
        .unwrap_or_default()
}

impl ActivityFetcher {
    /// Fetch map data for multiple activities in parallel
    /// `wide_ids` names the activities inside the stream retention window.
    /// Those download every series the app can use; the rest stay on the three
    /// the track needs.
    pub async fn fetch_activity_maps(
        &self,
        run: u64,
        activity_ids: Vec<String>,
        wide_ids: std::collections::HashSet<String>,
        on_progress: Option<ProgressCallback>,
    ) -> Vec<ActivityMapResult> {
        let collected = std::sync::Mutex::new(Vec::with_capacity(activity_ids.len()));
        self.fetch_activity_maps_into(
            run,
            activity_ids,
            wide_ids,
            on_progress,
            || true,
            |result, _permit| {
                collected
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(result)
            },
        )
        .await;
        collected.into_inner().unwrap_or_else(|e| e.into_inner())
    }

    /// The same fetch, handing each result over the moment it lands.
    ///
    /// The collecting form above held every track and every series in a `Vec`
    /// until the last download finished, and the caller stored nothing until
    /// then: 490 activities at 5,000 points is roughly 80 MB of tracks plus
    /// half a megabyte of series apiece, resident in the window for the length
    /// of the download, and a kill lost all of it. `on_result` runs on the
    /// runtime as each activity completes, so storage runs alongside the
    /// download rather than behind it.
    ///
    /// It is called from inside the concurrent stream, so it must not block for
    /// long: the production caller sends down a channel and stores on a thread
    /// of its own.
    ///
    /// `signed_in` is asked before every dispatch and before every hand-over,
    /// beside the abort flag. A sign-out forgets the credential but not the
    /// transport this batch was built with, so without it the rest of the queue
    /// still goes out on the key the athlete asked the app to forget.
    pub async fn fetch_activity_maps_into(
        &self,
        run: u64,
        activity_ids: Vec<String>,
        wide_ids: std::collections::HashSet<String>,
        on_progress: Option<ProgressCallback>,
        signed_in: impl Fn() -> bool + Send + Sync,
        on_result: impl Fn(ActivityMapResult, tokio::sync::OwnedSemaphorePermit) + Send + Sync,
    ) {
        use futures::stream::{self, StreamExt};

        let abort_notify = queue()
            .runs
            .iter()
            .find(|entry| entry.run == run)
            .map(|entry| Arc::clone(&entry.abort_notify));
        if download_abort_requested(run) {
            return;
        }

        let lane = track_lane(run_priority(run));
        let total = activity_ids.len() as u32;
        let wide_ids = Arc::new(wide_ids);
        let wide_bytes = Arc::new(AtomicU32::new(0));
        // The caller holds the download slot around this, so the increments
        // below land against its own run.
        let completed = Arc::new(AtomicU32::new(0));
        let total_bytes = Arc::new(AtomicU32::new(0));
        // Counted as they land rather than tallied from a `Vec` that no longer
        // exists, which is the whole point of handing them over.
        let successes = AtomicU32::new(0);
        let failures = AtomicU32::new(0);
        let unauthorized = Arc::new(AtomicBool::new(false));
        let outstanding = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENCY));
        let signed_in = &signed_in;

        info!(
            "[RUST: PERF] HTTP Fetch: {} activities, max {} concurrent (governor-paced)",
            total, MAX_CONCURRENCY
        );

        let start = Instant::now();

        // The URL names the activity upstream, the result names it locally.
        // Resolved once for the whole batch rather than per fetch, so the
        // dispatch loop never waits on the engine lock.
        let upstream = Arc::new(upstream_ids(&activity_ids).await);

        // Per-fetch counters only; the governor owns dispatch pacing.
        let counter = Arc::new(DispatchCounter::new());

        // Buffered parallel fetch; the governor paces dispatch across all tasks.
        let downloads = stream::iter(activity_ids)
            .map(|id| {
                let transport = &self.transport;
                let counter = Arc::clone(&counter);
                let completed = Arc::clone(&completed);
                let total_bytes = Arc::clone(&total_bytes);
                let callback = on_progress.clone();
                let start_time = start;
                let upstream = Arc::clone(&upstream);
                let wide_ids = Arc::clone(&wide_ids);
                let wide_bytes = Arc::clone(&wide_bytes);
                let unauthorized = Arc::clone(&unauthorized);
                let outstanding = Arc::clone(&outstanding);

                async move {
                    if download_abort_requested(run)
                        || unauthorized.load(Ordering::Acquire)
                        || !signed_in()
                    {
                        return None;
                    }
                    // The permit travels with the parsed result until storage
                    // finishes, so a stalled store also bounds new requests.
                    let permit = outstanding.acquire_owned().await.ok()?;
                    // Hold this request back while a screen is waiting for one
                    // of its own. Checked per request rather than once, because
                    // the tap lands in the middle of the pass.
                    wait_out_interactive_runs(run).await;
                    if download_abort_requested(run)
                        || download_cancelled(run)
                        || unauthorized.load(Ordering::Acquire)
                        || !signed_in()
                    {
                        return None;
                    }
                    // Transport paces every dispatch through the shared choke
                    // point, so this only numbers them for the log.
                    let dispatch_num = counter.next_dispatch_number();
                    let dispatch_time = start_time.elapsed();

                    let wide = wide_ids.contains(&id);
                    let named = upstream.get(&id).map(String::as_str).unwrap_or(&id);
                    let result = Self::fetch_single_track(transport, &id, named, wide, lane).await;
                    if result.error.as_deref() == Some("unauthorized") {
                        unauthorized.store(true, Ordering::Release);
                    }
                    if download_abort_requested(run) || download_cancelled(run) {
                        return None;
                    }
                    if wide {
                        wide_bytes.fetch_add(result.body_bytes, Ordering::Relaxed);
                    }

                    // Track progress
                    let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    // Update global progress for FFI polling
                    increment_run_download_progress(run);
                    let bytes = result.body_bytes;
                    total_bytes.fetch_add(bytes, Ordering::Relaxed);
                    let complete_time = start_time.elapsed();

                    // Calculate effective dispatch rate
                    let dispatch_rate = if dispatch_time.as_secs_f64() > 0.0 {
                        dispatch_num as f64 / dispatch_time.as_secs_f64()
                    } else {
                        0.0
                    };

                    // Log progress at key milestones (every 10 activities or first/last)
                    if done == 1 || done == total || done.is_multiple_of(10) {
                        info!(
                            "[RUST: fetch_activity_maps] Progress {}/{} | dispatched@{:.2}s (#{} @ {:.1}/s) | done@{:.2}s | {}KB",
                            done,
                            total,
                            dispatch_time.as_secs_f64(),
                            dispatch_num,
                            dispatch_rate,
                            complete_time.as_secs_f64(),
                            bytes / 1024
                        );
                    }

                    if let Some(ref cb) = callback {
                        cb(done, total);
                    }

                    Some((result, permit))
                }
            })
            .buffer_unordered(MAX_CONCURRENCY)
            .for_each(|result| {
                let on_result = &on_result;
                let successes = &successes;
                let failures = &failures;
                async move {
                    let Some((result, permit)) = result else {
                        return;
                    };
                    if download_abort_requested(run) || !signed_in() {
                        return;
                    }
                    if result.success {
                        successes.fetch_add(1, Ordering::Relaxed);
                    } else {
                        failures.fetch_add(1, Ordering::Relaxed);
                    }
                    on_result(result, permit);
                }
            });
        if let Some(abort_notify) = abort_notify {
            let cancelled = abort_notify.notified();
            futures::pin_mut!(downloads, cancelled);
            let _ = futures::future::select(downloads, cancelled).await;
        } else {
            downloads.await;
        }

        let elapsed = start.elapsed();
        let success_count = successes.load(Ordering::Relaxed);
        let error_count = failures.load(Ordering::Relaxed);
        let rate = total as f64 / elapsed.as_secs_f64();
        let total_kb = total_bytes.load(Ordering::Relaxed) / 1024;

        info!(
            "[RUST: fetch_activity_maps] Complete: {}/{} success ({} errors) in {:.2}s ({:.1} req/s, {}KB) ({} ms)",
            success_count,
            total,
            error_count,
            elapsed.as_secs_f64(),
            rate,
            total_kb,
            elapsed_ms(start)
        );

        info!(
            "[RUST: PERF] Throughput: {:.1} req/s, {:.1} KB/s",
            rate,
            total_kb as f64 / elapsed.as_secs_f64()
        );

        // What the widening cost, named rather than folded into the total:
        // a sync that silently multiplied is the failure this guards against.
        info!(
            "[RUST: fetch_activity_maps] Widened {}/{} activities for {}KB of the {}KB downloaded",
            wide_ids.len().min(total as usize),
            total,
            wide_bytes.load(Ordering::Relaxed) / 1024,
            total_kb
        );
    }

    /// One activity's track. Transport owns pacing, retry, `Retry-After` and
    /// 401 classification, so this is request, decode, reduce to one index
    /// space.
    /// `wide` asks for every series the app can use rather than the three the
    /// track needs. It is true only for an activity inside the stream
    /// retention window: outside it the prune deletes the extra series the
    /// same second they land, so the bytes buy nothing.
    /// `activity_id` is the local key the result is filed under, `upstream`
    /// the intervals.icu id the URL names. Equal for every row an older build
    /// stored, and the whole point of the column is that they stop being.
    async fn fetch_single_track(
        transport: &Transport,
        activity_id: &str,
        upstream: &str,
        wide: bool,
        lane: Lane,
    ) -> ActivityMapResult {
        let req_start = Instant::now();

        let failed = |error: String| ActivityMapResult {
            activity_id: activity_id.to_string(),
            latlngs: None,
            elevations: None,
            elevation_corrected: false,
            body_bytes: 0,
            streams: Vec::new(),
            times: Vec::new(),
            success: false,
            error: Some(error),
        };

        let bytes = match transport
            .get_bytes(
                &format!("/activity/{}/streams.json", upstream),
                &[(
                    "types",
                    if wide {
                        crate::net::endpoints::DEFAULT_STREAM_TYPES
                    } else {
                        crate::net::endpoints::TRACK_STREAM_TYPES
                    },
                )],
                lane,
            )
            .await
        {
            Ok(b) => b,
            // Unauthorized is worth naming: it means the whole batch will fail
            // the same way, and the sync service turns it into a re-login.
            Err(NetError::Unauthorized) => return failed("unauthorized".to_string()),
            Err(e) => return failed(e.to_string()),
        };
        decode_track_body(activity_id, &bytes, wide, req_start, failed)
    }
}

/// Decode one streams response into a track, reduced to the one index space
/// the track is stored in. Shared by the bulk fetch and the first-use step, so
/// the two cannot differ on what a usable response is.
pub(crate) fn track_from_streams_body(
    activity_id: &str,
    bytes: &[u8],
    wide: bool,
) -> ActivityMapResult {
    let failed = |error: String| ActivityMapResult {
        activity_id: activity_id.to_string(),
        latlngs: None,
        elevations: None,
        elevation_corrected: false,
        body_bytes: 0,
        streams: Vec::new(),
        times: Vec::new(),
        success: false,
        error: Some(error),
    };
    decode_track_body(activity_id, bytes, wide, Instant::now(), failed)
}

fn decode_track_body(
    activity_id: &str,
    bytes: &[u8],
    wide: bool,
    req_start: Instant,
    failed: impl Fn(String) -> ActivityMapResult,
) -> ActivityMapResult {
    let body_elapsed = req_start.elapsed();
    let body_size = bytes.len();

    let json_start = Instant::now();
    let raw: Vec<StreamDto> = match serde_json::from_slice(bytes) {
        Ok(d) => d,
        Err(e) => return failed(format!("JSON parse error: {}", e)),
    };
    // Taken before `parse_streams` consumes the response, and only when
    // the fetch was widened: a narrow one carries nothing to store.
    let streams = if wide {
        crate::net::types::storable_series(&raw)
    } else {
        Vec::new()
    };
    let parsed = parse_streams(raw);
    let json_elapsed = json_start.elapsed();

    // A latlng series that disagrees with itself has no trustworthy index
    // space, and every stored section index addresses that space.
    if parsed.misaligned.iter().any(|m| m.series == "latlng") {
        return failed("latlng misaligned".to_string());
    }

    let point_count = parsed.latlng.len();
    // Altitude rides the latlng mask, so a length that still disagrees
    // means the series was never in this index space. Drop the elevation
    // and keep the track rather than losing the activity.
    let altitude_aligned = parsed.altitude.len() == point_count
        && !parsed
            .misaligned
            .iter()
            .any(|m| m.series == "altitude" || m.series == "fixed_altitude");
    let elevations = if altitude_aligned && point_count > 0 {
        Some(
            parsed
                .altitude
                .iter()
                .map(|e| e.is_finite().then_some(*e))
                .collect(),
        )
    } else {
        None
    };

    debug!(
        "[Fetch {}] body={:?}({:.1}KB) json={:?} total={:?} points={} elevation={}",
        activity_id,
        body_elapsed,
        body_size as f64 / 1024.0,
        json_elapsed,
        req_start.elapsed(),
        point_count,
        elevations.is_some()
    );

    // Taken from the same parse as the coordinates, so it needs no second
    // request and is already in the track's index space. `max(0) as u32`
    // matches what `fetch_time_stream` returns, which is what the second
    // pass would have stored.
    let times: Vec<u32> = if wide && parsed.time.len() == point_count {
        parsed.time.iter().map(|v| (*v).max(0) as u32).collect()
    } else {
        Vec::new()
    };

    ActivityMapResult {
        activity_id: activity_id.to_string(),
        latlngs: Some(parsed.latlng),
        elevation_corrected: elevations.is_some() && parsed.altitude_is_fixed,
        elevations,
        body_bytes: body_size as u32,
        streams,
        times,
        success: true,
        error: None,
    }
}

#[cfg(test)]
pub(crate) fn reset_download_queue() {
    queue().runs.clear();
    DOWNLOAD_SLOT_FREED.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{AuthMethod, Governor, NoopPolicy};
    use httpmock::prelude::*;
    use serde_json::json;

    fn test_run_id(id: u64) -> u64 {
        u64::MAX - 1_000 + id
    }

    /// Expected behaviour: the download flag is the only thing the GPS poll
    /// loop breaks on, so it has to be cleared on every way out of the fetch
    /// thread. An unwind used to skip the clear at the tail and strand it.
    #[test]
    fn a_panicking_fetch_thread_still_clears_the_download_flag() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 3, DownloadPriority::Bulk);
        assert!(get_download_progress().2, "a started download reads active");

        let unwound = std::thread::spawn(|| {
            let _slot = hold_download_slot(test_run_id(1));
            panic!("the fetch thread unwound");
        })
        .join();

        assert!(unwound.is_err(), "the thread has to have panicked");
        assert!(
            !get_download_progress().2,
            "the flag must not survive the unwind"
        );
    }

    #[test]
    fn the_guard_clears_the_flag_on_a_clean_return_too() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 1, DownloadPriority::Bulk);
        {
            let _slot = hold_download_slot(test_run_id(1));
            increment_run_download_progress(test_run_id(1));
        }
        let (_, _, active) = get_download_progress();
        assert!(!active, "a finished download reads inactive");
    }

    /// Scenario: three callers start a fetch-and-store, and a map tap landing
    /// during the background push task's download is ordinary.
    ///
    /// Expected behaviour: the counters belong to the run holding the slot. A
    /// second start joins the queue behind it instead of resetting them, so the
    /// first caller's poll still reads its own run.
    #[test]
    fn a_second_run_queues_rather_than_resetting_the_one_in_flight() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 4, DownloadPriority::Bulk);
        let first = hold_download_slot(test_run_id(1));
        increment_run_download_progress(test_run_id(1));

        enqueue_download(test_run_id(2), 9, DownloadPriority::Bulk);
        assert_eq!(
            get_download_progress(),
            (1, 4, true),
            "the run in flight keeps its counters"
        );
        assert_eq!(
            run_download_progress(test_run_id(2)),
            (0, 9, true),
            "and the one queued behind it is waiting, not running"
        );

        drop(first);
        let _second = hold_download_slot(test_run_id(2));
        assert_eq!(
            get_download_progress(),
            (0, 9, true),
            "the queued run takes the slot with its own count"
        );
    }

    #[test]
    fn cancelling_all_downloads_releases_every_queued_run() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 4, DownloadPriority::Bulk);
        let holder = hold_download_slot(test_run_id(1));
        enqueue_download(test_run_id(2), 9, DownloadPriority::Bulk);
        enqueue_download(test_run_id(3), 1, DownloadPriority::Interactive);
        let (released, result) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let _slot = hold_download_slot(test_run_id(2));
            released.send(download_cancelled(test_run_id(2))).ok();
        });

        cancel_all_downloads();

        assert!(download_cancelled(test_run_id(1)));
        assert!(download_cancelled(test_run_id(3)));
        assert_eq!(
            result.recv_timeout(std::time::Duration::from_secs(2)),
            Ok(true),
            "a queued run must wake before the slot holder leaves"
        );
        waiter.join().expect("queued run");
        drop(holder);
        leave_download_queue(test_run_id(3));
    }

    #[test]
    fn cancellation_stops_dispatching_the_rest_of_a_bulk_download() {
        let _serial = crate::test_globals::serial_global_state();
        let server = MockServer::start();
        let ids: Vec<String> = (0..MAX_CONCURRENCY + 10)
            .map(|i| format!("cancel-{i}"))
            .collect();
        let mocks: Vec<_> = ids
            .iter()
            .map(|id| {
                server.mock(|when, then| {
                    when.method(GET)
                        .path(format!("/activity/{id}/streams.json"));
                    then.status(200)
                        .delay(std::time::Duration::from_millis(300))
                        .json_body(streams_body(json!([46.0, 46.1]), json!([7.0, 7.1]), vec![]));
                })
            })
            .collect();
        let fetcher = fetcher_to(server.base_url());
        enqueue_download(test_run_id(71), ids.len() as u32, DownloadPriority::Bulk);
        let slot = hold_download_slot(test_run_id(71));
        let worker = std::thread::spawn(move || {
            crate::runtime::block_on(fetcher.fetch_activity_maps_into(
                test_run_id(71),
                ids,
                Default::default(),
                None,
                || true,
                |_, _permit| {},
            ));
        });

        let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while mocks.iter().all(|mock| mock.hits() == 0) {
            assert!(
                std::time::Instant::now() < until,
                "no request reached the fake transport"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        cancel_all_downloads();
        worker.join().expect("fetch worker");
        drop(slot);

        let dispatched: usize = mocks.iter().map(|mock| mock.hits()).sum();
        assert!(
            dispatched <= MAX_CONCURRENCY,
            "cancelled bulk run still dispatched {dispatched} requests"
        );
    }

    #[test]
    fn a_stalled_store_bounds_bulk_dispatch_until_results_are_released() {
        let _serial = crate::test_globals::serial_global_state();
        let server = MockServer::start();
        let ids: Vec<String> = (0..2 * MAX_CONCURRENCY)
            .map(|i| format!("held-{i}"))
            .collect();
        let mocks: Vec<_> = ids
            .iter()
            .map(|id| {
                server.mock(|when, then| {
                    when.method(GET)
                        .path(format!("/activity/{id}/streams.json"));
                    then.status(200).json_body(streams_body(
                        json!([46.0, 46.1]),
                        json!([7.0, 7.1]),
                        vec![],
                    ));
                })
            })
            .collect();
        let fetcher = fetcher_to(server.base_url());
        let run = test_run_id(72);
        enqueue_download(run, ids.len() as u32, DownloadPriority::Bulk);
        let slot = hold_download_slot(run);
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            crate::runtime::block_on(fetcher.fetch_activity_maps_into(
                run,
                ids,
                Default::default(),
                None,
                || true,
                move |result, permit| tx.send((result, permit)).expect("store is listening"),
            ));
        });

        let held: Vec<_> = (0..MAX_CONCURRENCY)
            .map(|_| {
                rx.recv_timeout(std::time::Duration::from_secs(20))
                    .expect("first window should finish")
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_secs(1));
        assert_eq!(
            mocks.iter().map(httpmock::Mock::hits).sum::<usize>(),
            MAX_CONCURRENCY,
            "a store stall must stop the next dispatch"
        );
        drop(held);
        let rest: Vec<_> = (0..MAX_CONCURRENCY)
            .map(|_| {
                rx.recv_timeout(std::time::Duration::from_secs(20))
                    .expect("remaining results should finish after storage resumes")
            })
            .collect();
        assert!(rest.iter().all(|(result, _)| result.success));
        drop(rest);
        worker.join().expect("fetch worker");
        assert_eq!(
            mocks.iter().map(httpmock::Mock::hits).sum::<usize>(),
            2 * MAX_CONCURRENCY
        );
        drop(slot);
    }

    #[test]
    fn cancelling_a_bulk_run_held_at_the_store_bound_ends_dispatch() {
        let _serial = crate::test_globals::serial_global_state();
        let server = MockServer::start();
        let ids: Vec<String> = (0..MAX_CONCURRENCY + 10)
            .map(|i| format!("cancel-held-{i}"))
            .collect();
        let mocks: Vec<_> = ids
            .iter()
            .map(|id| {
                server.mock(|when, then| {
                    when.method(GET)
                        .path(format!("/activity/{id}/streams.json"));
                    then.status(200).json_body(streams_body(
                        json!([46.0, 46.1]),
                        json!([7.0, 7.1]),
                        vec![],
                    ));
                })
            })
            .collect();
        let fetcher = fetcher_to(server.base_url());
        let run = test_run_id(73);
        enqueue_download(run, ids.len() as u32, DownloadPriority::Bulk);
        let slot = hold_download_slot(run);
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            crate::runtime::block_on(fetcher.fetch_activity_maps_into(
                run,
                ids,
                Default::default(),
                None,
                || true,
                move |result, permit| tx.send((result, permit)).expect("store is listening"),
            ));
        });

        let held: Vec<_> = (0..MAX_CONCURRENCY)
            .map(|_| {
                rx.recv_timeout(std::time::Duration::from_secs(20))
                    .expect("first window should finish")
            })
            .collect();
        cancel_all_downloads();
        worker
            .join()
            .expect("cancelled fetch must exit with all permits held");
        assert_eq!(
            mocks.iter().map(httpmock::Mock::hits).sum::<usize>(),
            MAX_CONCURRENCY
        );
        assert!(rx.try_recv().is_err(), "no result follows cancellation");
        drop(held);
        drop(slot);
    }

    /// Scenario: the first sync is downloading hundreds of tracks and the
    /// athlete opens an activity whose own track has not landed.
    ///
    /// Expected behaviour: that one fetch goes out beside the pass rather than
    /// behind it, and the pass holds its next request back while it is out.
    #[test]
    fn a_tap_during_the_bulk_pass_does_not_wait_for_it() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 400, DownloadPriority::Bulk);
        let _bulk = hold_download_slot(test_run_id(1));
        assert!(
            !should_yield_to_interactive(test_run_id(1)),
            "nothing is waiting on the pass yet"
        );

        enqueue_download(test_run_id(2), 1, DownloadPriority::Interactive);
        let (tx, rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let tap = std::thread::spawn(move || {
            let slot = hold_download_slot(test_run_id(2));
            tx.send(()).ok();
            release_rx.recv().ok();
            drop(slot);
        });
        rx.recv_timeout(std::time::Duration::from_secs(2))
            .expect("the interactive run must not wait for the pass");

        assert!(
            should_yield_to_interactive(test_run_id(1)),
            "the pass holds its next request while the tap is out"
        );
        release_tx.send(()).expect("release the interactive run");
        tap.join().expect("interactive run");
    }

    /// The counters follow the run that fetched, not the one admitted first,
    /// now that two runs can be fetching at once.
    #[test]
    fn each_run_counts_its_own_activities() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 4, DownloadPriority::Bulk);
        let _bulk = hold_download_slot(test_run_id(1));
        enqueue_download(test_run_id(2), 1, DownloadPriority::Interactive);
        let _tap = hold_download_slot(test_run_id(2));

        increment_run_download_progress(test_run_id(2));

        assert_eq!(
            run_download_progress(test_run_id(1)),
            (0, 4, true),
            "the pass counted none"
        );
        assert_eq!(
            run_download_progress(test_run_id(2)),
            (1, 1, true),
            "the tap counted its own"
        );
        assert_eq!(
            get_download_progress(),
            (0, 4, true),
            "and the process-wide poll still speaks for the pass"
        );
    }

    /// A bulk run started while a tap is out waits for it, which is the same
    /// rule from the other side.
    ///
    /// The two deadlines are not the same kind of number and must not be
    /// tuned together. The short one is the assertion: nothing may arrive
    /// while the tap is out, and a loaded box only makes the waiting thread
    /// slower, so contention can never turn a pass into a failure there. The
    /// long one is only a way to fail rather than hang if the release never
    /// unblocks, so it is set far above any scheduling delay: 2 s was close
    /// enough to one that a merge gate on a busy machine failed here while the
    /// same test passed alone, which reads as a break in whatever branch was
    /// merging.
    #[test]
    fn a_bulk_run_waits_for_an_interactive_one() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 1, DownloadPriority::Interactive);
        let tap = hold_download_slot(test_run_id(1));
        enqueue_download(test_run_id(2), 50, DownloadPriority::Bulk);

        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (tx, rx) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            // Said before the call that blocks, so the wait below is for a
            // thread that is running rather than for one the scheduler has not
            // reached yet. Without it the short deadline could pass on a busy
            // box because nothing had started, which proves nothing.
            started_tx.send(()).ok();
            let slot = hold_download_slot(test_run_id(2));
            tx.send(()).ok();
            drop(slot);
        });
        started_rx.recv().expect("the waiting thread is running");
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(200))
                .is_err(),
            "the pass must not start while the tap is out"
        );

        drop(tap);
        rx.recv_timeout(std::time::Duration::from_secs(60))
            .expect("and it starts once the tap is done");
        waiter.join().expect("the waiting thread");
    }

    /// A poll for a run that has left the queue reads inactive whatever else is
    /// downloading, which is what stops one caller settling on another's end.
    #[test]
    fn a_finished_run_reads_inactive_while_the_next_one_downloads() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 2, DownloadPriority::Bulk);
        enqueue_download(test_run_id(2), 5, DownloadPriority::Bulk);
        drop(hold_download_slot(test_run_id(1)));
        let _second = hold_download_slot(test_run_id(2));

        assert!(!run_download_progress(test_run_id(1)).2, "run 1 is over");
        assert!(run_download_progress(test_run_id(2)).2, "run 2 is not");
    }

    /// A fetcher pointed at a mock server rather than the live base URL.
    #[test]
    fn bulk_track_runs_take_the_backfill_lane() {
        let _serial = crate::test_globals::serial_global_state();
        assert_eq!(track_lane(DownloadPriority::Bulk), Lane::Backfill);
        assert_eq!(track_lane(DownloadPriority::Interactive), Lane::Interactive);
        enqueue_download(test_run_id(72), 1, DownloadPriority::Bulk);
        assert_eq!(run_priority(test_run_id(72)), DownloadPriority::Bulk);
        assert_eq!(run_priority(test_run_id(73)), DownloadPriority::Interactive);
        leave_download_queue(test_run_id(72));
    }

    fn fetcher_to(base: String) -> ActivityFetcher {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        ActivityFetcher::with_transport(
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap(),
        )
    }

    /// A `streams.json` body: latlng split across data/data2, one series per
    /// requested type. `lat`/`lng`/`alt` entries may be JSON null.
    fn streams_body(
        lat: serde_json::Value,
        lng: serde_json::Value,
        series: Vec<serde_json::Value>,
    ) -> serde_json::Value {
        let mut out = vec![json!({"type": "latlng", "data": lat, "data2": lng})];
        out.extend(series);
        json!(out)
    }

    fn fetch_one(server: &MockServer, id: &str) -> ActivityMapResult {
        let f = fetcher_to(server.base_url());
        crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec![id.to_string()],
            std::collections::HashSet::new(),
            None,
        ))
        .pop()
        .unwrap()
    }

    /// The same fetch with this activity inside the retention window, so the
    /// request is the wide one.
    fn fetch_one_wide(server: &MockServer, id: &str) -> ActivityMapResult {
        let f = fetcher_to(server.base_url());
        crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec![id.to_string()],
            std::collections::HashSet::from([id.to_string()]),
            None,
        ))
        .pop()
        .unwrap()
    }

    fn series_named<'a>(r: &'a ActivityMapResult, kind: &str) -> Option<&'a StreamDto> {
        r.streams.iter().find(|s| s.kind == kind)
    }

    /// Scenario: the batch collected every result into a `Vec` before a single
    /// row was written. 490 activities at 5,000 points is roughly 80 MB of
    /// tracks plus half a megabyte of series apiece, all resident in the window
    /// before storage began, and a kill during the download lost the lot.
    ///
    /// Expected behaviour: each result is handed over the moment it lands, so
    /// storage runs alongside the download rather than behind it.
    #[test]
    fn each_track_reaches_the_caller_as_it_lands_not_after_the_last_one() {
        let server = MockServer::start();
        for id in ["a1", "a2", "a3"] {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"));
                then.status(200).json_body(streams_body(
                    json!([46.0, 46.1]),
                    json!([7.0, 7.1]),
                    vec![],
                ));
            });
        }
        let f = fetcher_to(server.base_url());
        let (tx, rx) = std::sync::mpsc::channel();

        let handed: Vec<ActivityMapResult> = std::thread::scope(|scope| {
            let collector = scope.spawn(move || rx.into_iter().collect());
            crate::runtime::block_on(f.fetch_activity_maps_into(
                0,
                vec!["a1".to_string(), "a2".to_string(), "a3".to_string()],
                std::collections::HashSet::new(),
                None,
                || true,
                move |result, _permit| {
                    tx.send(result).ok();
                },
            ));
            collector.join().unwrap()
        });

        assert_eq!(handed.len(), 3, "every result is handed over");
        assert!(
            handed.iter().all(|r| r.success),
            "and each one whole: {:?}",
            handed.iter().map(|r| &r.error).collect::<Vec<_>>()
        );
    }

    /// The collecting form is the streaming one with a collector on the end, so
    /// the two cannot drift: one fetch, one set of results, one order of
    /// arrival.
    #[test]
    fn the_collecting_fetch_returns_what_the_streaming_one_hands_over() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.0, 46.1]),
                json!([7.0, 7.1]),
                vec![],
            ));
        });
        let f = fetcher_to(server.base_url());

        let collected = crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec!["a1".to_string()],
            std::collections::HashSet::new(),
            None,
        ));

        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].activity_id, "a1");
    }

    #[test]
    fn track_fetch_reduces_coordinates_and_derives_bounds() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/activity/a1/streams.json")
                .query_param("types", "latlng,fixed_altitude,altitude");
            then.status(200).json_body(streams_body(
                json!([46.941, null, 46.942]),
                json!([7.441, null, 7.442]),
                vec![],
            ));
        });

        let r = fetch_one(&server, "a1");

        mock.assert();
        assert!(r.success);
        // The null hole is dropped, not carried through as a gap.
        assert_eq!(
            r.latlngs.as_ref().unwrap(),
            &vec![[46.941, 7.441], [46.942, 7.442]]
        );
        assert!(r.body_bytes > 0);
    }

    #[test]
    fn elevation_follows_the_original_index_of_each_surviving_coordinate() {
        // Nulls at 1 and 3 of a five-sample track. Altitude is full length and
        // distinct per index, so a compaction that shifted it would show.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, null, 46.12, null, 46.14]),
                json!([7.10, null, 7.12, null, 7.14]),
                vec![json!({"type": "altitude",
                            "data": [100.0, 200.0, 300.0, 400.0, 500.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.latlngs.as_ref().unwrap(),
            &vec![[46.10, 7.10], [46.12, 7.12], [46.14, 7.14]]
        );
        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(100.0), Some(300.0), Some(500.0)]
        );
    }

    #[test]
    fn fixed_altitude_wins_over_altitude() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11]),
                json!([7.10, 7.11]),
                vec![
                    json!({"type": "altitude", "data": [100.0, 101.0]}),
                    json!({"type": "fixed_altitude", "data": [900.0, 901.0]}),
                ],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(900.0), Some(901.0)]
        );
    }

    fn decoded(series: Vec<serde_json::Value>) -> ActivityMapResult {
        let body = streams_body(json!([46.10, 46.11]), json!([7.10, 7.11]), series);
        track_from_streams_body("a1", body.to_string().as_bytes(), false)
    }

    /// Scenario: a ranking of climbing bests keeps to the corrected series, so
    /// the track has to say which of the two its elevation is.
    ///
    /// Expected behaviour: the corrected series is named as corrected in
    /// either wire order, and the device series as not corrected.
    #[test]
    fn the_decoded_track_names_the_series_its_elevation_came_from() {
        let device = json!({"type": "altitude", "data": [100.0, 101.0]});
        let corrected = json!({"type": "fixed_altitude", "data": [900.0, 901.0]});

        for order in [
            vec![device.clone(), corrected.clone()],
            vec![corrected.clone(), device.clone()],
        ] {
            let r = decoded(order);
            assert_eq!(r.elevations, Some(vec![Some(900.0), Some(901.0)]));
            assert!(r.elevation_corrected);
        }

        let r = decoded(vec![device.clone()]);
        assert_eq!(r.elevations, Some(vec![Some(100.0), Some(101.0)]));
        assert!(!r.elevation_corrected);
    }

    /// A corrected series with no usable sample loses to the device series,
    /// and the track says so rather than claiming the series it did not use.
    #[test]
    fn an_unusable_corrected_series_leaves_the_device_series_named() {
        for order in [
            vec![
                json!({"type": "fixed_altitude", "data": [null, null]}),
                json!({"type": "altitude", "data": [100.0, 101.0]}),
            ],
            vec![
                json!({"type": "altitude", "data": [100.0, 101.0]}),
                json!({"type": "fixed_altitude", "data": [null, null]}),
            ],
        ] {
            let r = decoded(order);
            assert_eq!(r.elevations, Some(vec![Some(100.0), Some(101.0)]));
            assert!(!r.elevation_corrected);
        }
    }

    /// A corrected series that cannot be placed on the track costs the
    /// elevation, and with it any claim about its series.
    #[test]
    fn a_misaligned_corrected_series_names_no_series() {
        let r = decoded(vec![json!({"type": "fixed_altitude", "data": [900.0]})]);
        assert_eq!(r.elevations, None);
        assert!(!r.elevation_corrected);
    }

    #[test]
    fn a_track_with_no_altitude_series_still_fetches() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11]),
                json!([7.10, 7.11]),
                vec![],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 2);
        assert!(r.elevations.is_none());
    }

    #[test]
    fn a_gap_in_the_altitude_series_is_none_at_that_point_alone() {
        // A null altitude sample parses to NaN, which would poison every
        // comparison the detector makes on it.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11, 46.12]),
                json!([7.10, 7.11, 7.12]),
                vec![json!({"type": "altitude", "data": [100.0, null, 102.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(100.0), None, Some(102.0)]
        );
    }

    #[test]
    fn altitude_does_not_change_the_point_count() {
        let lat = json!([46.10, null, 46.12, 46.13, null]);
        let lng = json!([7.10, null, 7.12, 7.13, null]);

        let bare = MockServer::start();
        bare.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200)
                .json_body(streams_body(lat.clone(), lng.clone(), vec![]));
        });
        let with_alt = MockServer::start();
        with_alt.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                lat,
                lng,
                vec![json!({"type": "fixed_altitude", "data": [1.0, 2.0, 3.0, 4.0, 5.0]})],
            ));
        });

        let a = fetch_one(&bare, "a1");
        let b = fetch_one(&with_alt, "a1");

        assert_eq!(a.latlngs.as_ref().unwrap().len(), 3);
        assert_eq!(a.latlngs, b.latlngs);
        assert_eq!(
            b.elevations.as_ref().unwrap(),
            &vec![Some(1.0), Some(3.0), Some(4.0)]
        );
    }

    #[test]
    fn an_altitude_series_of_the_wrong_length_costs_the_elevation_not_the_track() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11, 46.12]),
                json!([7.10, 7.11, 7.12]),
                vec![json!({"type": "altitude", "data": [100.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 3);
        assert!(r.elevations.is_none());
    }

    #[test]
    fn track_fetch_names_unauthorized_rather_than_a_bare_http_code() {
        // 401 classification is what the sync service turns into a re-login,
        // and this path could not see it before it went through Transport.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(401);
        });

        let f = fetcher_to(server.base_url());
        let results = crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec!["a1".into()],
            std::collections::HashSet::new(),
            None,
        ));

        assert!(!results[0].success);
        assert_eq!(results[0].error.as_deref(), Some("unauthorized"));
    }

    #[test]
    fn a_failing_activity_does_not_sink_the_batch() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/good/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.9, 46.91]),
                json!([7.4, 7.41]),
                vec![],
            ));
        });
        server.mock(|when, then| {
            when.method(GET).path("/activity/gone/streams.json");
            then.status(404);
        });

        let f = fetcher_to(server.base_url());
        let results = crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec!["good".into(), "gone".into()],
            std::collections::HashSet::new(),
            None,
        ));

        let good = results.iter().find(|r| r.activity_id == "good").unwrap();
        let gone = results.iter().find(|r| r.activity_id == "gone").unwrap();
        assert!(good.success);
        assert!(!gone.success);
    }

    #[test]
    fn track_fetch_reports_progress_per_activity() {
        // The fetch loop bumps the process-wide download counters as it goes.
        let _serial = crate::test_globals::serial_global_state();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path_contains("/streams.json");
            then.status(200).json_body(json!([]));
        });

        let seen = Arc::new(AtomicU32::new(0));
        let counter = Arc::clone(&seen);
        let f = fetcher_to(server.base_url());
        crate::runtime::block_on(f.fetch_activity_maps(
            0,
            vec!["a".into(), "b".into(), "c".into()],
            std::collections::HashSet::new(),
            Some(Arc::new(move |_done, _total| {
                counter.fetch_add(1, Ordering::Relaxed);
            })),
        ));

        assert_eq!(seen.load(Ordering::Relaxed), 3);
    }

    /// Scenario: an activity inside the retention window is synced, and the
    /// durable stream store has nothing to fill it until the bulk pass widens.
    ///
    /// Expected behaviour: the request asks for every series the app can use,
    /// and the extra ones come back on the result so the storing loop can put
    /// them away. The track is unchanged by the widening.
    #[test]
    fn a_wide_fetch_asks_for_every_series_and_carries_them_back() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/activity/a1/streams.json")
                .query_param("types", crate::net::endpoints::DEFAULT_STREAM_TYPES);
            then.status(200).json_body(streams_body(
                json!([46.10, null, 46.12]),
                json!([7.10, null, 7.12]),
                vec![
                    json!({"type": "watts", "data": [100.0, 200.0, 300.0]}),
                    json!({"type": "heartrate", "data": [140.0, 150.0, 160.0]}),
                ],
            ));
        });

        let r = fetch_one_wide(&server, "a1");

        mock.assert();
        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 2);
        // The dropped coordinate takes its sample with it: the store holds the
        // series in the index space the track is stored in.
        assert_eq!(
            series_named(&r, "watts").map(|s| s.data.clone()),
            Some(vec![Some(100.0), Some(300.0)])
        );
        assert_eq!(
            series_named(&r, "heartrate").map(|s| s.data.clone()),
            Some(vec![Some(140.0), Some(160.0)])
        );
    }

    /// An activity outside the window still costs the narrow body, because the
    /// prune would delete the extra series the same second they landed.
    #[test]
    fn an_activity_outside_the_window_still_costs_the_narrow_body() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/activity/a1/streams.json")
                .query_param("types", crate::net::endpoints::TRACK_STREAM_TYPES);
            then.status(200).json_body(streams_body(
                json!([46.10, 46.12]),
                json!([7.10, 7.12]),
                vec![json!({"type": "watts", "data": [100.0, 300.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        mock.assert();
        assert!(r.success);
        assert!(
            r.streams.is_empty(),
            "a narrow fetch stored series it never asked for"
        );
    }

    /// The track, its elevation and its time are answered from `gps_tracks`
    /// and `time_streams`, so storing them again would pay twice.
    #[test]
    fn a_wide_fetch_carries_no_series_the_track_already_answers() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.12]),
                json!([7.10, 7.12]),
                vec![
                    json!({"type": "altitude", "data": [500.0, 510.0]}),
                    json!({"type": "time", "data": [0.0, 10.0]}),
                    json!({"type": "watts", "data": [100.0, 300.0]}),
                ],
            ));
        });

        let r = fetch_one_wide(&server, "a1");

        let kinds: Vec<&str> = r.streams.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(kinds, vec!["watts"]);
    }

    /// Scenario: a widened response carries a series whose sample count
    /// disagrees with the coordinates.
    ///
    /// Expected behaviour: that series is dropped and the track is still
    /// stored. A series at the wrong length has no trustworthy index space,
    /// and losing the activity over it would cost far more than the series.
    #[test]
    fn a_misaligned_series_in_a_wide_fetch_does_not_lose_the_track() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.12, 46.14]),
                json!([7.10, 7.12, 7.14]),
                vec![
                    json!({"type": "watts", "data": [100.0, 300.0]}),
                    json!({"type": "heartrate", "data": [140.0, 150.0, 160.0]}),
                ],
            ));
        });

        let r = fetch_one_wide(&server, "a1");

        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 3);
        assert!(
            series_named(&r, "watts").is_none(),
            "a series at the wrong length was stored"
        );
        assert!(series_named(&r, "heartrate").is_some());
    }

    /// An empty series is not stored: a row of nothing reads downstream as
    /// "the ride had no power", which stops the fetch that would fill it.
    #[test]
    fn a_wide_fetch_stores_no_empty_series() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.12]),
                json!([7.10, 7.12]),
                vec![json!({"type": "watts", "data": [null, null]})],
            ));
        });

        let r = fetch_one_wide(&server, "a1");

        assert!(r.streams.is_empty(), "an all-gap series was stored");
    }

    #[test]
    fn fit_download_returns_the_raw_bytes() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/file");
            then.status(200).body(vec![0x0Eu8, 0x10, 0x00, 0x00]);
        });

        let f = fetcher_to(server.base_url());
        let bytes = crate::runtime::block_on(f.download_fit_file("a1", Lane::Interactive)).unwrap();

        assert_eq!(bytes, vec![0x0E, 0x10, 0x00, 0x00]);
    }

    #[test]
    fn fit_download_surfaces_a_missing_file_as_an_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/file");
            then.status(404);
        });

        let f = fetcher_to(server.base_url());
        assert!(crate::runtime::block_on(f.download_fit_file("a1", Lane::Interactive)).is_err());
    }

    /// Scenario: the strength FIT batch ran on the Interactive lane, so a
    /// background sweep of a whole library competed with whatever the athlete
    /// was tapping for the shared dispatch pace.
    ///
    /// Expected behaviour: the lane is the caller's, so the batch can yield and
    /// the single fetch a card is waiting on does not.
    #[test]
    fn a_fit_download_runs_on_the_lane_its_caller_names() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/file");
            then.status(200).body(vec![0x0Eu8]);
        });
        let f = fetcher_to(server.base_url());

        assert!(crate::runtime::block_on(f.download_fit_file("a1", Lane::Backfill)).is_ok());
        assert!(crate::runtime::block_on(f.download_fit_file("a1", Lane::Interactive)).is_ok());
    }

    /// Scenario: the fetch-and-store thread runs to its end whatever the
    /// athlete does, so a download they walked away from keeps taking the write
    /// lock and keeps spending requests.
    ///
    /// Expected behaviour: a run can be asked to stop, and the ask is scoped to
    /// the run it was made during. A stale cancel must not stop the next one,
    /// which is why it is cleared by the reset every run already calls.
    #[test]
    fn a_run_can_be_cancelled_and_the_next_one_starts_clean() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 4, DownloadPriority::Bulk);
        let first = hold_download_slot(test_run_id(1));
        assert!(
            !download_cancelled(test_run_id(1)),
            "a fresh run is not cancelled"
        );

        enqueue_download(test_run_id(2), 2, DownloadPriority::Bulk);
        assert!(
            cancel_download(test_run_id(1)),
            "a run was active to cancel"
        );
        assert!(download_cancelled(test_run_id(1)), "and it is flagged");
        assert!(
            !download_cancelled(test_run_id(2)),
            "the cancel stops the run it was aimed at, not the one queued behind it"
        );

        drop(first);
        let _second = hold_download_slot(test_run_id(2));
        assert!(
            !download_cancelled(test_run_id(2)),
            "the next run starts clean, or one cancel stops every download after it"
        );
    }

    /// Scenario: a map tap's interactive run holds the head of the queue and a
    /// bulk sync joins behind it, then the sync is abandoned.
    ///
    /// Expected behaviour: the cancel flags the bulk run wherever it sits and
    /// leaves the interactive run the athlete is waiting on alone.
    #[test]
    fn a_cancel_reaches_a_queued_run_and_not_the_one_ahead_of_it() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 1, DownloadPriority::Interactive);
        enqueue_download(test_run_id(2), 400, DownloadPriority::Bulk);

        assert!(cancel_download(test_run_id(2)), "the queued run is found");
        assert!(download_cancelled(test_run_id(2)), "and flagged");
        assert!(
            !download_cancelled(test_run_id(1)),
            "the run at the head is not the caller's and is left to finish"
        );

        leave_download_queue(test_run_id(1));
        leave_download_queue(test_run_id(2));
    }

    /// Cancelling when nothing is downloading says so, rather than arming a
    /// flag that the next run would read.
    #[test]
    fn cancelling_an_idle_download_flags_nothing() {
        let _serial = crate::test_globals::serial_global_state();
        enqueue_download(test_run_id(1), 1, DownloadPriority::Bulk);
        drop(hold_download_slot(test_run_id(1)));

        assert!(
            !cancel_download(test_run_id(1)),
            "there was no run to cancel"
        );
        assert!(
            !download_cancelled(test_run_id(1)),
            "so nothing is flagged for the next one"
        );
    }
}

#[cfg(test)]
#[path = "tests/http_auth.rs"]
mod auth_tests;
